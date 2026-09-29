# Spec 006: Podcast Studio

**Date:** 23 September 2026
**Status:** Agreed, building
**Related:** `docs/specs/005-podcast-production-pipeline.md` (steps 1-4 and Checkpoint A)

## Goal

Run the podcast pipeline from one place: the website. Drive stays the drop-box for new
recordings; GitHub Actions stays the worker that does the heavy processing. Nobody needs
to open GitHub, and Drive only to drop a file in.

## Who

- **Admins** (Tom) and **producers** (Daniel) can use the Studio.
- Only admins manage members and roles.
- Roles live on `users/{uid}.role` (`'admin' | 'producer' | 'user'`). Members cannot change
  their own role (see `firestore.rules`); roles change through the Admin SDK or the
  Firebase console.
- Every Studio request is checked **on the server**: the client sends its Firebase ID
  token, the server verifies it and reads the caller's role with the Admin SDK. The
  browser's own role check is only for showing or hiding UI.

## Page 1: Pipeline dashboard (`/admin/podcast`)

One board, one column per stage:

| Backlog | To Process | Processing | Needs review | Accepted | Failed |
|---|---|---|---|---|---|
| `00 Backlog` in Drive | `01 To Process` in Drive | live stage from the episode record | speakers not yet confirmed | transcript accepted | error and stage shown |

Actions:

- **Backlog order** is set by drag and drop and stored in Firestore
  (`studio/backlog.order`: Drive file IDs). New backlog files not in the list go last.
- **Queue next**: moves the top backlog video into `01 To Process`. Any backlog video can
  also be queued directly.
- **Process now** (at the top of the To Process column): starts the ingest workflow with
  `skip_wait`, shows it running, and updates when it finishes. It is the only way ingest
  starts, apart from running the workflow by hand: the three-hourly schedule was removed on
  29 Sept 2026, so a video is brought in only when someone is ready to work on it.
- **Retry** on a failed episode (runs the workflow with `retry_file_id`).
- Links: open in Drive, open transcript Doc, resend the review email.
- Cost per episode and for the month.
- **Stuck** badge on any episode that has not moved in 24 hours (spec 005 section 5).

## Page 2: Speaker review (`/admin/podcast/[episodeId]`)

The 720p preview video beside the transcript.

- **Click a line** to jump the video there and play.
- **Speakers panel**, one row per detected voice with talk time and a play-sample button:
  - **Rename**: applies to every line of that voice.
  - **Merge** two voices that are the same person.
  - **Mark as clip**: a recording played during the episode (e.g. Joseph Banks). Stays in
    the transcript, labelled "(clip)", and is excluded from quotes and shorts later.
- **Per-line fix**: change the speaker of one line.
- **Split a line** at a word, when the speaker changes mid-line.
- **Flagged lines**: a short line from one voice between two lines of another (the
  "Boom" pattern) is highlighted, with a one-click "give to surrounding speaker".
- **Accept transcript**: saves the corrected transcript as the record, replaces the
  Google Doc content with it (Drive keeps the earlier version in its history), moves the
  episode to Accepted, and records who accepted it and when.

### Data

- AssemblyAI's output (`episodes/{id}/transcripts/raw.json`) is never changed.
- Corrections are stored on the episode as a layer over it: speaker names, merges, clip
  flags, per-line reassignments and splits.
- Accepting writes `transcripts/reviewed.json` (raw with corrections applied) and sets
  `status: 'speakers_confirmed'`, `review.acceptedBy`, `review.acceptedAt`.

## People directory

Names confirmed in review are remembered (`people/{id}`: name, kind host/guest/clip).
They are offered to AssemblyAI as candidate names on later episodes and appear in the
rename list.

## Server access

The website runs on App Hosting as `firebase-app-hosting-compute@soulwisdomnetwork`.
It needs:

- Cloud Datastore User, Storage Object User (Accept writes `reviewed.json`), and Service
  Account Token Creator (to sign short-lived links for the preview video; Storage stays
  closed to browsers).
- Content manager on the pipeline shared drive (list Backlog, move files, update Docs).
- Secret `GITHUB_ACTIONS_TOKEN`: a fine-grained token for this repository with Actions
  read and write, to start the ingest workflow and read its status.

## Build order

| PR | What |
|---|---|
| 0 | Lock `role` in Firestore rules (done) |
| 1 | Server foundation: admin/producer auth on API routes; Drive, Storage, Firestore and GitHub access from the website |
| 2 | Pipeline dashboard |
| 3 | Speaker review page and Accept, with flagged lines (built early: it was the main problem on the first episodes) |
| 4 | People directory, optional guest names at queue time, custom vocabulary for AssemblyAI |

## Decided

- Daniel gets producer access.
- Backlog order is drag to reorder.
- Accept replaces the Google Doc content; Drive version history keeps earlier versions.
- No automatic weekly backlog day; queuing stays manual.

## Later

- Upload a recording straight from the website instead of Drive.
- Zoom cloud-recording webhook so recordings arrive with nobody moving files.
