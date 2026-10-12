import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile, PermissionMatrix, ALL_TRUE_PERMISSIONS } from './types';
import { supabase } from './lib/supabase';
import { clearDbCache, invalidateDbCache, fromDb } from './lib/db';
import { retryRead, withDeadline } from './lib/readRecovery';
import type { Session } from '@supabase/supabase-js';
import { resolveInventoryAccessState } from './lib/inventoryAccess';
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
  authError: string | null;
  refetchToken: number;
  refetchData: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(session: Session, signal: AbortSignal): Promise<LoadedAuth> {
  try {
    const collaboratorResult = await supabase
      .from('collaborators')
      .select('id, owner_uid, permissions')
      .eq('user_uid', session.user.id)
      .is('revoked_at', null)
      .abortSignal(signal).maybeSingle();
    if (collaboratorResult.error) throw collaboratorResult.error;
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

    const profileResult = await supabase.rpc('get_owner_profile').abortSignal(signal);
    if (profileResult.error) throw profileResult.error;
    if (!profileResult.data?.length) throw new Error('No se pudo verificar el perfil de la cuenta.');
    const profile = fromDb<UserProfile>(profileResult.data[0], true);
    profile.uid = ownerUid;

    // A genuinely missing rollout schema may use the legacy model. Network,
    // lock and permission errors must never silently broaden inventory scope.
    let inventoryAccess: ReturnType<typeof resolveInventoryAccessState>;
    try {
      const [membershipsResult, settingsResult, ownersResult] = await Promise.all([
        supabase
          .from('inventory_owner_memberships')
          .select('inventory_owner_id, is_default, can_operate')
          .eq('user_id', ownerUid)
          .eq('actor_uid', session.user.id).abortSignal(signal),
        supabase
          .from('inventory_operation_settings')
          .select('holdings_enabled')
          .eq('user_id', ownerUid)
          .abortSignal(signal).maybeSingle(),
        supabase
          .from('inventory_owners')
          .select('id')
          .eq('user_id', ownerUid).abortSignal(signal),
      ]);
      const memberships = membershipsResult.data ?? [];
      const queryErrors = [membershipsResult.error, settingsResult.error, ownersResult.error]
        .filter((error): error is NonNullable<typeof error> => Boolean(error));
      if (queryErrors.length > 0) {
        const missingSchema = (error: { code: string } | null) => error && ['42P01', 'PGRST205'].includes(error.code);
        // A missing membership table does not authorize falling back if the
        // account is already using owner-aware inventory.
        const legacyVerified = missingSchema(settingsResult.error) || settingsResult.data?.holdings_enabled === false;
        if (!queryErrors.every(missingSchema) || !legacyVerified) throw queryErrors[0];
        console.warn('[Auth] inventory-owner schema not installed; using legacy model.');
        inventoryAccess = {
          allowedInventoryOwnerIds: [],
          operableInventoryOwnerIds: [],
          defaultInventoryOwnerId: null,
          holdingsEnabled: false,
          inventoryAccessError: null,
        };
      } else {
        inventoryAccess = resolveInventoryAccessState({
          memberships: memberships.map((row) => ({
            inventoryOwnerId: row.inventory_owner_id,
            isDefault: row.is_default,
            canOperate: row.can_operate,
          })),
          holdingsEnabled: settingsResult.data?.holdings_enabled ?? null,
          inventoryOwnerIds: (ownersResult.data ?? []).map((row) => row.id),
          queryErrors: [],
        });
      }
    } catch (inventoryErr) {
      throw inventoryErr;
    }

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
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth]                 = useState<LoadedAuth | null>(null);
  const [authUser, setAuthUser]         = useState<{ uid: string; email: string } | null>(null);
  const [loading, setLoading]           = useState(true);
  const [authError, setAuthError]       = useState<string | null>(null);
  const [isReady, setIsReady]           = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);
  const currentUserIdRef                = useRef<string | null>(null);
  const authVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const authRef = useRef<LoadedAuth | null>(null);
  const profileJobRef = useRef<{
    actorUid: string; version: number; controller: AbortController;
    refreshData: boolean; promise: Promise<boolean>;
  } | null>(null);
  const refreshJobRef = useRef<Promise<void> | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const scheduledRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const clearAuthState = useCallback(() => {
    authVersionRef.current++;
    refreshControllerRef.current?.abort();
    refreshControllerRef.current = null;
    refreshJobRef.current = null;
    currentUserIdRef.current = null;
    profileJobRef.current?.controller.abort();
    profileJobRef.current = null;
    authRef.current = null;
    clearDbCache();
    setAuth(null);
    setAuthUser(null);
    setAuthError(null);
    setLoading(false);
  }, []);

  const activateSession = useCallback((session: Session) => {
    if (currentUserIdRef.current !== session.user.id) {
      authVersionRef.current++;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      refreshJobRef.current = null;
      profileJobRef.current?.controller.abort();
      profileJobRef.current = null;
      currentUserIdRef.current = session.user.id;
      authRef.current = null;
      clearDbCache();
      setAuth(null);
      setLoading(true);
    }
    setAuthUser({ uid: session.user.id, email: session.user.email ?? '' });
  }, []);

  const requestProfile = useCallback((session: Session, refreshData = false): Promise<boolean> => {
    if (!mountedRef.current) return Promise.resolve(false);
    activateSession(session);
    const existing = profileJobRef.current;
    if (existing?.actorUid === session.user.id && existing.version === authVersionRef.current) {
      existing.refreshData ||= refreshData;
      return existing.promise;
    }
    const job = {
      actorUid: session.user.id, version: authVersionRef.current,
      controller: new AbortController(), refreshData,
      promise: Promise.resolve(false),
    };
    profileJobRef.current = job;
    const isCurrent = () => mountedRef.current && authVersionRef.current === job.version
      && currentUserIdRef.current === job.actorUid;
    setAuthError(null);
    if (!authRef.current) setLoading(true);
    job.promise = (async () => {
      try {
        const loaded = await withDeadline(
          signal => retryRead(() => loadProfile(session, signal), signal),
          25_000, job.controller.signal,
        );
        if (!isCurrent()) return false;
        authRef.current = loaded;
        setAuth(loaded);
        if (job.refreshData) setRefetchToken(token => token + 1);
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        // Fail closed, but retain the actual auth session so reconnecting does
        // not require a page reload or signing in again.
        authRef.current = null;
        clearDbCache();
        setAuth(null);
        setAuthError('No se pudo verificar la conexión con tu cuenta. Podés reintentar sin recargar la página.');
        console.error('[Auth] profile verification failed:', error);
        return false;
      } finally {
        if (isCurrent()) setLoading(false);
        if (profileJobRef.current === job) profileJobRef.current = null;
      }
    })();
    return job.promise;
  }, [activateSession]);

  const readSession = useCallback((parentSignal?: AbortSignal) => withDeadline(signal => retryRead(async () => {
    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    return result.data.session;
  }, signal), 20_000, parentSignal), []);

  const refetchData = useCallback(() => {
    if (refreshJobRef.current) return;
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const version = authVersionRef.current;
    clearDbCache();
    setAuthError(null);
    if (!authRef.current) setLoading(true);
    const refresh = (async () => {
      try {
        const session = await readSession(controller.signal);
        if (!mountedRef.current || version !== authVersionRef.current) return;
        if (!session) { clearAuthState(); return; }
        await requestProfile(session, true);
      } catch (error) {
        if (!mountedRef.current || version !== authVersionRef.current) return;
        authRef.current = null;
        setAuth(null);
        setAuthError('No se pudo restablecer la conexión. Volvé a intentar en unos segundos.');
        setLoading(false);
        console.error('[Auth] session refresh failed:', error);
      } finally {
        if (refreshJobRef.current === refresh) {
          refreshJobRef.current = null;
          refreshControllerRef.current = null;
        }
      }
    })();
    refreshJobRef.current = refresh;
  }, [clearAuthState, readSession, requestProfile]);

  const init = useCallback(async () => {
    const version = authVersionRef.current;
    try {
      const session = await readSession();
      if (!mountedRef.current || version !== authVersionRef.current) return;
      // Register listeners only after SDK initialization, but before loading
      // profile data so sign-out/account changes can cancel that work.
      setIsReady(true);
      if (session) {
        await requestProfile(session);
      } else {
        setLoading(false);
      }
    } catch (err) {
      if (!mountedRef.current || version !== authVersionRef.current) return;
      console.error('[Auth] Init failed:', err);
      setAuthError('No se pudo establecer la conexión. Podés reintentar sin recargar la página.');
      setLoading(false);
      setIsReady(true);
    }
  }, [readSession, requestProfile]);

  useEffect(() => {
    mountedRef.current = true;
    void init();
    return () => {
      mountedRef.current = false;
      authVersionRef.current++;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      refreshJobRef.current = null;
      profileJobRef.current?.controller.abort();
      profileJobRef.current = null;
      for (const timer of scheduledRef.current) clearTimeout(timer);
      scheduledRef.current.clear();
    };
  }, [init]);

  useEffect(() => {
    if (!isReady) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          clearAuthState();
          return;
        }

        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (currentUserIdRef.current === session.user.id && authRef.current) return;
        }
        if (event === 'INITIAL_SESSION' && currentUserIdRef.current === session.user.id
          && (authRef.current || profileJobRef.current)) return;
        activateSession(session);
        const version = authVersionRef.current;
        // Supabase invokes this callback inside its exclusive session lock.
        // Return synchronously; even a fire-and-forget immediate SDK call can
        // deadlock. Start database work in a later macrotask after lock release.
        const timer = setTimeout(() => {
          scheduledRef.current.delete(timer);
          if (!mountedRef.current || version !== authVersionRef.current) return;
          void requestProfile(session);
        }, 0);
        scheduledRef.current.add(timer);
      },
    );

    return () => {
      subscription.unsubscribe();
      for (const timer of scheduledRef.current) clearTimeout(timer);
      scheduledRef.current.clear();
    };
  }, [activateSession, clearAuthState, isReady, requestProfile]);

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
    clearAuthState();
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
    // updatedUser.uid is the account owner, not necessarily the signed-in actor.
    invalidateDbCache('users');
    if (authRef.current) authRef.current = { ...authRef.current, profile: updatedUser };
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
        inventoryAccessError: auth
          ? auth.inventoryAccessError
          : null,
        loading,
        authError,
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
