# Spec 010: The final cut

**Date:** 28 September 2026
**Status:** Built, first real run pending
**Related:** `docs/specs/005-podcast-production-pipeline.md` steps 10 and 11; `docs/specs/009-edit-package.md`; `docs/specs/007-show-notes.md`

## Goal

The edit happens in Descript and stays there (spec 009). When it is done, the producer clicks
**Get the final cut from Descript** on the show notes page. The pipeline then:

- **Step 10:** publishes the edit, sets its loudness and keeps it.
- **Step 11:** moves the show notes' chapter and quote times onto it.

Nothing is exported or published by hand in Descript. Descript's own "Publish to YouTube" is
not used: the YouTube step (spec 005 step 13) uploads with the approved metadata and the AI
disclosure.

## Flow

1. `POST /api/studio/episodes/[id]/final` (`requireRole`). This needs approved notes and a
   finished Descript project. It sets `final.status: 'queued'` and starts the **Podcast Final
   Cut** workflow (`.github/workflows/podcast_final.yml`, input `episode_id`).
2. `agent/src/podcast/final.ts` runs:
   - **Publish (`publishing`).** `POST /jobs/publish` with the project and the "Episode"
     composition, as a 1080p video. It asks for a `private` share page, and falls back to the
     workspace default when that is not allowed (403). It then waits on `GET /jobs/{id}` for
     `download_url`. Publishing the same composition again replaces the earlier publish, so
     the share link stays the same.
   - **Master (`mastering`).** Downloads the render, then runs two passes of ffmpeg `loudnorm`
     to −14 LUFS integrated, −1 dBTP true peak and LRA 11. That is what YouTube and Spotify
     play at. The correction is one linear gain change, and the picture is copied untouched.
   - **Keep.** Saves `episodes/{id}/final/episode.mp4` in Cloud Storage, and
     `04 Final/<episode>.mp4` in Drive, beside `03 For Descript`. The optional repo variable
     `DRIVE_FINAL_FOLDER_ID` sets another folder. Running it again replaces both files in place.
   - **Re-time (`retiming`).** AssemblyAI transcribes the final cut, words only, at about
     $0.21 an hour. `lib/retime.ts` lines it up with the accepted transcript of the original:
     - Runs of four words found exactly once in each transcript are paired, and the longest
       chain of pairs that keeps its order is kept.
     - The cold open repeats lines from later in the episode, so its runs occur twice in the
       final cut and never pair.
     - Any other time is placed in proportion between the nearest pairs, so a moment inside a
       cut lands at the cut.
   - **Chapters.** The first chapter stays at 0:00, so the cold open and intro belong to it.
     A chapter that would start within 10 s of the previous one is dropped, with a warning.
     YouTube needs at least three chapters.
   - **Quotes.** Quotes are re-timed for shorts.
   - **Low coverage.** If under half the original's words are found again, a warning asks
     for a manual check.
3. It records `final.*` (`types/episode.ts`, `EpisodeFinal`):
   - `videoPath`, `driveUrl`, `shareUrl`, `durationSeconds`, `loudness`
   - `wordsPath`, `coverage`
   - `chapters` and `quotes`, each with `originalMs` and the new `startMs`
   - `projectId` and `notesVersion`, to spot a stale final cut
   - `warnings`
4. It adds the `final_transcript` cost and emails the Drive link with the new chapter list.
5. The show notes page polls `GET .../final` every 15 s while it works. It shows the Drive
   link, the length, the loudness before and after, the match rate, and each chapter's new and
   old time. It says when the final cut came from an earlier Descript project or earlier notes.

The approved notes are left as they are. Later steps (YouTube) read chapter and quote times
from `final.chapters` and `final.quotes`.

## Secrets and settings

`DESCRIPT_API_TOKEN`, `ASSEMBLYAI_API_KEY`, `PODCAST_SA_JSON`, `RESEND_API_KEY`; repo variables
`DRIVE_PROCESSED_FOLDER_ID`, `ALERT_EMAIL`, optional `DRIVE_FINAL_FOLDER_ID` and
`ASSEMBLYAI_SPEECH_MODELS`. The workflow installs ffmpeg and has 180 minutes.

## Open

- **Descript render credits.** Whether publishing uses the plan's media minutes or credits is
  not documented. Check the account after the first run.
- **Podcast audio.** Podcast apps (Apple) prefer −16 LUFS for an audio-only feed. If one is
  added, make it from the final cut with its own loudness pass.
