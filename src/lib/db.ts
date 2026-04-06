import { Category, PriceRange, Product, Sale, StockIntake, CashFlowEntry, Order, CatalogConfig, UserProfile } from '../types';

// Mock database using localStorage
class MockDB {
  private getData<T>(key: string): T[] {
    const data = localStorage.getItem(`rivatech_${key}`);
    return data ? JSON.parse(data) : [];
  }

  private setData<T>(key: string, data: T[]) {
    localStorage.setItem(`rivatech_${key}`, JSON.stringify(data));
  }

  // Generic CRUD
  async list<T extends { id?: string; uid?: string; ownerUid?: string }>(collection: string, ownerUid?: string): Promise<T[]> {
    let data = this.getData<T>(collection);
    if (ownerUid) {
      data = data.filter(item => item.ownerUid === ownerUid);
    }
    return data;
  }

  async get<T extends { id?: string; uid?: string }>(collection: string, id: string): Promise<T | null> {
    const data = this.getData<T>(collection);
    return data.find(item => (item.id || item.uid) === id) || null;
  }

  async create<T extends { id?: string; uid?: string }>(collection: string, item: T): Promise<T> {
    const data = this.getData<T>(collection);
    data.push(item);
    this.setData(collection, data);
    return item;
  }

  async update<T extends { id?: string; uid?: string }>(collection: string, id: string, updates: any): Promise<T> {
    const data = this.getData<T>(collection);
    const index = data.findIndex(item => (item.id || item.uid) === id);
    if (index === -1) {
      throw new Error('Not found');
    }
    data[index] = { ...data[index], ...updates };
    this.setData(collection, data);
    return data[index];
  }

  async delete(collection: string, id: string): Promise<void> {
    const data = this.getData<any>(collection);
    const filtered = data.filter((item: any) => (item.id || item.uid) !== id);
    this.setData(collection, filtered);
  }

  // Specific helpers
  async getCatalogBySlug(slug: string): Promise<CatalogConfig | null> {
    const catalogs = this.getData<CatalogConfig>('catalog_configs');
    return catalogs.find(c => c.slug === slug) || null;
  }

  async getUniqueSlug(baseSlug: string, collection: string): Promise<string> {
    const data = this.getData<any>(collection);
    let slug = baseSlug;
    let counter = 1;
    while (data.some((item: any) => item.slug === slug || item.catalogSlug === slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    return slug;
  }
}

export const db = new MockDB();

// Auth Mock
export const auth = {
  currentUser: null as UserProfile | null,
  onAuthStateChanged: (callback: (user: UserProfile | null) => void) => {
    const savedUser = localStorage.getItem('rivatech_user');
    const user = savedUser ? JSON.parse(savedUser) : null;
    auth.currentUser = user;
    callback(user);
    return () => {};
  },
  signIn: (user: UserProfile) => {
    localStorage.setItem('rivatech_user', JSON.stringify(user));
    auth.currentUser = user;
  },
  signOut: () => {
    localStorage.removeItem('rivatech_user');
    auth.currentUser = null;
  }
};
