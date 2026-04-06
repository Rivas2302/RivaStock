import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from './types';
import { auth, db, auth_instance } from './lib/db';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  User
} from 'firebase/auth';
import { slugify } from './lib/utils';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string, businessName: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const profile = await response.json();
          setUser(profile);
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error("Session check error:", error);
      }

      // If no custom session, check Firebase (for Google users)
      const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
          const profile = await db.get<UserProfile>('users', firebaseUser.uid);
          setUser(profile);
        } else {
          setUser(null);
        }
        setLoading(false);
      });
      return unsubscribe;
    };

    checkSession();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const data = await response.json();
      throw { code: 'auth/custom', message: data.error };
    }

    const profile = await response.json();
    setUser(profile);
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth_instance, provider);
    const uid = userCredential.user.uid;
    
    let profile = await db.get<UserProfile>('users', uid);
    
    if (!profile) {
      // Create a default profile for new Google users
      const businessName = userCredential.user.displayName || 'Mi Negocio';
      const baseSlug = slugify(businessName);
      const catalogSlug = await db.getUniqueSlug(baseSlug, 'users');
      
      profile = {
        uid,
        email: userCredential.user.email || '',
        displayName: userCredential.user.displayName || '',
        role: 'admin',
        businessName,
        currencySymbol: '$',
        darkMode: false,
        createdAt: new Date().toISOString(),
        catalogSlug,
      };
      
      await db.create('users', profile);
    }
    
    setUser(profile);
  };

  const register = async (email: string, password: string, businessName: string) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, businessName })
    });

    if (!response.ok) {
      const data = await response.json();
      throw { code: 'auth/custom', message: data.error };
    }

    const profile = await response.json();
    setUser(profile);
  };

  const logout = async () => {
    // Logout from custom backend
    await fetch('/api/auth/logout', { method: 'POST' });
    // Logout from Firebase
    await auth.signOut();
    setUser(null);
  };

  const updateUser = (updatedUser: UserProfile) => {
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, register, logout, updateUser }}>
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
