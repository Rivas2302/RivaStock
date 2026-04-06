import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from './types';
import { auth, db } from './lib/db';
import { preloadUserData } from './preload';
import { slugify } from './lib/utils';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, businessName: string) => void;
  logout: () => void;
  updateUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      if (u) {
        await preloadUserData(u.uid);
      }
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, businessName: string) => {
    const baseSlug = slugify(businessName);
    const catalogSlug = await db.getUniqueSlug(baseSlug, 'users');
    
    const newUser: UserProfile = {
      uid: crypto.randomUUID(),
      email,
      displayName: email.split('@')[0],
      role: 'admin',
      businessName,
      currencySymbol: '$',
      darkMode: false,
      createdAt: new Date().toISOString(),
      catalogSlug,
    };
    await db.create('users', newUser);
    auth.signIn(newUser);
    setUser(newUser);
  };

  const logout = () => {
    auth.signOut();
    setUser(null);
  };

  const updateUser = (updatedUser: UserProfile) => {
    auth.signIn(updatedUser);
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
