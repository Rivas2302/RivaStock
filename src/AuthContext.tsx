import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from './types';
import { auth, db, auth_instance } from './lib/db';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  confirmPasswordReset,
  verifyPasswordResetCode,
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
  sendResetEmail: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth_instance, email, password);
      const profile = await db.get<UserProfile>('users', userCredential.user.uid);
      setUser(profile);
    } catch (error: any) {
      if (error.code === 'auth/operation-not-allowed') {
        throw new Error('El inicio de sesión con Email/Contraseña no está habilitado en Firebase Console. Por favor, habilítalo en: https://console.firebase.google.com/project/gen-lang-client-0798723445/authentication/providers o usa Google Login.');
      }
      throw error;
    }
  };

  const loginWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth_instance, provider);
      const uid = userCredential.user.uid;
      
      let profile = await db.get<UserProfile>('users', uid);
      
      if (!profile) {
        // Create a basic profile if it doesn't exist
        const email = userCredential.user.email || '';
        const baseSlug = slugify(userCredential.user.displayName || email.split('@')[0]);
        const catalogSlug = await db.getUniqueSlug(baseSlug, 'users');
        
        profile = {
          uid,
          email,
          displayName: userCredential.user.displayName || email.split('@')[0],
          role: 'admin',
          businessName: userCredential.user.displayName || 'Mi Negocio',
          currencySymbol: '$',
          darkMode: false,
          createdAt: new Date().toISOString(),
          catalogSlug,
        };
        await db.create('users', profile);
      }
      
      setUser(profile);
    } catch (error: any) {
      console.error('Google Login Error:', error);
      throw error;
    }
  };

  const register = async (email: string, password: string, businessName: string) => {
    try {
      // Check for unique business name (case insensitive, trim)
      const trimmedName = businessName.trim();
      const normalizedName = trimmedName.toLowerCase();
      
      console.log('Registering business:', trimmedName, 'Normalized:', normalizedName);
      
      const existingBusinesses = await db.find<UserProfile>('users', 'businessNameLower', normalizedName, 1);
      
      console.log('Existing businesses count:', existingBusinesses.length);
      
      if (existingBusinesses.length > 0) {
        throw new Error('Este nombre de negocio ya está en uso. Elige otro.');
      }

      const userCredential = await createUserWithEmailAndPassword(auth_instance, email, password);
      const uid = userCredential.user.uid;
      
      const baseSlug = slugify(trimmedName);
      const catalogSlug = await db.getUniqueSlug(baseSlug, 'users');
      
      const newUser: UserProfile = {
        uid,
        email,
        displayName: email.split('@')[0],
        role: 'admin',
        businessName: trimmedName,
        businessNameLower: normalizedName,
        currencySymbol: '$',
        darkMode: false,
        createdAt: new Date().toISOString(),
        catalogSlug,
      };
      
      await db.create('users', newUser);
      setUser(newUser);
    } catch (error: any) {
      if (error.code === 'auth/operation-not-allowed') {
        throw new Error('El inicio de sesión con Email/Contraseña no está habilitado en Firebase Console. Por favor, habilítalo en: https://console.firebase.google.com/project/gen-lang-client-0798723445/authentication/providers o usa Google Login.');
      }
      if (error.code === 'auth/email-already-in-use') {
        throw new Error('Este email ya está registrado. Por favor inicia sesión.');
      }
      throw error;
    }
  };

  const logout = async () => {
    await auth.signOut();
    setUser(null);
  };

  const sendResetEmail = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth_instance, email);
    } catch (error: any) {
      console.error('Reset Email Error:', error);
      throw new Error('Error al enviar el email de recuperación.');
    }
  };

  const resetPassword = async (code: string, newPassword: string) => {
    try {
      await confirmPasswordReset(auth_instance, code, newPassword);
    } catch (error: any) {
      console.error('Reset Password Error:', error);
      if (error.code === 'auth/expired-action-code') {
        throw new Error('El link ha expirado. Por favor solicita uno nuevo.');
      }
      if (error.code === 'auth/invalid-action-code') {
        throw new Error('El link es inválido o ya fue utilizado.');
      }
      throw error;
    }
  };

  const updateUser = (updatedUser: UserProfile) => {
    setUser(updatedUser);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, register, logout, updateUser, sendResetEmail, resetPassword }}>
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
