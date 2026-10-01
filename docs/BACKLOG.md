# Feature backlog

Features and fixes agreed but not built yet. Add to it when something is decided for later;
move an item into a numbered spec (`docs/specs/NNN-name.md`) when work on it starts, and delete
it here when it ships.

## Distribution

- **Post shorts (and episode clips) to other platforms.** Today the shorts go to YouTube only
  (spec 013). The same rendered files could go to:
  - **Instagram Reels**: planned in specs 005 and 013 ("Instagram later"). Posting goes through
    the Instagram Graph API, which needs a Business or Creator account linked to a Facebook Page.
  - **TikTok**: their posting API only allows private posts from apps that have not passed
    TikTok's audit, and the audit takes an unpredictable time (spec 005). Start the
    application early, and add TikTok when it clears.
  - **Others** (Facebook, LinkedIn, X) if wanted.

  Each platform needs its own sign-in secrets, a per-platform caption (from the short's title
  and the episode link), and its own schedule beside YouTube's one a day.
- **Weekly performance pull** (spec 005): views, watch time, retention and click-through for
  each episode and short, from YouTube and then the other platforms.

## Second podcast

- **Per-show settings**: YouTube channel, intro and outro, branding, Claude prompts, Drive
  folders and shorts schedule, so the Studio can run more than one show.
- Then **SETUP.md** (run your own copy), **CONTRIBUTING.md** and a **license** (Tom to choose).

## Editor Light (replacing Descript)

- Being built in a fork from `docs/specs/015-editor-light.md` (to come with the first PR).
  Turn on AssemblyAI's `disfluencies` option, or "um" and "uh" are left out of the transcript
  and cannot be found as fillers.

## Studio

- **Shorts cover-frame slider**: pick the frame YouTube shows for each short.
- **Profile editing**: members cannot change their name or bio yet. Members who sign up with
  email and password are named after the part of their email before the @ until then.

## Community site

- **People directory.**
- **Navbar** overflows on phones.

## Not code

- **Daniel** to review the privacy policy and terms.
