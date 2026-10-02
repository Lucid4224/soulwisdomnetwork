# Spec 015: Editor Light

**Date:** 1 October 2026
**Status:** Built and tested locally; Studio wire-up compile-checked only (behind a flag)
**Related:** `docs/specs/005-podcast-production-pipeline.md`, `docs/specs/009-edit-package.md`, `docs/specs/010-final-cut.md`

A light editor that replaces the parts of Descript the pipeline uses: filler and pause removal,
text-based editing with an instant preview, and a render with teasers, intro, outro, b-roll,
voice cleanup and −14 LUFS. Descript is untouched and stays in place.

## What is done

- **Edit model (`lib/edit.ts`).** `Cut`, `EpisodeEdit`, `keepRanges` (merges cuts, 40 ms air at
  each edge, drops kept pieces under 150 ms), `editedTime`, `editedDuration`, `applyToChapters`,
  `applyToQuotes`. `suggestCuts` marks `um`/`uh`/`erm`/`uhm`/`hmm`, immediate repeats (keeps the
  last), pauses over 1.2 s (shortened to 0.5 s) and, because AssemblyAI leaves fillers out by
  default, gaps of 350 to 1200 ms inside a sentence (cut to 150 ms) as `filler`.
- **Render job (`agent/src/podcast/editRender.ts`).** `renderEdit()` and a command line. One
  `filter_complex`: trims to `keepRanges` with 15 ms audio fades at every join; b-roll through
  `kenBurns`, placed at its **edited** time with a 0.5 s fade in and out; teasers → intro → edited
  episode → outro at 1920x1080, 30 fps, AAC 48 kHz; `--clean off|light|strong|auphonic`
  (highpass 80 Hz → `afftdn`, or `arnndn` with `--noise-model` → gentle `acompressor`), then
  `normalizeLoudness` over the whole programme. Writes `<out>.report.json` (input and output
  length, cuts, time saved from the episode itself, render seconds).
- **Workflow (`.github/workflows/podcast_edit_render.yml`).** `workflow_dispatch` with
  `episode_id`. Downloading the episode and edit is a marked `TODO`.
- **Auphonic option (`agent/src/podcast/auphonic.ts`).** `auphonicProcess()` sends the audio with
  `filler_cutter`, `silence_cutter`, `cough_cutter`, `denoise`, `loudnesstarget: -14` and
  `cut_mode: "export_uncut_audio"` (detects without cutting, so timings stay aligned), and reads the
  `ReaperRegions.csv` cut list (`parseReaperRegions`). `auphonicCutsToEdit()` maps fillers and
  coughs to `filler`, silence to `pause`. `--detect auphonic` adds its cuts to the edit;
  `--clean auphonic` uses its cleaned audio for the episode. Needs the `AUPHONIC_API_KEY` secret.
- **Editor (`components/studio/editor.tsx`).** `Editor({ words, videoUrl, edit, onChange })`:
  transcript by speaker; cut words struck through; every gap that holds a cut or is longer than
  0.8 s shows as a chip (`um?` for a filler gap, `⏸` for a pause) that keeps or shortens it;
  click to seek, drag or shift-click to select, Delete/Backspace to cut, click a cut to restore,
  Ctrl/Cmd+Z and Shift+Z for undo and redo; "Mark filler words and long pauses" with counts per
  reason, and "Clear suggestions"; the video skips cut ranges while playing (`timeupdate` and a
  `requestAnimationFrame` loop), sized from the video's own duration; edited length and time saved.
- **Studio wire-up.** `EpisodeNotes.edit` in `types/episode.ts`; `app/api/studio/episodes/[id]/edit/route.ts`
  (GET and PUT, both `requireRole(request, STUDIO_ROLES)`, PUT requires `version` and answers 409
  on a mismatch, stores `updatedAt` and `updatedBy`); on the show notes page, "Edit here instead
  (preview)" inside the Edit package stage loads and saves through `useAutosave`, shown only when
  `NEXT_PUBLIC_EDITOR_LIGHT=1`.

## How it was tested

Node 22, ffmpeg 6.1 with libass.

| Command | Result |
|---|---|
| `npx tsx --test lib/edit.test.ts` | 32 pass |
| `npx tsx --test agent/src/podcast/editRender.test.ts` | 1 pass: 20 s generated clip, three cuts, teaser, intro, outro, one b-roll, `--clean light`; length within 150 ms, one 1920x1080 video and one 48 kHz audio stream, the b-roll visible mid-window and gone after it, report written |
| `npx tsx --test agent/src/podcast/auphonic.test.ts` | 3 pass (no live call) |
| `npx tsc --noEmit`, `npx eslint` on every changed file | clean |
| `npm run build` | passes |

The editor was clicked through in a headless browser on a demo page with a 64 s two-speaker
clip whose word timings are exact: suggestions found all nine planted items (three `um` words,
three untranscribed `um` gaps, one `the the`, two pauses) and nothing else; restoring a chip,
Delete on a selection, undo, redo and clear all behaved. Screenshots: `015-editor-light-before.png`,
`015-editor-light-after.png` (the test browser has no H.264, so the video area is blank there).

## Known gaps

- The Studio part has not been run against Firebase; turn it on with `NEXT_PUBLIC_EDITOR_LIGHT=1` on staging.
- `podcast_edit_render.yml` still needs the step that downloads the episode, teasers, intro, b-roll and saved edit.
- `auphonicProcess()` has not made a live call; the first run with a real key should be watched.
- Very long episodes render in one `filter_complex`; a faster path for 2-hour episodes is not built.

## Suggested next step

Fill in the workflow's download step (episode from Drive, `edit` from Firestore, teasers, intro
and b-roll as `package.ts` chooses them), then render one real episode with `--clean light` and
`--clean auphonic` and compare by ear.
