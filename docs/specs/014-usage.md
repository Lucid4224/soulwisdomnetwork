# Spec 014: Usage

**Date:** 30 September 2026
**Status:** Built
**Related:** `docs/specs/005-podcast-production-pipeline.md` (costs per episode); every podcast job

## Goal

For each episode, in one place (the admin page **Usage**, `/admin/usage`):

- what it cost
- how much machine time it took
- how long it took from the video arriving to the episode being on YouTube

Episodes are shown side by side so that one can be compared with the last. A report is posted
when each episode starts and when it finishes.

## What is counted

- **Money.** Every charge the jobs record in `costs.items`, by item and by service:
  - AssemblyAI: `transcription_raw`, `final_transcript`
  - Anthropic (Claude): `show_notes`, `thumbnail_text`, `shorts_titles`
  - OpenAI: `broll_N`, `thumbnail_image`

  Every rerun adds its own item, so retries are counted.
- **Descript.** The plan covers it, so its AI credits and media minutes are shown instead of
  money.
  - Each send is logged as a `descript_send` item (usd 0, `aiCredits`, `mediaSeconds`) from
    30 Sept 2026.
  - Before that, only the last send was kept (`descript.aiCreditsUsed`), and the page says so.
- **Machine time.**
  - Every GitHub Actions run of the per-episode workflows. Each workflow names its runs
    `"<Workflow> · <episode ID>"` (`run-name`), and the server matches on that ID
    (`podcastRuns` in `lib/server/github.ts`).
  - Runs made before 30 Sept 2026 carry no ID. For those episodes the time comes from each
    step's last run in the episode record, and earlier retries are not counted; the page marks
    this with `*`.
  - Copy and transcribe is always from the record, from the video arriving to the transcript
    being ready. Ingest handles whatever is waiting, so its runs are not tied to one episode.
- **Elapsed time.** From `createdAt` (the video arriving) to `youtube.uploadedAt`, with the
  milestones in between: transcript ready, speakers accepted, notes approved, edit package,
  Descript project, final cut, thumbnail approved, on YouTube, shorts scheduled. The gaps
  between milestones show where the time went.
- **Free.** GitHub Actions (public repository), the YouTube API and Cloud Storage at this size.

`lib/usage.ts` (`analyseEpisode`, `projectUsage`) does the sums, and is shared by the server
and the jobs.

## Reports (`usage_reports`)

- **Started.** Posted by ingest once the transcript is ready, which is when the length is
  known. It says what the episode should take: money, machine time, Descript credits and
  elapsed time. These are scaled per minute of episode from the latest finished report of
  every other episode.
- **Finished.** Posted by the YouTube job after the first upload, with the full analysis.
- **Finished** on an accepted episode in the Podcast Studio (it asks first) moves the
  episode from Accepted to a **Finished** column (`episodes/{id}.finished`,
  `POST /api/studio/episodes/[id]/finished`) and posts a report as well. **Back to Accepted**
  on the Finished card undoes it; the report stays.
- **Post analysis** on the page adds a report by hand, with GitHub run times. Use it for
  episodes finished before reports existed (pt1 and pt2), or to take stock part way.

## Later

- The producer's hands-on time is not measured; elapsed time minus machine time is an upper
  bound on it.
- Descript's money cost, if the plan ever charges for overage.
