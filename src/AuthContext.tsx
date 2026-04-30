import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile } from './types';
import { supabase } from './lib/supabase';
import { db } from './lib/db';
import type { Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(session: Session): Promise<UserProfile | null> {
  try {
    const profile = await db.get<UserProfile>('users', session.user.id);
    if (profile) {
      return { ...profile, uid: session.user.id };
    }
    const userMeta: any = (session.user as any).user_metadata ?? {};
    const newProfile: UserProfile = {
      uid: session.user.id,
      email: session.user.email ?? '',
      displayName: userMeta.full_name ?? session.user.email ?? '',
      role: 'admin',
      businessName: userMeta.businessName ?? '',
      businessNameLower: (userMeta.businessName ?? '').toLowerCase(),
      currencySymbol: '$',
      darkMode: false,
      createdAt: new Date().toISOString(),
    } as UserProfile;
    const created = await db.create<UserProfile>('users', newProfile);
    return created;
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);

  const init = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await loadProfile(session);
        setUser(profile);
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
        if (session) {
          const profile = await loadProfile(session);
          setUser(profile);
        } else {
          setUser(null);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [isReady]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Email o contraseña incorrectos. Por favor verificá tus datos.');
      }
      throw new Error(error.message);
    }
  };

  const logout = async () => {
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
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      if (error.message.includes('expired')) {
        throw new Error('El link ha expirado. Por favor solicitá uno nuevo.');
      }
      throw new Error('Error al actualizar la contraseña.');
    }
  };

  const updateUser = (updatedUser: UserProfile) => setUser(updatedUser);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, updateUser, sendResetEmail, resetPassword }}
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