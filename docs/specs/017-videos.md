# Spec 017: Videos

**Date:** 1 October 2026
**Status:** Built
**Related:** `docs/specs/012-youtube-upload.md`, `docs/specs/013-shorts.md` (how the videos reach YouTube)

## Goal

Watch the podcast on this site instead of being sent to YouTube.

- **Every public video** on the channel (`@SoulWisdomCollective`) is listed.
- **Episodes and Shorts** each have their own tab.
- **New uploads appear by themselves**, within about half an hour.
- **Easy to use on phones and desktops**: sort by Newest, Oldest or Most viewed, and search
  titles and descriptions.

## Pages

These pages are **public**, as the videos are on YouTube.

| Page | What it shows |
|---|---|
| `/videos` | The episodes. A 16:9 grid (1 column on phones, 2 on tablets, 3 on desktops), each card with its length, views and date |
| `/videos/shorts` | The Shorts. A 9:16 grid (2 columns on phones, up to 5 on desktops) |
| `/videos/[id]` | One video, played here. It shows the title, views, date, the description with clickable links, an "Open on YouTube" link, and more videos of the same kind. These sit beside the player on desktops and below it on phones. Shorts play in a vertical player |

- **Sort and search:** both work in the browser, so changing them is instant. The whole channel
  comes with the page.
- **Navigation:** the navbar has **Videos** for everyone.
- **Home page:** "Watch the podcast", "Watch every episode" and a Videos card all link here.

**Watch pages:**

- They play only the channel's own videos. Any other ID is "not found", so nobody can use the
  page to show another video under our name.
- Upcoming premieres and live streams are left out until they have finished.
- The player is `youtube-nocookie.com`, like the feed's.

## How it works

`lib/server/channel.ts` reads the channel with the **YouTube Data API**, using an API key
(`YOUTUBE_API_KEY`) that stays on the server:

1. `channels?forHandle=SoulWisdomCollective` gives the channel and its uploads playlist.
2. `playlistItems` pages through the uploads, 50 at a time, up to 1,000 videos.
3. `playlistItems` on `UUSH<channel>` lists the Shorts. YouTube keeps this playlist for every
   channel but does not document it. If it ever disappears, anything up to 3 minutes counts as
   a short.
4. `videos` adds each video's length, views and thumbnail, 50 at a time.

**Caching and quota:**

- The result is cached for 30 minutes (`unstable_cache`, tag `channel-videos`). The pages are
  redrawn every 5 minutes from that cache, so a new upload shows within about 35 minutes.
- Each refresh uses a few units of the API's free 10,000 a day.

**When YouTube can't be read** (no key, quota used up, an outage):

- the pages say so and link to the channel;
- the failure is not cached, so the next visit tries again.

Shorts scheduled by the podcast pipeline (one a day) stay private until their time. They appear
on the next refresh after they go public.

## Setup: what Tom does, once

This must be done **before** this change reaches `main`. App Hosting refuses to build when
`apphosting.yaml` names a secret that does not exist.

1. **Get a key.**
   - Google Cloud console, project `soulwisdomnetwork`: **APIs & Services → Library**, and
     enable **YouTube Data API v3** if it isn't already.
   - Then **Credentials → Create credentials → API key**.
   - Under **API restrictions**, allow only YouTube Data API v3. Leave **Application
     restrictions** at None: the server calls it, not a browser.
   - The old scout's `YOUTUBE_API_KEY` works too, if you still have it.
2. **Store it in Secret Manager:**
   `firebase apphosting:secrets:set YOUTUBE_API_KEY --project soulwisdomnetwork`
   - Answer **Production**, and **yes** to granting the backend access.
   - Decline adding it to `apphosting.yaml`, which already has it.
3. **Deploy:** merge to staging, then promote to `main`.

## Not yet

- Making chapter times in a description jump the player to that point.
- Playlists or seasons.
- Showing the newest episode on the home page.
