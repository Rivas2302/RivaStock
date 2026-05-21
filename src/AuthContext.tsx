import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile } from './types';
import { supabase } from './lib/supabase';
import { db, clearDbCache, invalidateDbCache } from './lib/db';
import type { Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: UserProfile | null;
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

async function loadProfile(session: Session): Promise<UserProfile | null> {
  try {
    // Retry up to 3 times with backoff — the auth trigger may not have run yet
    for (let attempt = 0; attempt < 3; attempt++) {
      const profile = await db.get<UserProfile>('users', session.user.id);
      if (profile) return { ...profile, uid: session.user.id };
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    throw new Error('No se pudo cargar el perfil. Recargá la página.');
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]               = useState<UserProfile | null>(null);
  const [loading, setLoading]         = useState(true);
  const [isReady, setIsReady]         = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);
  const currentUserIdRef              = useRef<string | null>(null);

  const refetchData = useCallback(() => {
    clearDbCache();
    setRefetchToken(t => t + 1);
  }, []);

  const init = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await loadProfile(session);
        if (profile) {
          currentUserIdRef.current = profile.uid;
          setUser(profile);
        } else {
          // Profile failed to load on initial boot. Keep user null but DO NOT
          // sign out — let the user retry by reloading.
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
        // Hard logout — only when Supabase explicitly signs out.
        if (event === 'SIGNED_OUT' || !session) {
          currentUserIdRef.current = null;
          clearDbCache();
          setUser(null);
          return;
        }

        // Token refresh / user updated — keep existing user object unless the
        // underlying auth user actually changed (different uid). A profile
        // re-fetch failure here MUST NOT log the user out.
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          // Identity unchanged; nothing to do. Supabase already persisted the
          // refreshed access token to localStorage.
          if (currentUserIdRef.current === session.user.id) return;
          // Edge case: identity changed under the same listener. Fall through
          // to reload profile.
        }

        // INITIAL_SESSION / SIGNED_IN / identity changed: load profile.
        const sameUser = currentUserIdRef.current === session.user.id;
        const profile = await loadProfile(session);

        if (profile) {
          currentUserIdRef.current = profile.uid;
          setUser(profile);
          return;
        }

        // Profile load failed.
        // - If we already had a user with this id, KEEP it — this is a transient
        //   network failure, not a real logout.
        // - If we didn't have a user yet, leave it null; UI will show the
        //   login page or a profile-error state.
        if (sameUser) {
          console.warn('[Auth] Profile re-fetch failed during', event, '— preserving session.');
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
    await supabase.auth.signOut();
    setUser(null);
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
    if (error) {
      if (error.message.includes('expired') || error.message.includes('Auth')) {
        throw new Error('El link ha expirado. Por favor solicitá uno nuevo.');
      }
      throw new Error('Error al actualizar la contraseña.');
    }
    await supabase.auth.signOut();
  };

  const updateUser = (updatedUser: UserProfile) => {
    currentUserIdRef.current = updatedUser.uid;
    invalidateDbCache('users');
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, refetchToken, refetchData, login, logout, updateUser, sendResetEmail, resetPassword }}
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
