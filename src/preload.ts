import { UserProfile } from './types';
import { db } from './lib/db';
import { slugify } from './lib/utils';

export async function preloadUserData(uid: string) {
  // We no longer preload data for new users.
  // We only ensure the user profile has a catalogSlug if it's missing.
  const user = await db.get<UserProfile>('users', uid);
  if (user && !user.catalogSlug) {
    const catalogSlug = await db.getUniqueSlug(slugify(user.businessName), 'users');
    await db.update('users', uid, { catalogSlug });
  }
}
