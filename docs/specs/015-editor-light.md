# 015. Editor Light

A light editor for the podcast Studio: text-based editing with filler/pause detection, an ffmpeg render job, and a Studio wire-up behind a feature flag.

## What is done

- **Phase 1 — edit logic (`lib/edit.ts`, `lib/edit.test.ts`):** `Cut`, `EpisodeEdit`, `keepRanges`, `editedTime`, `editedDuration`, `suggestCuts`, `applyToChapters`, `applyToQuotes`. Tests cover merging, padding, tiny fragments, times at and inside cuts, fillers, repeats, pauses, and an empty edit. 30/30 pass.
- **Phase 2 — render job (`agent/src/podcast/editRender.ts`, `agent/src/podcast/editRender.test.ts`, `.github/workflows/podcast_edit_render.yml`):** `renderEdit()` cuts the episode with `keepRanges`, pre-renders b-roll with `kenBurns` from `media.ts`, overlays at edited times, applies audio cleanup (highpass → afftdn → acompressor → `normalizeLoudness`), joins teasers → intro → edited → outro at 1920x1080/30fps/AAC 48kHz, and writes a JSON report. `--clean off|light|strong` is supported. The workflow is `workflow_dispatch` with a TODO for downloading the real episode. Test passes: 1/1.
- **Phase 3 — editor component (`components/studio/editor.tsx`):** `Editor({ words, videoUrl, edit, onChange })` — transcript by speaker, struck-through cuts, cuttable pause chips, click to seek, drag and shift-click selection, Delete/Backspace to cut, click a cut to restore, undo/redo, suggest/clear buttons with counts per reason, video preview that skips cuts, edited length and time saved, `content-visibility: auto` for performance, Studio styling.
- **Phase 4 — wire-up (`types/episode.ts`, `app/api/studio/episodes/[id]/edit/route.ts`, `app/admin/podcast/[episodeId]/notes/page.tsx`):** `EpisodeNotes.edit` added, API route with `requireRole` and version check (409), editor part in the "Edit package and Descript" stage behind `NEXT_PUBLIC_EDITOR_LIGHT=1`. Compile-checked, not run against Firebase.

## How it was tested

- **Card 1:** `npx tsx --test lib/edit.test.ts` — 30/30 pass.
- **Card 2:** `npx tsx --test agent/src/podcast/editRender.test.ts` — 1/1 pass (generates a 20s testsrc+sine video, 2s teaser, 2s intro, one PNG b-roll, renders with 3 cuts, teaser, intro, outro, b-roll, `--clean light`; checks output length ±150ms, one 1920x1080 video stream, one 48kHz audio stream, JSON report exists).
- **Card 3:** `npx tsc --noEmit` and `npx eslint components/studio/editor.tsx` — both pass.
- **Card 4:** `npm run build` — (run as part of the final step).

## Known gaps

- The render test takes ~253 seconds due to afftdn + normalizeLoudness on a 1GB machine. On a CI runner it should be faster.
- The editor component (`components/studio/editor.tsx`) is not connected to the real Studio data flow — it's a controlled component behind `NEXT_PUBLIC_EDITOR_LIGHT=1` showing only a placeholder part in the notes page.
- The GitHub Actions workflow (`podcast_edit_render.yml`) has a TODO for downloading the real episode — the script itself is complete and tested locally.
- The `useAutosave` hook is not wired to the editor — the notes page shows a static placeholder, not the live `Editor` component, because the real data flow (words, video URL) needs the Studio context.

## Suggested next step

Wire the `Editor` component into the notes page behind the feature flag: load `EpisodeNotesView.words` and the episode video URL, pass them to `Editor`, and connect `onChange` to `useAutosave` calling the edit API route. Then test the full flow against Firebase staging.
