# Firebase Setup

Project: **`soulwisdomnetwork`** · Plan: **Blaze** · Firestore location: **`nam5`** (US central) · App Hosting region: **`us-central1`**

## How production is deployed

The site runs on **Firebase App Hosting**, which builds from GitHub automatically.

- Pushing to `main` triggers a build and rollout. There is no deploy workflow in CI — App Hosting connects to the repo directly.
- Environment variables come from `apphosting.yaml`, which maps each `NEXT_PUBLIC_FIREBASE_*` variable to a secret in Google Secret Manager.
- Note this is **App Hosting**, not the older **Firebase Hosting**. They are different products with confusingly similar names. Do not enable Firebase Hosting.

To add or rotate a secret:

```bash
firebase apphosting:secrets:set SECRET_NAME --project soulwisdomnetwork
```

Answer **Production**, and **yes** to granting the backend access. Decline the offer to add it to `apphosting.yaml` — the file already declares what the app needs.

## Local development

Create `.env.local` in the project root. Values come from the Firebase console under
**Project settings → General → Your apps → SDK setup and configuration → Config**.

```env
NEXT_PUBLIC_FIREBASE_API_KEY=paste_apiKey_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=soulwisdomnetwork.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=soulwisdomnetwork
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=soulwisdomnetwork.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=paste_messagingSenderId_here
NEXT_PUBLIC_FIREBASE_APP_ID=paste_appId_here
```

`.env.local` is gitignored. Never commit it.

The browser API key is not a secret — it ships in every client bundle and only identifies the project. Access is controlled by the Firestore rules. The **service account JSON** (`FIREBASE_SERVICE_ACCOUNT_JSON`) *is* a secret: it grants admin access and bypasses all rules.

## Security rules and indexes

Both live in this repo and are the source of truth:

- `firestore.rules` — access control
- `firestore.indexes.json` — composite indexes for the queries in `app/` and `components/`

Deploy them after any change, or the console and the repo drift apart:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project soulwisdomnetwork
```

Do **not** use Firestore's "Test mode" — it permits unrestricted reads and writes from anywhere.

## First-time project setup

Only needed when standing up a new Firebase project from scratch.

1. Create the project, upgrade to **Blaze** (App Hosting runs on Cloud Run, which Spark does not allow), and set a budget alert.
2. **Authentication** → enable Google and Email/Password.
3. **Firestore** → Create database → Production mode.
4. **Register a web app** → leave "Also set up Firebase Hosting" unchecked.
5. Create the six secrets listed in `apphosting.yaml` with the command above.
6. **App Hosting** → Create backend → connect GitHub → branch `main`, root `/` → enable automatic rollouts.
7. Deploy rules and indexes with the command above.
