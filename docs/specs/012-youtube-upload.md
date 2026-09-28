# Spec 012: YouTube upload

**Date:** 28 September 2026
**Status:** Built, needs the YouTube sign-in set up (below), first real run pending
**Related:** `docs/specs/005-podcast-production-pipeline.md` step 13; `docs/specs/011-thumbnails.md` (Checkpoint D); `docs/specs/010-final-cut.md`

## Goal

After Checkpoint D, one button puts the approved episode on YouTube with:

- the final cut
- the approved title, and the description with the final cut's chapter times
- tags, the category, "not made for kids", and the altered-or-synthetic-content flag
- the approved thumbnail
- captions made from the final cut's own transcript

## Decisions (28 Sept 2026)

- **Upload through the YouTube Data API** now, and **apply for YouTube's API audit**. YouTube
  keeps every upload made through the API from a project created after July 2020 **Private**
  until the project passes that audit. Until then, check each upload in YouTube Studio.
- **Visibility asked for: Unlisted** (spec 005 recommends unlisted for the first backlog episodes).
  It takes effect once the audit passes. Change it to Public or schedule it in YouTube Studio.
- **Captions: ours**, built from the final cut's word timings (`final/words.json`, step 11).
  They match the edit and spell names as AssemblyAI heard them.
- **Category: Education** (27).
- No new dependency: `agent/src/podcast/youtubeApi.ts` calls the API with `fetch`.

## Flow

1. **Upload to YouTube** on the show notes page calls `POST /api/studio/episodes/[id]/youtube`
   (`requireRole`). It needs a current approval, meaning the notes and final cut are unchanged
   since Checkpoint D. It starts **Podcast YouTube Upload** (`.github/workflows/podcast_youtube.yml`).
2. `agent/src/podcast/youtube.ts` runs:
   - It builds the details with `youtubeMetadata` in `lib/youtube.ts`, which the page previews
     under "What is sent to YouTube":
     - the title, from the approved title
     - the description: `youtubeDescription` with `final.chapters` in place of the original times
     - tags, cut to YouTube's 500-character limit
     - category 27, English, not made for kids
     - `containsSyntheticMedia` is true when the episode has AI b-roll
   - **Upload:** it downloads the final cut from Storage and sends it in a resumable upload of
     64 MB chunks. After a dropped connection it asks YouTube how far it got and carries on
     from there. The video ID is saved as soon as the upload finishes, so a later failure
     never leads to a second copy.
   - **Thumbnail:** the JPEG approved at Checkpoint D. If YouTube refuses it (custom thumbnails
     need a verified channel), that is a warning, not a failure.
   - **Captions:** SRT from `lib/captions.ts`. Each caption is up to two lines of 42 characters,
     shown for 1 to 6 seconds, and breaks at pauses and at the ends of sentences. They go up
     as a track named "English", which replaces our earlier track and leaves any added by hand
     alone.
   - It waits up to 10 minutes for YouTube to accept the file, so a rejection is reported.
   - It records `youtube.*` (`types/episode.ts`, `EpisodeYoutube`): `videoId`, `url`, the
     visibility YouTube reports, the final cut and approval it was sent under, and warnings.
     It emails the link and the YouTube Studio link.
3. **Update on YouTube** (a second run) updates the same video: title, description, tags,
   thumbnail and captions. It keeps the visibility and any schedule set in YouTube Studio. It
   never uploads the video file again. If the final cut changed, the page says so: delete the
   video in YouTube Studio, use **Forget this upload** (`DELETE .../youtube`), and upload again.

## Setting up the YouTube sign-in (once, by the channel owner)

The upload acts as the channel owner, through a refresh token kept as a GitHub secret. Never
paste the client secret or the token into chat, files or commits.

1. **Google Cloud console**, project `soulwisdomnetwork`: APIs & Services → Library → enable
   **YouTube Data API v3**.
2. **Google Auth Platform → Branding / Audience:** app type External, with a name such as
   "Soul Wisdom Podcast Pipeline". Under **Data access**, add the scopes
   `https://www.googleapis.com/auth/youtube.upload` and
   `https://www.googleapis.com/auth/youtube.force-ssl`. Under **Audience**, click **Publish app**
   (In production). While the app is in Testing, refresh tokens expire after 7 days. An
   unverified app in production still works for its owner, after a "Google hasn't verified
   this app" warning.
3. **Clients → Create client → Web application.** Add the authorized redirect URI
   `https://developers.google.com/oauthplayground`.
4. **OAuth Playground** (developers.google.com/oauthplayground):
   - Under the gear icon, tick **Use your own OAuth credentials** and enter the client ID and secret.
   - Type both scopes into the box, then **Authorize APIs**.
   - Sign in as the account that owns the channel and **choose the Soul Wisdom channel** if
     asked (for a Brand Account).
   - Continue past the warning, then **Exchange authorization code for tokens**, and copy the
     refresh token.
5. **GitHub → Settings → Secrets and variables → Actions:** add `YOUTUBE_CLIENT_ID`,
   `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN`.
6. **YouTube Studio → Settings → Channel → Feature eligibility:** verify the channel by phone,
   or custom thumbnails are refused.
7. **Apply for the audit** with the YouTube API Services audit and quota extension form
   (support.google.com/youtube/contact/yt_api_form). Give the Cloud project number and say it
   is an internal tool uploading the channel's own podcast episodes. Screenshots of the
   Studio page help.

A revoked or expired sign-in fails with "the YouTube sign-in has expired or was revoked":
repeat step 4 and replace `YOUTUBE_REFRESH_TOKEN`.

## Costs

None in money. Uploads and updates come out of the project's daily YouTube API quota. The
default quota comfortably covers a few episodes a day.

## Later

- Add episodes to a podcast playlist, and set YouTube's podcast fields.
- Set a scheduled publish time from the page once the audit has passed.
- Pull views and click-through back weekly (spec 005 step 15).
