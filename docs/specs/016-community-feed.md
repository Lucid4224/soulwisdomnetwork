# Spec 016: Community feed

**Date:** 1 October 2026
**Status:** Built
**Related:** `docs/specs/003-member-system-mvp.md` (the first feed), `docs/specs/004-directory-and-messaging.md`

(015 is kept for Editor Light, which is being written in a fork.)

## Goal

A minimal Reddit for the Soul Wisdom Collective, with one community for now.

- Members post a **title** with **text**, an **image**, a **link** or a **YouTube video**.
- Posts and comments are voted **up or down**. The feed sorts by **Hot**, **New** or **Top**.
- Comments are **threaded**: replies nest up to 8 deep.
- Only **signed-in members with a confirmed email** can read, post, comment or vote.
- Members choose **any display name**. Their email is never shown.
- **Admins** can delete any post or comment and **ban** members.
- **Bots** are kept out by email confirmation, rate limits and Firebase App Check.

## Pages

- `/dashboard` is the feed: a "Create post" bar, Hot / New / Top, 25 posts a page with
  "Load more", and the community's about box and rules beside it on wide screens.
- `/dashboard/submit` creates a post. It has a tab for each kind: Text, Image, Link, YouTube.
- `/dashboard/post/[postId]` shows one post with its comments, best first (score, then oldest).
- `/profile/[uid]` shows a member's posts. `/profile/edit` sets their name, bio and whether
  their Google photo shows. New members land on it after signing up, to choose a name.
- `/admin` has a Ban / Unban button for each member. Admins also see **Ban author** on posts
  and **Ban** on comments.

Every page that shows community content waits for sign-in and email confirmation
(`components/feed/MemberGate.tsx`). It offers to resend the confirmation email.

## How it works

The browser never reads or writes posts, comments or votes directly: `firestore.rules`
closes them. Everything goes through the server routes in `app/api/community`, which use
`lib/server/community.ts`.

Every route starts with `requireMember()`, which checks four things:

1. The ID token is valid. A ban revokes tokens and disables the account, so a banned token
   fails here.
2. The profile is not marked `banned`, and the member has a role (`requireRole`).
3. The email is confirmed. Google accounts always are; email sign-ups must open the link.
4. Once App Check is on, an App Check token is present and valid.

The routes:

| Route | What it does |
|---|---|
| `GET /api/community/posts?sort=hot\|new\|top&after=<id>&author=<uid>` | A page of posts, with each author's current name and the viewer's votes |
| `POST /api/community/posts` (multipart) | Creates a post: `kind`, `title`, `body`, `url`, `image` |
| `GET /api/community/posts/[id]` | The post and all its comments |
| `DELETE /api/community/posts/[id]` | Deletes it, with its comments, votes and image (its author or an admin) |
| `POST /api/community/posts/[id]/vote` | `{ value: 1 \| 0 \| -1 }` |
| `POST /api/community/posts/[id]/comments` | `{ body, parentId? }` |
| `DELETE /api/community/comments/[id]` | Its author or an admin. With replies, it stays as "[deleted]" |
| `POST /api/community/comments/[id]/vote` | `{ value: 1 \| 0 \| -1 }` |
| `POST /api/admin/users/ban` | `{ uid, banned }`, admins only |

**Limits** (`lib/community.ts`):

- titles: 300 characters;
- posts: 10,000 characters;
- comments: 5,000 characters;
- images: 10 MB;
- each member can add 5 posts and 60 comments an hour (`community_limits/{uid}`).

**Images** are re-encoded on the server as WebP, at most 2000 px:

- this drops EXIF data, including where a phone photo was taken;
- only JPEG, PNG, WebP, GIF and AVIF are accepted, never SVG.

They are saved to Storage at `community/{postId}/` and shown through a Firebase download-token
link. Anyone holding the link can load the image, but only members are shown it.
`storage.rules` stay closed.

**YouTube** links are shown as a thumbnail and play inline (`youtube-nocookie.com`) when
clicked. **Links** show their domain and open in a new tab, marked `nofollow ugc`. Text is
plain: links in it become clickable, and nothing else is interpreted.

**Ranking.** Hot uses Reddit's formula (`hotRank`). Votes count on a log scale, and every 12.5
hours of age weighs as much as a tenfold drop in score. A new post starts at 1, with its
author's own upvote. Top is all-time.

**Names.** Posts store the author's uid, not their name. The server looks up each author's
current profile, so renaming updates old posts too. Staff (producers and admins) get a "Team"
badge, so nobody can pass as a host by name alone.

## Data

- `posts/{id}` holds:
  - `authorId`, `title`, `body`, `kind` (`text`, `image`, `link` or `youtube`);
  - `url`, `youtubeId`, `imageUrl`, `imagePath`;
  - `createdAt`, `score`, `hot`, `commentCount`.

  Its `votes/{uid}` subcollection holds `{ value, at }`.
- `comments/{id}` holds `postId`, `parentId`, `depth`, `authorId`, `body`, `createdAt`,
  `score` and `deleted`. Its `votes/{uid}` subcollection holds the votes.
- `users/{uid}`:
  - a member can change only `displayName` (2 to 40 characters) and `bio` (up to 500), and
    can remove `photoURL`;
  - `banned`, `bannedBy` and `bannedAt` are set only by the ban route.
- `community_limits/{uid}` holds the times of recent posts and comments. Server only.

Posts from the old feed have only `content` and `likesCount`:

- the first line of `content` becomes the title;
- the first feed request on each server instance gives them a `score` and a `hot` rank.

Old comments (`content`, no `parentId`) read as top-level comments.

## Bans

Banning a member does three things:

- it disables their Firebase Auth account, so they cannot sign in ("This account has been
  banned" on the login page);
- it revokes their sessions;
- it marks the profile `banned`.

After that:

- every server route refuses them;
- the rules refuse their direct messages (a sign-in token lasts up to an hour);
- the member directory leaves them out.

Their posts stay until someone deletes them. Staff cannot be banned: make them a Member first.
Unban restores everything.

## Bot protection: what Tom sets up

Email confirmation and the rate limits work as soon as this is deployed. **App Check** (with
reCAPTCHA Enterprise) also stops scripts that sign up or post without a real browser on this
site. It needs these steps, in this order:

1. Google Cloud console, project `soulwisdomnetwork`: **Security → reCAPTCHA → Create key**.
   - Type: Website.
   - Domains: `soulwisdomcollective.com`, plus any other domain the site is served from.
   - Leave the checkbox challenge off; the key is score-based.
   - Copy the key ID: this is the **site key**, which is public.
2. Firebase console: **App Check → Apps**. Pick the web app, choose **reCAPTCHA Enterprise**,
   paste the site key and save.
3. In `apphosting.yaml`, uncomment `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` and set it to the site key.
   Merge, then promote to main.
   - From then on, the browser sends App Check tokens and the community routes require them.
   - On `localhost` App Check stays off unless the key is in `.env.local`. If it is there,
     register a debug token.
4. Give it a day. Then, in **App Check → APIs**, check that almost all requests to
   Authentication are verified, and press **Enforce** for **Authentication**. This is what stops
   bots from signing up. You can do the same for Cloud Firestore. The podcast jobs use the
   Admin SDK, which App Check does not affect.

Step 3 must come after step 2. If the key is set before the app is registered, posting fails
with "This browser could not be checked".

## Deploying

1. Merge to staging, then promote to main, and wait for the rollout.
2. Deploy the rules:
   `firebase deploy --only firestore:rules,firestore:indexes,storage --project soulwisdomnetwork`.
   Until then, the old rules still let anyone read posts directly. Deploying them before the
   new site is live would break the old feed.

No new indexes are needed: the queries use single fields or the existing
`posts (authorId, createdAt)`.

## Not yet

- More than one community.
- Editing a post or comment after posting.
- Reporting a post to the admins.
- Notifications for replies.
- Link previews (title and image from the linked page).
- Search.
