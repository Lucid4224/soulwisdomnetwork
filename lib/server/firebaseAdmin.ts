// Admin SDK for server routes. On App Hosting it runs as the backend's service account
// (Application Default Credentials), so no key file is involved. Never import this from
// a client component: it bypasses Firestore rules.

import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Another Firebase project (someone else's copy of the Studio) is picked up from the site's own
// Firebase settings; with none, the Soul Wisdom project as before.
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'soulwisdomnetwork';
const BUCKET = process.env.PODCAST_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app';

function app(): App {
    return getApps()[0] ?? initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
}

export const adminAppCheck = () => getAppCheck(app());
export const adminAuth = () => getAuth(app());
export const adminDb = () => getFirestore(app());
export const adminBucket = () => getStorage(app()).bucket();
