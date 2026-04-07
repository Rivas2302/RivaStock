import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  limit,
  getDocFromServer
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut,
  User
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile, CatalogConfig } from '../types';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db_instance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth_instance = getAuth(app);
export const storage_instance = getStorage(app);
storage_instance.maxUploadRetryTime = 10000; // 10 seconds max retry time

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth_instance.currentUser?.uid,
      email: auth_instance.currentUser?.email,
      emailVerified: auth_instance.currentUser?.emailVerified,
      isAnonymous: auth_instance.currentUser?.isAnonymous,
      tenantId: auth_instance.currentUser?.tenantId,
      providerInfo: auth_instance.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class FirebaseDB {
  async list<T extends { id?: string; uid?: string; ownerUid?: string }>(collectionName: string, ownerUid?: string): Promise<T[]> {
    try {
      let q = query(collection(db_instance, collectionName));
      if (ownerUid) {
        q = query(collection(db_instance, collectionName), where('ownerUid', '==', ownerUid));
      }
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, collectionName);
      return [];
    }
  }

  async find<T extends { id?: string; uid?: string; ownerUid?: string }>(collectionName: string, field: string, value: any, limitCount?: number): Promise<T[]> {
    try {
      let q = query(collection(db_instance, collectionName), where(field, '==', value));
      if (limitCount) {
        q = query(q, limit(limitCount));
      }
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `${collectionName}?${field}=${value}`);
      return [];
    }
  }

  async get<T extends { id?: string; uid?: string }>(collectionName: string, id: string): Promise<T | null> {
    try {
      const docRef = doc(db_instance, collectionName, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as T;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `${collectionName}/${id}`);
      return null;
    }
  }

  async create<T extends { id?: string; uid?: string }>(collectionName: string, item: T): Promise<T> {
    try {
      const id = item.id || item.uid || crypto.randomUUID();
      const docRef = doc(db_instance, collectionName, id);
      await setDoc(docRef, item);
      return item;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, collectionName);
      throw error;
    }
  }

  async update<T extends { id?: string; uid?: string }>(collectionName: string, id: string, updates: any): Promise<T> {
    try {
      const docRef = doc(db_instance, collectionName, id);
      await updateDoc(docRef, updates);
      const updated = await this.get<T>(collectionName, id);
      if (!updated) throw new Error('Not found after update');
      return updated;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${collectionName}/${id}`);
      throw error;
    }
  }

  async delete(collectionName: string, id: string): Promise<void> {
    try {
      const docRef = doc(db_instance, collectionName, id);
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
      throw error;
    }
  }

  async getUniqueSlug(baseSlug: string, collectionName: string): Promise<string> {
    try {
      let slug = baseSlug;
      let counter = 1;
      const field = collectionName === 'users' ? 'catalogSlug' : 'slug';
      
      while (true) {
        const existing = await this.find(collectionName, field, slug, 1);
        if (existing.length === 0) {
          return slug;
        }
        slug = `${baseSlug}-${counter}`;
        counter++;
        if (counter > 100) break; // Increased safety break
      }
      return slug;
    } catch (error) {
      console.error('Error generating unique slug:', error);
      return baseSlug;
    }
  }
}

export const db = new FirebaseDB();

export const auth = {
  currentUser: null as User | null,
  onAuthStateChanged: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth_instance, (user) => {
      auth.currentUser = user;
      callback(user);
    });
  },
  signOut: () => firebaseSignOut(auth_instance)
};

async function testConnection() {
  try {
    await getDocFromServer(doc(db_instance, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();
