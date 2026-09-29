# Spec 009: The edit package and the Descript project

**Date:** 24 September 2026
**Status:** Built, first real run pending
**Related:** `docs/specs/005-podcast-production-pipeline.md` steps 8 and 9; `docs/specs/007-show-notes.md`; `docs/specs/008-broll-images.md`

## Goal

Descript is the final say on the edit (spec 005, decided 23 Sept 2026). This step gathers
everything the producer needs for that edit into one Drive folder, built from the approved
show notes (part 1), then makes the Descript project from the same files through Descript's
API (part 2). The folder also works on its own: download it and drag it into Descript.

## What is in the folder

`03 For Descript/<episode title>/` in the pipeline shared drive, beside `02 Processed`
(or inside the folder named by the optional repo variable `DRIVE_DESCRIPT_FOLDER_ID`):

| File | What |
|---|---|
| `00 Full episode - <title>.mp4` | A Drive copy of the original recording (server-side), or its 1920x1080 fill when the recording is not 16:9 (below) |
| `00 Intro - Soul Wisdom Collective.mp4` | The show's 3-second intro, from `assets/podcast/intro.mp4` in the repo |
| `00 In this episode banner.png` | The generic "In this episode" tag, a transparent 1920x1080 PNG, for clips added by hand in Descript (below) |
| `01 In this episode - clip N (m.ss-m.ss) <speaker>.mp4` | Each approved teaser clip, cut from the original at full quality, in order, with 0.3 s before and 0.6 s after so no word is clipped, and the "In this episode" tag burned in (below) |
| `02 B-roll N at m.ss for Ns.png` | Each b-roll image, named with where it goes and for how long |
| `Notes - <title>.txt` | Chosen title; the clip order with words and files; chapters; b-roll timings, styles and reasons; key quotes |

Times are in the full, unedited episode; they shift once filler words and cuts are made. Spec
005 step 11 (re-transcribing the finished video) fixes chapter times afterwards.

## Flow

1. On `/admin/podcast/[episodeId]/notes`, **Build edit package** (offered once the notes are
   approved and saved) starts the **Podcast Edit Package** workflow
   (`.github/workflows/podcast_package.yml`, input `episode_id`, installs ffmpeg).
2. `agent/src/podcast/package.ts` finds or creates the folders, copies the full episode once,
   downloads the original from Cloud Storage to cut the clips, copies the b-roll images and
   writes the notes file. It emails `ALERT_EMAIL` the folder link.
3. **Rebuild** replaces the files in place (same names, same links) and removes clips or
   images that are no longer in the notes. The page says when the notes have been approved
   again since the last build.

Missing or out-of-date b-roll images do not stop the build; they are listed as warnings on
the page and in the email. A request that has not finished within 160 minutes counts as failed
(the workflow's limit is 150).

## Filling the frame (decided 24 Sept 2026)

Zoom recordings come in odd sizes (1920x1044, 1920x1120, 1920x1036), which show thin bars in
a 1920x1080 timeline. When the original is not 16:9 (to within 0.5%), the package makes a
1920x1080 copy that fills the frame: pixels made square, the picture **scaled evenly** until
it covers the frame, and the overflow **trimmed equally from the edges**. It is never
stretched or squashed. For 1920x1044 that is a 3.4% enlargement and about 33 px trimmed from
each side; for 1920x1120, about 20 px from top and bottom with no scaling. The teaser clips
are cut the same way. Recordings that are already 16:9 (including 640x360) are left as they
are; Descript enlarges those evenly.

The fill (`episodes/{id}/package/episode-1080p.mp4`, H.264 CRF 18, audio copied) is made
once and reused by rebuilds; it adds roughly a third of the episode's length to the first
build. `media.ts`: `videoSize`, `isWidescreen`, `fillFrame`, `cutClip(…, fill)`.

## The "In this episode" tag (decided 29 Sept 2026)

So viewers know the opening clips are moments from the conversation to come, every teaser clip
carries a lower-third in the lower left for its whole length: gold **IN THIS EPISODE** in Outfit
Black over the brand violet (slightly see-through), a gold rule on its left, and the clip's
speaker in white underneath. It is burned in when the clip is cut (`teaserBanner.ts` writes an
ASS file, `media.ts cutClip` draws it with libass and the fonts in `agent/assets/fonts`, as the
shorts do), so it is in Descript with no extra step and no credits. To change the wording or
move it, change `teaserBanner.ts` and rebuild; it cannot be edited in Descript.

The package also has the tag without a name as a transparent PNG (`00 In this episode banner.png`,
also in the Descript project's `Titles/` folder), for clips added by hand in Descript or for a
project made before the tag existed: drop it on a layer over those clips and stretch it to fit.

## The intro

The show's intro is `assets/podcast/intro.mp4` in this repo (added 24 Sept 2026: 3 s,
1920x1080, 30 fps, AAC stereo; the logo animation with "A modern conversation on
consciousness & spirituality"). To change it, replace that file; builds after the change use
the new one. A package built without it (the file missing) says so in its warnings.

## Data

On `episodes/{id}` (`types/episode.ts`, `EpisodePackage`): `package.status` (`queued`,
`building`, `ready`, `failed`), `requestedAt`, `startedAt`, `finishedAt`, `error`,
`folderId`, `folderUrl`, `notesVersion` (the approved notes version it was built from),
`files`, `warnings`, `clipPaths`, `introPath`, `bannerPath` (the generic banner), `episodePath` (the fill, or null),
`sourceSize`.

## Setup

None beyond what exists: `PODCAST_SA_JSON`, `RESEND_API_KEY`, `ALERT_EMAIL` and
`DRIVE_PROCESSED_FOLDER_ID`. The service account needs to create folders in the shared drive
(it already creates the transcript Docs there); removing old files needs Content manager, and
is reported as a warning otherwise. The workflow must be on `main` before the website can start it.

## Part 2: the Descript project

**Send to Descript** (under the edit package, offered once the package matches the approved
notes) starts the **Podcast Descript** workflow (`.github/workflows/podcast_descript.yml`),
which runs `agent/src/podcast/descript.ts` against Descript's API (`https://descriptapi.com/v1`,
reference at https://docs.descriptapi.com, open beta).

1. **Import** (`POST /jobs/import/project_media`): a new project named after the chosen title,
   in the Descript folder **Soul Wisdom Podcast**, editable by everyone on the Descript drive.
   Media come from Cloud Storage as signed links valid 36 hours: the teaser clips (the package
   job also saves them to `episodes/{id}/package/`), the original recording, and the b-roll
   images, and the intro (the package job also saves it to `episodes/{id}/package/intro.mp4`).
   Media folders in the project: `In this episode/`, `Intro/`, `Full episode/`, `B-roll/`, `Titles/`
   (the generic banner).
2. **Timeline**: one composition, **Episode** (1920x1080): the "In this episode" clips in
   order, then the intro, then the full episode (order decided 24 Sept 2026: the hook first,
   then the brand). The API places clips one after another only, so b-roll is not
   placed; its file names say where each image goes.
3. **Clean-up** (`POST /jobs/agent`): Underlord is asked to remove filler words and apply
   Studio Sound on that composition, and nothing else. If it cannot, the project still counts
   as made and the page says what to do by hand.
4. Both jobs are polled (`GET /jobs/{id}`) until they stop. The page shows the project link,
   Underlord's summary, media minutes and AI credits used, and warnings; an email goes to
   `ALERT_EMAIL`.

Each send makes a **new** project; sending again asks first, and says what the last send used. Imports and edits use the
Descript plan's media minutes and AI credits. A send that has not finished within about four
hours counts as failed.

On `episodes/{id}` (`EpisodeDescript`): `descript.status` (`queued`, `importing`, `cleaning`,
`ready`, `failed`), `projectId`, `projectUrl`, `compositionId`, `importJobId`, `agentJobId`,
`agentResponse`, `warnings`, `mediaSecondsUsed`, `aiCreditsUsed`, `notesVersion`, times, `error`.

### Changing the notes after sending (decided 29 Sept 2026)

For example, more "In this episode" clips once the project is open in Descript: edit the notes,
**Approve changes**, **Rebuild edit package**, then **Send to Descript again**. That makes a new
project, kept deliberately simple: the old project is left as it is, edits made in it do not
carry over, and the send uses the media minutes and AI credits again. The final cut, thumbnails
and shorts then come from the new project. The page says which of those steps is next whenever
the project is older than the notes or the package.

Considered and not chosen: importing only the new clips into the existing project (Descript's
import takes a `project_id`, but cannot rearrange an existing timeline, so the clips would have
to be placed by hand or by Underlord).

The show notes page lists every step under the video (**Actions**), each a link to its section.

**Setup:** the GitHub secret **`DESCRIPT_API_TOKEN`** (Descript → Settings → API tokens, tied
to the shared Descript drive). The workflow must be on `main` before the website can start it.

## Later

- Step 10: publish the finished composition through the API (`POST /jobs/publish` returns a
  download link) and normalise loudness, instead of downloading by hand.
- An outro, once there is one, after the episode on the timeline.
