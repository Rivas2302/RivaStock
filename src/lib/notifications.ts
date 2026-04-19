import { messaging, getToken, db } from './db';
import { getAuth } from 'firebase/auth';

export const requestNotificationPermission = async () => {
  try {
    if (!messaging) return null;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const token = await getToken(messaging, {
        vapidKey: 'YOUR_VAPID_KEY_HERE' // This should be replaced with actual VAPID key
      });
      console.log('FCM Token:', token);
      
      const auth = getAuth();
      const user = auth.currentUser;
      if (user) {
        await db.update('users', user.uid, { fcmToken: token });
      }
      return token;
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
  }
  return null;
};
