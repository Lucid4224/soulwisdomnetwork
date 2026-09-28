# Spec 011: Thumbnails and Checkpoint D

**Date:** 28 September 2026
**Status:** Built, first real run pending
**Related:** `docs/specs/005-podcast-production-pipeline.md` step 12 and "Thumbnails" in section 3; `docs/specs/010-final-cut.md`; `docs/specs/008-broll-images.md`

## Goal

Three thumbnail options per episode, as spec 005 asks:

- a **frame** from the episode
- an **AI image**
- a **brand template**

Each carries a short text. A person picks one at **Checkpoint D** and approves the episode for
the YouTube upload (step 13). Thumbnails drive more views than anything else in the pipeline,
so this checkpoint stays human.

## Decisions (28 Sept 2026)

- **Text:** a short hook of 2 to 5 words, not the title. YouTube shows the title beside the
  thumbnail, and 70 characters cannot be read at thumbnail size. Claude suggests five, and the
  producer picks one or edits it. Words in `*asterisks*` are drawn in gold. All three options
  carry the same text.
- **Frame:** the producer picks from about eight frames of the final cut, taken at the
  strongest quotes. A single automatic frame too often catches a blink or a word.
- **Brand:** Outfit Black (the site's heading font), white with a dark outline and glow, gold
  (`#f7c65b`) for key words and a gold rule, the oval logo, and the b-roll palette. This
  settles spec 005 decision 5 for thumbnails; captions are still open.

## Flow

1. On the show notes page, **Make thumbnail options** calls `POST /api/studio/episodes/[id]/thumbnails`
   (`requireRole`). It needs approved notes and a current final cut, meaning the final cut
   came from the Descript project and notes as they are now. It starts **Podcast Thumbnails**
   (`.github/workflows/podcast_thumbnails.yml`).
2. `agent/src/podcast/thumbnails.ts` makes the raw material:
   - **Texts.** Claude (the show notes model and effort) reads the approved title,
     description, summary and key quotes. It returns five texts and one idea for the
     background image, with a style (`HooksSchema` in `lib/thumbnail.ts`).
   - **Frames.** Frames are taken from the final cut at the re-timed quotes (`final.quotes`):
     the quotes are spaced at least 20 s apart and spread across the episode, and each frame
     is 2.5 s into its quote. ffmpeg reads each one straight from Storage through a signed
     URL, so the episode is not downloaded. Frames are 1280×720 JPEGs, and one that fails is
     skipped.
   - **AI background.** `gpt-image-2`, like the b-roll, with the brand style and palette. The
     prompt (`thumbnailImagePrompt`) asks for one bold subject in the right half and a calm
     left third for the text, and applies the same content rules as the b-roll: no text, no
     real likenesses, God as light.
   - It saves `thumbnails.*`, adds the costs (`thumbnail_text`, `thumbnail_image`) and emails a
     link. A new run replaces the earlier picks.
3. The page draws the three options on canvases in the browser
   (`components/studio/thumbnailCanvas.ts`), so a text edit or a new frame shows at once:
   - **Frame:** the frame fills the picture, with the text along the bottom and the logo top right.
   - **AI image:** the image fills the picture, with the text in the left third and the logo top right.
   - **Brand template:** a violet ground with a gold border, the logo top left, the text on the
     left and the frame in a gold-edged panel on the right. It is the same layout every
     episode, so the channel reads as one series.

   Images come through `GET .../thumbnails/image?name=` (`requireRole`) rather than Storage
   links, because a canvas cannot export pixels from another origin. The text, frame and
   option are saved as they change (`PATCH .../thumbnails`).
4. **New AI image from this idea** (about $0.17) re-runs the job with `only: image` and the
   producer's own idea and style.
5. **Checkpoint D.** The page shows the approved title, the number of chapters on the final
   cut and the chosen option.
   - **Approve episode** exports the chosen canvas as a JPEG under YouTube's 2 MB limit and
     posts it to `POST /api/studio/episodes/[id]/approval`.
   - The server checks that it is a JPEG under the limit, and that the final cut and the
     options are current. It saves the image to `episodes/{id}/thumbnails/approved-{ts}.jpg`
     and records `approval` (`types/episode.ts`, `EpisodeApproval`): the path, kind, text,
     who approved and when, and the notes version and final cut it applies to.
   - If either changes later, the approval shows as stale and asks to be approved again.
     **Withdraw approval** removes it.

The YouTube upload (step 13) will require a current approval, and will use its thumbnail with
`final.chapters`.

## Costs

About $0.20 an episode: Claude about $0.03, one image $0.165. A new AI image alone costs $0.165.

## Secrets and settings

`PODCAST_SA_JSON`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`; repo variable
`ALERT_EMAIL`. The workflow installs ffmpeg and has 30 minutes.

## Later

- Upload your own thumbnail (for example from Canva) as a fourth option.
- Measure click-through per option type once episodes are public, and drop the weakest.
