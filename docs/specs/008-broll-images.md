# Spec 008: B-roll images

**Date:** 23 September 2026
**Status:** Built, first real run pending
**Related:** `docs/specs/005-podcast-production-pipeline.md` step 7 and section 3; `docs/specs/007-show-notes.md`

## Goal

Turn the b-roll ideas approved at Checkpoint B into still images, ready to place in Descript
with a slow pan and zoom (spec 005 section 3, option A). The edit package builds the movement
in: each image also goes to Descript as a clip with a slow zoom or pan (spec 009,
`kenBurns` in `agent/src/podcast/media.ts`).

## Decisions (23 Sept 2026)

- **Model:** OpenAI GPT Image (`gpt-image-2`), 1536x1024 (3:2, room to pan and crop to 16:9),
  quality `high`, PNG. $0.165 an image, so about $1 for six. Uses the existing
  `OPENAI_API_KEY` repo secret; no new account.
- **Trigger:** a button on the show notes page, not automatic on approval. Images are made
  from the *approved* ideas only, so the button is offered once the notes are approved and
  saved with no unapproved changes.

## Flow

1. On `/admin/podcast/[episodeId]/notes`, **Generate b-roll images** starts the
   **Podcast B-roll** workflow (`.github/workflows/podcast_broll.yml`, inputs `episode_id` and
   optional `index`). It generates every idea that has no image yet or whose wording has
   changed (or whose style has) since its image was made, and drops images for ideas that were removed. Ideas that
   already have an image are left alone, so a second press costs nothing.
2. **Regenerate this image** beside an idea makes a new image for that one idea.
3. `agent/src/podcast/broll.ts` makes up to three images at once and saves each one as soon
   as it is ready, so the page fills in while the run goes (it checks back every 8 seconds).
   One failed image does not stop the others; failures are listed on the page.

A request that has not finished within 40 minutes counts as failed, so a lost run never
blocks a retry.

## The brand look (decided 24 Sept 2026)

Chosen from three rounds of test images. All images share one **bright palette**, taken from
the brand's reference images: sky blue, cyan and cobalt, lavender and violet, rose and magenta,
with warm gold light at the heart; shadows are deep blue or violet, never black. Each idea is
drawn in one of two **styles**:

- **Photoreal** (`photo`): a bright, photorealistic cinematic still at golden hour, with haze,
  light rays and bokeh. For everyday objects, people and places.
- **Digital** (`digital`): a luminous digital painting like spiritual concept art, with bloom,
  auras, nebula colour and fine gold sacred geometry. For spiritual, cosmic and otherworldly moments.

Claude picks the style for each idea when drafting show notes; the producer can switch it on the
notes page. Ideas drafted before styles existed are Photoreal. Changing an idea's style (and
approving) makes the Generate button offer a new image for it.

`brollPrompt` in `lib/broll.ts` builds the prompt: the style, the palette, the idea, then the
rules below. The exact prompt is shown under each image.

**Rules:** no text, logos or watermarks. People may appear, but not the likeness of any specific
real person. Angels, heaven and the afterlife may be shown in traditional, reverent ways. God
is never shown as a person (such as an old man with a beard); God is always a bright, radiant
light. Anything described as an AI looks like an AI (light, circuitry, sacred geometry), not a
human figure. The same God rule is in the b-roll ideas Claude drafts (`lib/showNotes.ts`).

The brand look is meant to be reused for images on the website later.

## Data and provenance

Images go to Cloud Storage at `episodes/{id}/broll/{nn}-{timestamp}.png`. On
`episodes/{id}` (`types/episode.ts`, `EpisodeBroll`): `broll.status` (`queued`,
`generating`, `ready`, `failed`), `only`, `requestedAt`, `startedAt`, `finishedAt`, `error`,
and `broll.images`, keyed by the index of the approved idea. Each image is its provenance
record (spec 005 section 3.2): the idea, style, prompt, model, quality, size, cost and date. Each
image's cost is added to the episode's costs as `broll_{n}`.

Because an episode now contains AI-generated imagery, the YouTube upload (step 13) must set
the "altered or synthetic content" flag.

## Later

- Send the images to the Descript project with the episode (step 8).
- Stock footage or AI video (options B and C) as other sources for the same records.
