import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Fallback for Firebase App Hosting environment
// This automatically picks up configuration provided securely by the Firebase platform
if (!firebaseConfig.apiKey && process.env.FIREBASE_WEBAPP_CONFIG) {
    try {
        const parsedConfig = JSON.parse(process.env.FIREBASE_WEBAPP_CONFIG);
        firebaseConfig = {
            apiKey: parsedConfig.apiKey,
            authDomain: parsedConfig.authDomain,
            projectId: parsedConfig.projectId,
            storageBucket: parsedConfig.storageBucket,
            messagingSenderId: parsedConfig.messagingSenderId,
            appId: parsedConfig.appId,
        };
    } catch (error) {
        console.error("Failed to parse FIREBASE_WEBAPP_CONFIG:", error);
    }
}

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// App Check (bot protection): proves requests come from this site in a real browser, using
// reCAPTCHA Enterprise. Off until NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set in apphosting.yaml
// (docs/specs/016-community-feed.md has the console steps). Set up before Auth and Firestore.
const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
const appCheck: AppCheck | null = typeof window !== "undefined" && siteKey
    ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })
    : null;

const auth = getAuth(app);
const db = getFirestore(app);

export { app, appCheck, auth, db };
