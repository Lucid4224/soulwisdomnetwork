# Spec 013: Shorts

**Date:** 29 September 2026
**Status:** Built, first real run pending
**Related:** `docs/specs/005-podcast-production-pipeline.md` step 14 (Checkpoint E); `docs/specs/010-final-cut.md` (key quote times and words); `docs/specs/012-youtube-upload.md` (the YouTube sign-in)

## Goal

Vertical YouTube Shorts from each episode's key quotes, reviewed by a person before anything is
posted, without spending Descript credits:

1. The producer ticks the key quotes to make into shorts and trims them.
2. Claude writes a headline and title for each (or the producer does).
3. Our own job draws them.
4. The producer watches and approves each one (Checkpoint E).
5. The approved ones are scheduled on YouTube, one a day.

## Decisions (29 Sept 2026)

- **Shorts are picked from the key quotes**, not suggested. The first version had Claude pick five,
  which was too few to choose from; the approved key quotes (up to 40, usually about 20) are
  already a reviewed list of good moments, timed on the final cut. Claude only writes the
  headlines and titles. Decided after the first run on pt1.
- **Available once the final cut is done**, since that is what shorts are cut from. They can
  be made and scheduled before the episode is on YouTube; until it is, each short links to the
  podcast playlist.
- **Made in our pipeline, not Descript** or a clipping service. No credits and no
  subscription. Shorts are cut from the final cut, so the edit's audio fixes carry over.
- **Stacked layout.** The episode's 16:9 picture sits above large captions. Its sides are
  trimmed to **14:9** (the default) or **13:9**, chosen per episode, since Zoom recordings
  always leave room at the sides.
- **One a day, scheduled.** The approved shorts go up Private with a publish time, one a day in
  the order on the page. A new batch follows on from the last short already scheduled on any
  episode.
- **Instagram later**, from the same rendered files.
- **Brand:** Outfit Black (the site's heading font), white with gold for key words, the oval
  logo, the deep violet background and gold rules. This is the same look as the thumbnails
  (spec 011).

## The frame (1080x1920)

Top to bottom (`shortLayout` in `lib/shorts.ts`):

| y | What |
|---|---|
| 60–240 | The oval logo |
| around 350 | **Headline**, 2–6 words, `*marked*` words in gold (as on thumbnails) |
| 490 | The video, 1080 wide: 694 tall at 14:9, 748 at 13:9, between thin gold rules |
| under the video | The **speaker's name**, gold capitals |
| below that | **Captions**, a few words at a time, the word being spoken in gold |

YouTube's title and buttons cover the bottom quarter and a strip on the right, so everything
that matters sits above y = 1500. Audio is the final cut's (already at −14 LUFS), with a short
fade in and out.

## Flow

On the show notes page, under **Shorts** (`components/studio/shorts.tsx`), after the final cut is ready:

1. **Pick key quotes.** The section lists every key quote as it is timed on the final cut
   (`final.quotes`, step 11), with speaker, length and **▶** to preview it. Ticking one makes it
   a short covering the whole quote (at most three minutes), added at the end of the list;
   unticking removes it. A quote whose words are mostly missing where it should be in the final
   cut (`quoteMatch` under 0.7) is flagged: the edit probably cut it. The **AI imagery** flag is
   ticked when an AI b-roll still falls inside the quote (`showsBroll`).
2. **Edit.** Changes save as they go (`PATCH .../shorts`, with a version number, like the notes):
   - Click a word to move the nearer end of a short there. Quotes can run to two minutes; 20–60
     seconds holds viewers best, and the page marks anything longer.
   - **Write headlines and titles** (`POST .../shorts` with `{ mode: 'titles' }`, which starts
     **Podcast Shorts**, `.github/workflows/podcast_shorts.yml`, `agent/src/podcast/shorts.ts`):
     Claude (the show notes model and effort) reads the words of each short that is missing a
     headline or a title and writes them (`ShortTextsSchema`). It fills only empty fields, so
     clear one to have it rewritten.
   - Or type the headline (`*marked*` words in gold) and title yourself.
   - Tick or untick AI imagery.
   - Reorder shorts (this is the schedule order) or remove them.
   - **▶ Preview** plays that stretch of the final cut. The player shades what the crop leaves out.
3. **Draw shorts** (`mode: 'render'`) draws every short that changed since it was last drawn:
   - The job makes the backdrop once with ffmpeg: gradient, logo and gold rules.
   - It writes an ASS subtitle file per short (`shortsRender.ts`) for the headline, the speaker
     and the captions.
   - ffmpeg reads only that stretch of the final cut from Storage, trims the sides, and lays it
     over the backdrop. It burns in the text with libass, using the Outfit fonts in
     `agent/assets/fonts` (SIL Open Font License).
   - The output is H.264 at 30 fps, AAC at 48 kHz, stored at `episodes/{id}/shorts/{short}-{time}.mp4`.
   - It takes about a minute a short, then sends an email.
   - A render records exactly what it was drawn from: the ends, headline, speaker, crop and
     final cut, and the drawing version (`RENDER_VERSION`). Any change to one of those means it
     needs drawing again; bumping the version redraws every short after a fix to the drawing.
4. **Checkpoint E.** Watch each drawn short and **Approve this short**. An approval belongs to that
   render: drawing it again clears it. Approving needs a title.
5. **Schedule on YouTube** (`mode: 'upload'`, with the first time and the producer's time zone):
   - Each short links to the episode on YouTube, or to the podcast playlist (repo variable
     `YOUTUBE_PLAYLIST_ID`) if the episode is not up yet.
   - The server gives each approved short a slot one day after the one before, in page order.
     The page suggests the day after the last short already scheduled on any episode, at the same
     time of day; otherwise 5 pm tomorrow.
   - The job uploads each one Private with that `publishAt` (`youtubeApi.ts`, resumable). The
     details:
     - title: the short's title
     - description: the spoken words, "Watch the full conversation" with the episode link (or "Full
       episodes" with the playlist), two of the episode's hashtags and `#shorts`
     - tags: the episode's
     - category: Education
     - not made for kids
     - `containsSyntheticMedia`: the AI imagery flag
   - A vertical video under three minutes is a Short on YouTube; nothing else is needed.
   - Each video ID is saved as soon as its upload finishes, so a failure later never leads to a
     second copy.
   - A short on YouTube can no longer be edited or removed on the page. Change or delete it in
     YouTube Studio.

## Limits and failure

- **Quota.** Uploads are the most expensive YouTube API call; the default daily quota fits about
  six. If it runs out, the remaining shorts keep their slots and the job says so. Press
  **Schedule on YouTube** again the next day. It gives the not-yet-uploaded shorts new slots from
  the time picked.
- **A slot that has already passed** is not uploaded. The short shows the error; schedule again.
- **Related video.** The API cannot set the link shown under a Short. The description carries the
  link; to add the one under the Short too, set **Related video** in YouTube Studio.
- **Scheduled publishing needs uploads that are not locked Private.** An API project that has
  not passed YouTube's audit may have every upload kept Private (spec 012). Ours is not locked,
  as pt1 showed. If that changes, the shorts stay Private at their times until the audit passes.
- **The final cut changes.** Every short needs drawing again; check each one's ends, since
  the key quotes are re-timed onto the new cut but a short's trim is not.

## Costs

- Claude's headlines and titles: a few cents an episode (`shorts_titles` in the episode's costs).
- Drawing runs on GitHub Actions and uploading uses the API quota, so neither costs money.
- No Descript credits.

## Later

- Instagram Reels from the same files (decided: later).
- A Shorts playlist, and pulling views back weekly (spec 005 step 15).
- **Pick the cover frame with a slider** (asked for 29 Sept 2026). The still of each short is
  its first frame, which sometimes catches the speaker mid-blink. Wanted: a slider under each
  drawn short in the Studio to scrub through it and pick the frame to use as its cover.
  - Studio: a range input that seeks the rendered short's `<video>` (step 1/30 s) and saves
    `coverMs` on the short (an edit, not a render input, so it needs no redraw).
  - Job, upload mode: grab that frame from the render with ffmpeg (as `grabFrame` does for
    thumbnails, at 1080x1920) and send it with `thumbnails.set` after the upload.
  - Check first: whether YouTube accepts a custom thumbnail for a Short through the API. If
    it refuses, fall back to making the chosen frame the first frame the video shows (hold
    it for a fraction of a second at the start), which is what the Studio and many players
    show as the still. Until then, the cover can be chosen by hand in the YouTube app
    (edit the Short → Thumbnail).
