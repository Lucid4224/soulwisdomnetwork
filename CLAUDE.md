# Soul Wisdom Network

Next.js community site for the Soul Wisdom podcast, plus an agent that scores YouTube
videos. A podcast production pipeline is specified but not yet built — see
`docs/specs/005-podcast-production-pipeline.md`.

**Live:** https://soulwisdomcollective.com

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · TypeScript · Firebase (Firestore, Auth,
App Hosting) · Node 24

```
app/          routes (dashboard, members, messages, profile, signal, admin, login)
components/   auth/ curate/ daily/ feed/
lib/firebase/ config.ts (client init), firestore.ts, messaging.ts
lib/server/   Admin SDK, Drive and GitHub helpers for API routes; requireRole() in staff.ts
app/api/      server routes; every one must call requireRole() (see Roles below)
context/      React context providers
agent/src/    scout.ts — YouTube scorer, runs in GitHub Actions, NOT on App Hosting
              podcast/ingest.ts — spec 005 steps 1-3, also GitHub Actions only
              podcast/notes.ts — spec 005 step 5 (show notes with Claude), GitHub Actions only;
              the prompt and call are in podcast/notesDraft.ts, shared with podcast/compareNotes.ts
              (podcast_notes_compare.yml: side-by-side models/efforts, read-only, run by hand)
              podcast/broll.ts — spec 005 step 7 (b-roll images), GitHub Actions only
              podcast/package.ts — spec 005 step 8 part 1 (edit package for Descript), GitHub Actions only
              podcast/descript.ts — spec 005 step 8 part 2 (Descript project via its API), GitHub Actions only
              podcast/final.ts — spec 005 steps 10-11 (final cut from Descript, loudness, re-timed chapters), GitHub Actions only
scripts/      make_admin.ts
docs/specs/   numbered specs, 001-010
types/
```

```bash
npm run dev      # local, needs .env.local
npm run build    # next build
npm run lint     # eslint
npx tsc --noEmit # typecheck
```

Develop locally. An App Hosting build takes ~10 minutes, so never deploy to test a change.

## Firebase

Project **`soulwisdomnetwork`** · Blaze · Firestore `nam5` · App Hosting `us-central1`

**This uses Firebase App Hosting, not Firebase Hosting.** Two different products with
confusingly similar names. App Hosting runs the app on Cloud Run and builds from GitHub.
Never enable Firebase Hosting, and never tick "Also set up Firebase Hosting" anywhere.

Pushing to `main` triggers a build and rollout automatically. There is no deploy workflow
in CI — App Hosting connects to the repo directly. Do not add one.

### Secrets

Runtime config lives in **Google Secret Manager**, mapped to env vars by `apphosting.yaml`.
Six secrets, all `FIREBASE_*`. To add or rotate one:

```bash
firebase apphosting:secrets:set SECRET_NAME --project soulwisdomnetwork
```

Answer **Production**, and **yes** to granting the backend access. Decline the offer to add
it to `apphosting.yaml` — the file already declares what the app needs.

Creating a secret in the Cloud Console instead creates it **without** the IAM binding, and
the build then fails with `fah/misconfigured-secret`. Fix with:

```bash
firebase apphosting:secrets:grantaccess SECRET_NAME \
  --project soulwisdomnetwork --backend soulwisdomnetwork
```

The agent's keys (`YOUTUBE_API_KEY`, `OPENAI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`) are
**GitHub repo secrets**, not Secret Manager, because the agent runs in Actions. They are
deliberately absent from `apphosting.yaml`.

The podcast ingest job (`podcast_ingest.yml`) uses its own service account
(`podcast-pipeline@`, roles: Cloud Datastore User + Storage Object Admin, Editor on the
`SWC Podcast Pipeline` Drive folder), not the Firebase admin key. One video file dropped
into `01 To Process` = one episode (`episodes/{driveFileId}`); it moves to `02 Processed`
when transcribed, and a "ready for speaker review" email with the readable transcript goes
to `ALERT_EMAIL`. Accepting the transcript in the Studio starts `podcast_notes.yml`
(`agent/src/podcast/notes.ts`), which drafts show notes with Claude for Checkpoint B
(`docs/specs/007-show-notes.md`); it needs the `ANTHROPIC_API_KEY` repo secret. Once notes are approved, "Generate b-roll
images" on that page starts `podcast_broll.yml` (`agent/src/podcast/broll.ts`,
`docs/specs/008-broll-images.md`), which uses `OPENAI_API_KEY`. "Build edit package" starts
`podcast_package.yml` (`agent/src/podcast/package.ts`, `docs/specs/009-edit-package.md`), which puts
the episode, teaser clips, b-roll and notes in `03 For Descript/<episode>`; "Send to Descript" then
starts `podcast_descript.yml` (`agent/src/podcast/descript.ts`), which makes the Descript project through
Descript's API with the `DESCRIPT_API_TOKEN` repo secret. Descript is the final edit (spec 005 step 9). "Get the final cut from Descript" starts
`podcast_final.yml` (`agent/src/podcast/final.ts`, `docs/specs/010-final-cut.md`), which publishes the edit through the
same API, normalizes it to −14 LUFS, saves it to `04 Final` in Drive, and moves the chapter and quote times onto it. The transcript Google Doc beside the video only works in a shared drive:
service accounts have no My Drive storage and cannot create files there. Secrets: `PODCAST_SA_JSON`,
`ASSEMBLYAI_API_KEY`, `RESEND_API_KEY`. Repo variables: `DRIVE_TO_PROCESS_FOLDER_ID`,
`DRIVE_PROCESSED_FOLDER_ID`, `ALERT_EMAIL`.

### Firestore

`firestore.rules` and `firestore.indexes.json` are the source of truth. Nothing deploys
them automatically:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project soulwisdomnetwork
```

Collections: `users`, `posts`, `comments`, `conversations`, `messages`, `feed_items`,
`channels`, `episodes` (podcast pipeline, Admin SDK only; shape in `types/episode.ts`),
`studio` (Podcast Studio settings such as the backlog order, Admin SDK only).

Two rules are load-bearing and easy to break:

- **`posts` update** allows any signed-in user to change *only* `commentCount` and
  `likesCount`. The like and comment buttons write to posts they do not own. Tightening
  this to author-only breaks both buttons.
- **`messages` read** checks conversation membership via a `get()` on the parent
  conversation, not a field on the message.

`feed_items` and `channels` are written by the scout through the Admin SDK, which bypasses
rules entirely — so they need no client write access and have none.

Never use Firestore "Test mode". It permits unrestricted reads and writes from anywhere.

Adding a query with `where` + `orderBy` on different fields needs a composite index in
`firestore.indexes.json`, or it throws at runtime.

### Roles

`users/{uid}.role` is `'user' | 'producer' | 'admin'`. Members cannot change their own role
(`firestore.rules`); admins change roles from `/admin`, which calls a server route. The
browser's role check only decides what to show. **Every API route must call
`requireRole()`** (`lib/server/staff.ts`), which verifies the ID token and reads the role
with the Admin SDK. Producers get the Podcast Studio (`/admin/podcast`); only admins manage
members.

Speaker review (`/admin/podcast/[episodeId]`) never edits `raw.json`: fixes are saved on the
episode as `corrections` (`types/episode.ts`), and `lib/transcript.ts` rebuilds the lines
from both. The page and the Accept route share that file, so what is accepted is what was
on screen.

Server routes run as the App Hosting service account
(`firebase-app-hosting-compute@`), not a key file. It has Cloud Datastore User, Storage
Object User (Accept writes `transcripts/reviewed.json`), Service Account Token Creator, and
Content manager on the pipeline shared drive. `GITHUB_ACTIONS_TOKEN` (Secret Manager) lets it start the ingest workflow.

### Auth

Google and Email/Password. Any new domain the app is served from must be added to
**Authentication → Settings → Authorized domains**, or sign-in fails there with
`auth/unauthorized-domain` while the rest of the site works normally.

The browser API key is not a secret — it ships in every client bundle. The **service
account JSON** is, and bypasses all security rules.

## Git

`main` is protected: no direct pushes, PRs required. Work flows
**feature branch → `staging` → `main`**.

Merging to `main` deploys to production. Keep PRs to one concern.

## Conventions

- Verify with `npx tsc --noEmit` and `npm run build` before pushing — a red build costs a
  ten-minute cycle.
- Specs live in `docs/specs/NNN-name.md` and are numbered sequentially.
- `.env.local` and `serviceAccountKey.json` are gitignored. Keep it that way.

## Known state

- `@google/generative-ai` is end-of-life; migrate to `@google/genai`.
- `firebase-admin` is on v14, which removed the namespaced API (`admin.firestore()`,
  `admin.credential`). Import from `firebase-admin/app` and `firebase-admin/firestore`.
- `/curate` and `/daily` are disabled stubs; `daily_harvest.yml` is manual-trigger only.
- `agent/src/test_gemini.ts` reads `GEMINI_API_KEY`, which no longer exists anywhere.
