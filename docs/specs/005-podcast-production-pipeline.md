# Spec 005: Podcast Production Pipeline

**Type:** Product Requirements Document
**Date:** 22 September 2026
**Status:** Draft for partner review
**Related:** `docs/research/2026-09-22-podcast-pipeline-executive-report.md` (options and costs), `docs/research/2026-09-21-podcast-pipeline-options.md` (detailed research)

---

## 1. What we are building and why

We record 45-90 minute conversations in Zoom, usually with three speakers. Today every step after "stop recording" is manual, and 20 finished episodes have never been published at all.

This document specifies a pipeline that takes a raw Zoom recording and produces a **published, polished episode with shorts** — with the machine doing the mechanical work and a person making only the judgment calls.

**The core principle:** automation prepares, humans approve. Nothing reaches the public without someone saying yes.

**The business case in one line:** the manual path costs roughly two hours of attention per episode forever; this pipeline settles at well under one, and unlocks 20 episodes of back catalogue that are currently worth nothing.

### Success criteria

| Measure | Target |
|---|---|
| Backlog | All 20 episodes published, at one a week |
| Human time per episode, steady state | Under 45 minutes |
| Time from recording to published | Under 48 hours |
| Cost per episode in software and AI | Under $5, excluding subscriptions |
| Wrong-speaker or wrong-fact content published | Zero |

---

## 2. The end-to-end flow

Fourteen steps. The numbers in brackets map to the ten steps discussed in planning.

| # | Step | Who | Stage |
|---|---|---|---|
| 1 | Recording lands in Google Drive **[1]** | Automatic | 1 |
| 2 | Pipeline copies it to our storage, makes a compressed preview copy and an audio-only file | Automatic | 1 |
| 3 | Transcribe the **raw** recording with real speaker names and word-level timings **[2]** | Automatic | 1 |
| 4 | **Checkpoint A — confirm speaker names** | Human, ~10 min | 1 |
| 5 | AI produces summary, tags, themes, topics, chapters, key quotes, title options, description, the "In this episode" teaser script, and b-roll suggestions **[3]** | Automatic | 1 |
| 6 | **Checkpoint B — approve the plan:** metadata, teaser copy, and which b-roll goes where | Human, ~10 min | 1 |
| 7 | Generate the approved b-roll images, one button on the notes page (`docs/specs/008-broll-images.md`) **[5]** | Human starts, then automatic | 1 |
| 8 | Pipeline creates one Descript project with the episode (filler words removed, Studio Sound), each approved "In this episode" clip as its own file, the b-roll images, intro, outro and a notes file. Built: a Drive folder (part 1) and the Descript project through the API (part 2), `docs/specs/009-edit-package.md` **[4]** | Human starts, then automatic | 1 |
| 9 | **Checkpoint C — the human edit, in Descript.** Descript is the final say: arrange the teaser clips, place b-roll, taste cuts, fixes | Human, 20-40 min | 1 |
| 10 | Pipeline pulls the finished cut back and normalizes loudness **[6]**. Built: "Get the final cut from Descript" publishes through Descript's API, sets −14 LUFS, and saves to Storage and `04 Final` in Drive (spec 010) | Automatic | 1 |
| 11 | **Re-transcribe the finished video.** This becomes the permanent record, and fixes the chapter times. Built in the same run: the chapter and quote times are moved onto the final cut (spec 010) | Automatic | 1 |
| 12 | Generate 3 thumbnail options; **Checkpoint D — pick one and approve the episode** **[7]**. Built: "Make thumbnail options" on the notes page (texts from Claude, frames from the final cut, an AI background), the options drawn in the Studio, and "Approve episode" (spec 011) | Human, ~7 min | 1 |
| 13 | Publish to YouTube with captions, chapters and thumbnail **[8]**. Built: "Upload to YouTube" on the notes page after Checkpoint D; uploads stay Private until YouTube's API audit passes (spec 012) | Automatic | 1 |
| 14 | Cut shorts, **Checkpoint E — review**, distribute to social **[9]** | Human, ~10 min | 2 |
| 15 | Everything stored, searchable, linked to published media **[10]**; performance pulled back weekly | Automatic | 3 & 4 |

**Descript is the final say (decided 23 Sept 2026).** Small editing choices are easier made by hand
than described to an AI, so the pipeline prepares everything and the producer assembles it in
Descript (step 9), including the teaser and intro/outro. The pipeline no longer assembles the cut
itself; step 10 only normalizes loudness. The pipeline uses Descript's REST API with an API token
(GitHub secret `DESCRIPT_API_TOKEN`, tied to the shared Descript drive), not the Descript MCP
server, which needs a browser sign-in and suits hands-on editing with an AI assistant. The API
cannot place clips on the timeline, so the teaser clips arrive as separate, numbered files.
Imports and edits draw on the Descript plan's media minutes and AI credits.

### Why we transcribe twice

This is the single most important design decision in the document, and it is not obvious.

Steps 8, 9 and 10 all change the length of the video. Removing filler words compresses the timeline unevenly — every later moment shifts by a different amount. Adding an intro pushes everything back. So a timestamp taken from the raw recording points at the wrong moment in the finished video.

Three things depend on accurate timestamps: **the shorts, the on-site transcript that seeks the video, and the YouTube chapter markers.** Without a second pass all three are quietly wrong, in a way nobody notices until a clip cuts mid-word.

The fix costs 25 cents. **The raw transcript drives the editing decisions. The finished video gets transcribed once more, and that transcript is the record.** Because we assemble the intro and outro *before* this pass, all timing maths disappears — every timestamp simply refers to the video people actually watch.

---

## 3. B-roll options

Step 5 in planning — showing a visual while a speaker describes something. This is the highest-variance part of the whole system: it has the widest cost range, the highest brand risk, and the most options.

### 3.1 The four options

| Option | Cost per episode (6 visuals) | Quality | Control | Verdict |
|---|---|---|---|---|
| **A. AI-generated images with slow pan and zoom** | **~$0.25** | Good. Avoids the uncanny motion that makes cheap AI video look bad | Full — we render it | **MVP default** |
| B. Licensed stock footage | $0 on free libraries, up to ~$30/month for premium | Real footage, but generic and often obviously stock | Full | Option |
| C. AI-generated video clips | $0.90 to $22 depending on model tier | Best when it works; uncanny when it doesn't | Full | Later option |
| D. Descript's built-in AI b-roll | Included, but draws on a shared monthly AI credit pool | Good, 5-second clips | Low — non-deterministic, runs inside Descript | Fallback only |

**We start with option A.** It is roughly the cost of a rounding error, it renders deterministically so the same episode always produces the same output, and a well-chosen still with gentle motion reads as intentional where mediocre AI video reads as cheap. On a show about spiritual experience, a bad AI rendering of something sacred is worse than no visual at all.

Options B and C stay designed-for from day one: the pipeline treats a b-roll asset as "a visual with a start time, a duration and a provenance record," so swapping in stock footage or generated video later is a configuration change, not a rebuild.

**Note on model choice for option C:** pricing ranges from about $0.03 to $0.75 per second of output depending on tier and resolution. Do not build on OpenAI's Sora 2 — it is scheduled for removal on 24 September 2026.

### 3.2 Labelling AI-generated elements

**Labelling is handled when each AI element is created, not by the pipeline.** Whoever produces an AI visual applies whatever label that asset needs at the point of making it. The pipeline treats the finished asset as given and does not add, move or verify any overlay.

Two things the pipeline does still do, because they cost nothing and are needed elsewhere:

- **Provenance record.** Every generated asset logs its model, prompt, generation date and cost against the episode. This is what feeds the per-episode spending cap and lets us regenerate a visual later.
- **Platform disclosure.** Where an episode contains AI-generated imagery, the upload step sets YouTube's "altered or synthetic content" flag. This is a platform obligation independent of anything visible in the frame.

---

## 4. The other pieces

### Intro, outro and music
Built separately by us as fixed video assets with licensed music, versioned in storage. The pipeline concatenates them — this is deterministic, free, and needs no editing tool. Changing the intro means dropping in a new file, not re-editing episodes.

**Required before Stage 1 ships:** the intro file (~3 seconds), the outro file, and written confirmation of the music licence covering both.

**Intro: done (24 Sept 2026).** `assets/podcast/intro.mp4` (3 s, 1080p), placed after the "In this episode" clips and before the episode by the edit package and the Descript step (`docs/specs/009-edit-package.md`). Still open: an outro, and written confirmation of the music licence.

### The "In this episode" teaser
AI suggests three or four clips from the episode; a producer adjusts them at Checkpoint B (spec 007). They go to Descript as separate files (step 8) and are placed by hand at Checkpoint C.

### Loudness normalization
Zoom recordings vary wildly in level. Every finished episode is normalized to the broadcast target YouTube expects, applied at final assembly as a safety net regardless of what happened upstream. Descript's Studio Sound handles noise and room echo; this handles level.

### Captions
Generated from the re-transcribe pass and uploaded to YouTube as a proper caption file. Better than YouTube's automatic captions, helps search, and is the accessible default.

### Thumbnails
Three options generated per episode — one frame grab from a strong moment, one AI-generated image, one branded template with the episode title. A human picks one at Checkpoint D. Thumbnails drive more views than anything else in this pipeline, so this checkpoint stays human indefinitely.

### Social distribution
YouTube Shorts and Instagram at Stage 2. **TikTok is deliberately excluded for now:** their posting API restricts unaudited applications to private-only posts, and lifting that requires an audit process with unpredictable lead time. We will start that application separately and add TikTok when it clears.

---

## 5. Failure handling

Pipelines that run unattended fail unattended. This is specified, not assumed.

| Requirement | Behaviour |
|---|---|
| **State** | Every episode records exactly which stage it reached. Any step can be re-run from the last good state without redoing earlier work |
| **Transient failures** | Network errors and service timeouts retry automatically with increasing delays |
| **Permanent failures** | Bad input, quota exhaustion or rejected uploads stop the episode and raise an alert — no silent retries |
| **Alerting** | A Slack message naming the episode, the stage, the error, and a link to retry |
| **Stuck work** | Any episode that has not advanced in 24 hours is flagged on the review page |
| **Cost guard** | A per-episode spending cap. Exceeding it halts the episode and alerts rather than continuing to spend |
| **No double-charging** | Re-running a step never regenerates a paid asset that already exists, and never double-posts to a platform |

---

## 6. Stages

Deliberately sequenced so that **the first stage is a complete working system**, not a foundation. Each stage ends somewhere we could stop and still have value.

### Stage 0 — Foundations (half a day)

Dependency updates (one package is end-of-life), service accounts, the four Zoom recording checks, and a 50-cent pilot on two backlog episodes to measure how often speaker naming gets it wrong. That single number tells us whether to budget 5 or 15 minutes per episode for Checkpoint A.

**Also required here:** intro file, outro file, music licence confirmation, brand colours and fonts for thumbnails and captions.

### Stage 1 — MVP: the system, end to end (9-12 days)

**Everything in section 2, steps 1 to 13, working end to end on a real episode.**

Approvals happen on a single minimal review page — a list of episodes by status, and one screen per episode holding all four checkpoints. Deliberately not the full searchable website; it is a strict subset of it, so nothing built here is thrown away in Stage 3.

**Definition of done:** the first backlog episode is published to YouTube with captions, chapters, a chosen thumbnail and correct speaker attribution; a second episode runs through needing no code changes; and the weekly slot is scheduled.

### The backlog rhythm — one episode a week, about five months

The backlog is an **operating rhythm, not a project phase.** It starts the week Stage 1 ships and runs alongside Stages 2, 3 and 4.

| | Per episode | Per week | Across all 20 |
|---|---|---|---|
| Human time | ~60 min | ~1 hour | ~20 hours |
| AI and storage | ~$2 | ~$2 | ~$35 |

**The full path is now the right choice.** An earlier draft recommended skipping the human edit on backlog episodes to get all 20 out quickly. At one a week that reasoning no longer holds — the full path costs about an hour a week, which is affordable, and the episodes are better for it. **Recommend the full path for backlog and new episodes alike.**

**Peak load worth planning for.** During the drain we publish one backlog episode a week *plus* the 2-4 new episodes a month — **six to eight episodes a month**, roughly double the steady-state volume this system was sized for. That means about 5-7 hours of human time a month, and it is the point at which monthly subscription allowances get tested. Both the editing and clipping tools have headroom at that rate, but the first month should be watched rather than assumed.

### Stage 2 — Shorts and social (3-4 days)

Clip selection from the re-transcribed final video, human review, rendering, and distribution to YouTube Shorts and Instagram.

**Cost:** about $29/month, either for a clipping service or a social publishing service — not both.

**Definition of done:** three approved shorts per episode published to both platforms, with nothing posted without human review.

### Stage 3 — The searchable library (3-4 days)

The full management website: browse and filter by title, speaker, tag, theme, topic or status; search across every transcript; click a transcript line to seek the video; links out to everything published. The Stage 1 review page grows into this rather than being replaced.

**Definition of done:** anyone on the team can find a moment in any episode by typing a phrase they half-remember.

### Stage 4 — Analytics loop (1-2 days)

Weekly pull of views, watch time, retention and click-through from YouTube and Instagram, attached to each episode and each clip.

**Why it matters:** this is what makes clip selection improve over time instead of staying at whatever the AI guessed in month one. Almost nobody builds this, and it is the difference between a pipeline and a system that learns.

---

## 7. Cost summary

**Per episode, steady state, once all stages are live:**

| Item | Cost |
|---|---|
| Transcription (twice) | $0.50 |
| AI analysis | $0.07 |
| B-roll visuals | $0.25 |
| Thumbnail options | $0.12 |
| Storage and infrastructure | $0.70 |
| Descript | $0 — already owned |
| **Software and AI total** | **~$2** |
| Subscriptions (shorts and social) | ~$10 per episode at 3 a month |
| **Total per episode** | **~$12** |

**Human time per episode, steady state: about 45 minutes** across five checkpoints.

**One-time:** 16-22 days of build. The backlog adds roughly $35 and about 20 hours, but spread across five months at one episode a week rather than paid up front.

**During the backlog drain,** throughput runs at six to eight episodes a month against a steady state of three. Budget for roughly double the per-episode figures above for that period.

A note on scope: this is roughly double the build estimate in the executive report. That report scoped transcripts, metadata, a website and shorts. This document adds b-roll generation, thumbnails, final assembly with intro and outro, loudness normalization, the second transcription pass, captions, failure handling and analytics. The additions are real work and real value — but they are additions, and the estimate moved accordingly.

---

## 8. Explicitly out of scope for now

| Item | Why deferred |
|---|---|
| **TikTok distribution** | Posting API requires an audit; application to be started separately |
| **Guest consent and release process** | Deferred by decision; will need addressing before publishing guest-heavy episodes with AI-augmented visuals |
| **AI-generated video clips (option C)** | Designed for, not built. Revisit once we see how images-with-motion land |
| **Clip-montage teaser** | Text card first; montage is a Stage 2+ enhancement |
| **Multi-language or dubbed versions** | Descript supports it; no demand identified |
| **Voiceprint enrolment for recurring hosts** | Would reduce Checkpoint A to near zero, but only worth it once we know the error rate from Stage 0 |

---

## 9. Decisions needed before Stage 1 starts

1. **Intro, outro and music** — who produces them, and by when? Stage 1 cannot ship without them.
2. **Who owns the checkpoints?** One person for all five, or split by type?
3. **Which day of the week is backlog day?** A fixed slot makes the rhythm stick; an unscheduled one will slip.
4. **Publish backlog episodes public or unlisted first?** Recommend unlisted for the first three, then public once we trust the output.
5. **Brand assets for thumbnails and captions** — colours, fonts, logo treatment. Thumbnails decided 28 Sept 2026: Outfit Black (the site's heading font), white with gold for key words, the oval logo, the b-roll palette (spec 011). Captions still open.
6. **Which order do the 20 backlog episodes go in?** Best-first builds an audience faster than chronological.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Wrong speaker attribution reaches the public** | Mandatory confirmation at Checkpoint A; Stage 0 pilot measures the real error rate; separate Zoom audio tracks eliminate it for future episodes |
| **AI-generated visual lands badly on spiritual subject matter** | Approval of the b-roll *plan* before anything renders, so a bad choice costs a click rather than a re-render; images-with-motion chosen over video precisely to reduce this |
| **Invented quotes or facts in summaries** | Every quote must match the transcript word-for-word or it is flagged; every timestamp range-checked |
| **Checkpoint fatigue** | Five checkpoints is the ceiling. If steady-state human time exceeds 45 minutes after ten episodes, we cut a checkpoint rather than absorbing the cost |
| **AI generation cost creep** | Per-episode spending cap that halts rather than overspends; starting with the cheapest visual option |
| **Descript round-trip breaks** | Descript is a workbench, not the record. Our storage and database hold everything; if Descript becomes unavailable the pipeline still publishes, just without the human polish pass |
