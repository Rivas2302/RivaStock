import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile, PermissionMatrix, ALL_TRUE_PERMISSIONS } from './types';
import { supabase } from './lib/supabase';
import { clearDbCache, invalidateDbCache, fromDb, setDatabaseActor, syncOfflineMutations } from './lib/db';
import { retryRead, withDeadline } from './lib/readRecovery';
import type { Session } from '@supabase/supabase-js';
import { resolveInventoryAccessState } from './lib/inventoryAccess';
import { resolveAccountActor } from './lib/accountActor';
import { normalizeDisplayName } from './lib/accountProfile';

export interface AuthenticatedActor {
  uid: string;
  email: string;
  displayName: string;
  passwordSet: boolean;
  forcePass: boolean;
  needsProfileSetup: boolean;
  signupKind: string | null;
}

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
  authUser: AuthenticatedActor | null;
  ownerUid: string | null;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  isPlatformAdminLoading: boolean;
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
  refreshAuthProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(session: Session, signal: AbortSignal): Promise<LoadedAuth> {
  try {
    // Both endpoints authorize from the session; neither depends on the other's result.
    const [collaboratorResult, profileResult, actorProfileResult] = await Promise.all([
      supabase.from('collaborators').select('id, owner_uid, permissions')
        .eq('user_uid', session.user.id).is('revoked_at', null).abortSignal(signal).maybeSingle(),
      supabase.rpc('get_owner_profile').abortSignal(signal),
      supabase.from('profiles').select('display_name')
        .eq('id', session.user.id).abortSignal(signal).maybeSingle(),
    ]);
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

    if (profileResult.error) throw profileResult.error;
    if (!profileResult.data?.length) throw new Error('No se pudo verificar el perfil de la cuenta.');
    const profile = fromDb<UserProfile>(profileResult.data[0], true);
    profile.uid = ownerUid;
    const metadata = session.user.user_metadata ?? {};
    const actorDisplayName = normalizeDisplayName(metadata.display_name)
      || normalizeDisplayName(metadata.full_name)
      || normalizeDisplayName(actorProfileResult.data?.display_name);
    // The profile presented in the app belongs to the signed-in person, while
    // business fields and ownership continue to come from the owner profile.
    profile.displayName = actorDisplayName;

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
  const [authUser, setAuthUser]         = useState<AuthenticatedActor | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState<{ uid: string; isAdmin: boolean } | null>(null);
  const [loading, setLoading]           = useState(true);
  const [authError, setAuthError]       = useState<string | null>(null);
  const [isReady, setIsReady]           = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);
  const currentUserIdRef                = useRef<string | null>(null);
  const authVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const authRef = useRef<LoadedAuth | null>(null);
  const checkedPlatformAdminUidRef = useRef<string | null>(null);
  const profileJobRef = useRef<{
    actorUid: string; version: number; controller: AbortController;
    refreshData: boolean; promise: Promise<boolean>;
  } | null>(null);
  const refreshJobRef = useRef<Promise<void> | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const scheduledRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  const clearAuthState = useCallback(() => {
    setDatabaseActor(null);
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
    const isNewIdentity = currentUserIdRef.current !== session.user.id;
    if (isNewIdentity) {
      setDatabaseActor(null);
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
    // Keep the last verified first-login state during token/profile refreshes.
    // A successful profile read below applies updated metadata without briefly
    // redirecting an already mounted route during background revalidation.
    if (isNewIdentity) {
      const metadata = session.user.user_metadata ?? {};
      const displayName = normalizeDisplayName(metadata.display_name) || normalizeDisplayName(metadata.full_name);
      const passwordSet = metadata.password_set === true;
      const needsProfileSetup = !passwordSet || !displayName;
      setAuthUser({
        uid: session.user.id,
        email: session.user.email ?? '',
        displayName,
        passwordSet,
        forcePass: metadata.must_change_password === true || needsProfileSetup,
        needsProfileSetup,
        signupKind: typeof metadata.signup_kind === 'string' ? metadata.signup_kind : null,
      });
    }
  }, []);

  useEffect(() => {
    const uid = authUser?.uid;
    if (!uid) {
      checkedPlatformAdminUidRef.current = null;
      setPlatformAdmin(null);
      return;
    }
    if (checkedPlatformAdminUidRef.current === uid) return;

    checkedPlatformAdminUidRef.current = uid;
    const controller = new AbortController();
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('is_platform_admin').abortSignal(controller.signal);
        if (controller.signal.aborted || currentUserIdRef.current !== uid) return;
        if (error) {
          console.error('[Auth] platform admin check failed:', error);
          setPlatformAdmin({ uid, isAdmin: false });
          return;
        }
        setPlatformAdmin({ uid, isAdmin: data === true });
      } catch (error: unknown) {
        if (controller.signal.aborted || currentUserIdRef.current !== uid) return;
        console.error('[Auth] platform admin check failed:', error);
        setPlatformAdmin({ uid, isAdmin: false });
      }
    })();

    return () => controller.abort();
  }, [authUser?.uid]);

  const requestProfile = useCallback((session: Session, refreshData = false): Promise<boolean> => {
    if (!mountedRef.current) return Promise.resolve(false);
    activateSession(session);
    const previouslyVerifiedAuth = authRef.current;
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
        const metadata = session.user.user_metadata ?? {};
        const displayName = loaded.profile.displayName;
        const passwordSet = metadata.password_set === true;
        const needsProfileSetup = !passwordSet || !displayName;
        setAuthUser({
          uid: session.user.id,
          email: session.user.email ?? '',
          displayName,
          passwordSet,
          forcePass: metadata.must_change_password === true || needsProfileSetup,
          needsProfileSetup,
          signupKind: typeof metadata.signup_kind === 'string' ? metadata.signup_kind : null,
        });
        setDatabaseActor(session.user.id);
        void syncOfflineMutations();
        setAuth(loaded);
        if (job.refreshData) setRefetchToken(token => token + 1);
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        if (previouslyVerifiedAuth && authRef.current === previouslyVerifiedAuth) {
          console.warn('[Auth] Background profile refresh failed; keeping the last verified account.');
          return false;
        }
        authRef.current = null;
        setDatabaseActor(null);
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
    const previouslyVerifiedAuth = authRef.current;
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
        if (!previouslyVerifiedAuth || authRef.current !== previouslyVerifiedAuth) {
          authRef.current = null;
          setAuth(null);
          setAuthError('No se pudo restablecer la conexión. Volvé a intentar en unos segundos.');
          setLoading(false);
        }
        console.warn('[Auth] Background session refresh failed; keeping the last verified account.');
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

        if (event === 'TOKEN_REFRESHED'
          && currentUserIdRef.current === session.user.id && authRef.current) return;
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
      redirectTo: `${window.location.origin}/auth/confirm?type=recovery`,
    });
    if (error) throw new Error('Error al enviar el email de recuperación.');
  };

  const refreshAuthProfile = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) throw new Error('No se pudo actualizar tu perfil. Volvé a iniciar sesión.');
    await requestProfile(session, true);
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
        isPlatformAdmin: Boolean(authUser && platformAdmin?.uid === authUser.uid && platformAdmin.isAdmin),
        isPlatformAdminLoading: Boolean(authUser && platformAdmin?.uid !== authUser.uid),
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
        refreshAuthProfile,
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
