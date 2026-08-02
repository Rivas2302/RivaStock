import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile, PermissionMatrix, ALL_TRUE_PERMISSIONS } from './types';
import { supabase } from './lib/supabase';
import { clearDbCache, invalidateDbCache, fromDb } from './lib/db';
import type { Session } from '@supabase/supabase-js';
import {
  INVENTORY_ACCESS_ERROR_MESSAGE,
  resolveInventoryAccessState,
} from './lib/inventoryAccess';
import { resolveAccountActor } from './lib/accountActor';

interface LoadedAuth {
  profile: UserProfile;
  ownerUid: string;
  isOwner: boolean;
  collaboratorId: string | null;
  permissions: PermissionMatrix;
  allowedInventoryOwnerIds: string[];
  operableInventoryOwnerIds: string[];
  defaultInventoryOwnerId: string | null;
  holdingsEnabled: boolean;
  inventoryAccessError: string | null;
}

interface AuthContextType {
  user: UserProfile | null;
  authUser: { uid: string; email: string } | null;
  ownerUid: string | null;
  isOwner: boolean;
  collaboratorId: string | null;
  permissions: PermissionMatrix;
  allowedInventoryOwnerIds: string[];
  operableInventoryOwnerIds: string[];
  defaultInventoryOwnerId: string | null;
  holdingsEnabled: boolean;
  inventoryAccessError: string | null;
  loading: boolean;
  refetchToken: number;
  refetchData: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(session: Session): Promise<LoadedAuth | null> {
  try {
    const collaboratorResult = await supabase
      .from('collaborators')
      .select('id, owner_uid, permissions')
      .eq('user_uid', session.user.id)
      .is('revoked_at', null)
      .maybeSingle();
    const accountActor = resolveAccountActor({
      actorUid: session.user.id,
      collaborator: collaboratorResult.data ? {
        id: collaboratorResult.data.id,
        ownerUid: collaboratorResult.data.owner_uid,
        permissions: collaboratorResult.data.permissions as PermissionMatrix,
      } : null,
      queryError: collaboratorResult.error?.message ?? null,
      ownerPermissions: ALL_TRUE_PERMISSIONS,
    });
    const { isOwner, ownerUid, collaboratorId, permissions } = accountActor;

    let profile: UserProfile | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.rpc('get_owner_profile');
      if (!error && data && data.length > 0) {
        profile = fromDb<UserProfile>(data[0], true);
        profile.uid = ownerUid;
        break;
      }
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!profile) throw new Error('No se pudo cargar el perfil. Recargá la página.');

    const [membershipsResult, settingsResult, ownersResult] = await Promise.all([
      supabase
        .from('inventory_owner_memberships')
        .select('inventory_owner_id, is_default, can_operate')
        .eq('user_id', ownerUid)
        .eq('actor_uid', session.user.id),
      supabase
        .from('inventory_operation_settings')
        .select('holdings_enabled')
        .eq('user_id', ownerUid)
        .maybeSingle(),
      supabase
        .from('inventory_owners')
        .select('id')
        .eq('user_id', ownerUid),
    ]);
    const memberships = membershipsResult.data ?? [];
    const inventoryAccess = resolveInventoryAccessState({
      memberships: memberships.map((row) => ({
        inventoryOwnerId: row.inventory_owner_id,
        isDefault: row.is_default,
        canOperate: row.can_operate,
      })),
      holdingsEnabled: settingsResult.data?.holdings_enabled ?? null,
      inventoryOwnerIds: (ownersResult.data ?? []).map((row) => row.id),
      queryErrors: [membershipsResult.error, settingsResult.error, ownersResult.error]
        .filter((error): error is NonNullable<typeof error> => Boolean(error))
        .map((error) => error.message),
    });

    return {
      profile,
      ownerUid,
      isOwner,
      collaboratorId,
      permissions,
      ...inventoryAccess,
    };
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth]                 = useState<LoadedAuth | null>(null);
  const [authUser, setAuthUser]         = useState<{ uid: string; email: string } | null>(null);
  const [loading, setLoading]           = useState(true);
  const [isReady, setIsReady]           = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);
  const currentUserIdRef                = useRef<string | null>(null);

  const refetchData = useCallback(() => {
    clearDbCache();
    setRefetchToken(t => t + 1);
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const loaded = await loadProfile(data.session);
      setAuth(loaded);
    });
  }, []);

  const init = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAuthUser({ uid: session.user.id, email: session.user.email ?? '' });
        const loaded = await loadProfile(session);
        if (loaded) {
          currentUserIdRef.current = session.user.id;
          setAuth(loaded);
        } else {
          console.warn('[Auth] Initial profile load failed; user must reload.');
        }
      }
    } catch (err) {
      console.error('[Auth] Init failed:', err);
    } finally {
      setLoading(false);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!isReady) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          currentUserIdRef.current = null;
          clearDbCache();
          setAuth(null);
          setAuthUser(null);
          return;
        }

        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (currentUserIdRef.current === session.user.id) return;
        }

        setAuthUser({ uid: session.user.id, email: session.user.email ?? '' });
        const sameUser = currentUserIdRef.current === session.user.id;
        const loaded = await loadProfile(session);

        if (loaded) {
          currentUserIdRef.current = session.user.id;
          setAuth(loaded);
          return;
        }

        setAuth(null);
        if (sameUser) {
          console.warn('[Auth] Profile re-fetch failed during', event, '— blocking access until reload.');
        } else {
          console.error('[Auth] Profile fetch failed for new session; user not signed in.');
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [isReady]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Email o contraseña incorrectos. Por favor verificá tus datos.');
      }
      throw new Error(error.message);
    }
    if (data.user && !data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Tu email no está verificado. Revisá tu casilla de correo.');
    }
  };

  const logout = async () => {
    currentUserIdRef.current = null;
    clearDbCache();
    setAuth(null);
    setAuthUser(null);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[Auth] signOut error (ignored — local state already cleared):', err);
    }
  };

  const sendResetEmail = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error('Error al enviar el email de recuperación.');
  };

  const resetPassword = async (_code: string, newPassword: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Link inválido o vencido. Solicitá un nuevo email de recuperación.');
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    // Fire-and-forget local signOut: clears localStorage instantly without a
    // network round-trip. Awaiting a global signOut() here can hang because
    // AuthContext may still be mid-loadProfile from the SIGNED_IN fired by
    // verifyOtp moments before. The user logs in fresh next, which replaces
    // any lingering session.
    supabase.auth.signOut({ scope: 'local' }).catch(() => { /* ignore */ });
  };

  const updateUser = (updatedUser: UserProfile) => {
    currentUserIdRef.current = updatedUser.uid;
    invalidateDbCache('users');
    setAuth(prev => prev ? { ...prev, profile: updatedUser } : null);
  };

  return (
    <AuthContext.Provider
      value={{
        user:           auth?.profile ?? null,
        authUser,
        ownerUid:       auth?.ownerUid ?? null,
        isOwner:        auth?.isOwner ?? false,
        collaboratorId: auth?.collaboratorId ?? null,
        permissions:    auth?.permissions ?? ALL_TRUE_PERMISSIONS,
        allowedInventoryOwnerIds: auth?.allowedInventoryOwnerIds ?? [],
        operableInventoryOwnerIds: auth?.operableInventoryOwnerIds ?? [],
        defaultInventoryOwnerId: auth?.defaultInventoryOwnerId ?? null,
        holdingsEnabled: auth?.holdingsEnabled ?? false,
        inventoryAccessError: auth?.inventoryAccessError
          ?? (authUser && !loading ? INVENTORY_ACCESS_ERROR_MESSAGE : null),
        loading,
        refetchToken,
        refetchData,
        login,
        logout,
        updateUser,
        sendResetEmail,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
