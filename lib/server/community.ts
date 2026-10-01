// The community feed (docs/specs/016-community-feed.md). Posts, comments and votes are read
// and written only here, through the Admin SDK: firestore.rules close them to the browser, so
// sign-in, email verification, bans, App Check and rate limits are all checked in one place.

import { randomUUID } from 'crypto';
import sharp from 'sharp';
import {
    FieldValue, Timestamp,
    type DocumentReference, type DocumentSnapshot, type Query,
} from 'firebase-admin/firestore';
import { hotRank, LIMITS, MAX_DEPTH, POST_KINDS, webUrl, youtubeId, type PostKind } from '@/lib/community';
import type { Author, CommunityComment, CommunityPost, FeedSort, Vote } from '@/types/community';
import type { UserRole } from '@/types/user';
import { adminAppCheck, adminBucket, adminDb } from './firebaseAdmin';
import { HttpError, MEMBER_ROLES, requireRole } from './staff';

const PAGE = 25;
const posts = () => adminDb().collection('posts');
const comments = () => adminDb().collection('comments');

// How many of each a member may add in an hour.
const HOURLY = { posts: 5, comments: 60 };

// App Check (bot protection) is on once the reCAPTCHA site key is set in apphosting.yaml.
const APP_CHECK = !!process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export const UNVERIFIED = 'Confirm your email address first: open the link we sent you';

export interface Viewer {
    uid: string;
    role: UserRole;
}

// Every community route starts here: signed in, not banned, email confirmed (Google
// accounts always are), and, once App Check is on, a real browser on this site.
export async function requireMember(request: Request): Promise<Viewer> {
    const { uid, role, emailVerified } = await requireRole(request, MEMBER_ROLES);
    if (!emailVerified) throw new HttpError(403, UNVERIFIED);
    if (APP_CHECK) {
        const token = request.headers.get('x-firebase-appcheck');
        try {
            if (!token) throw new Error('missing');
            await adminAppCheck().verifyToken(token);
        } catch {
            throw new HttpError(401, 'This browser could not be checked. Reload the page and try again');
        }
    }
    return { uid, role };
}

// ---- reading ----------------------------------------------------------------------------

const iso = (value: unknown) => (value instanceof Timestamp ? value.toDate() : new Date(0)).toISOString();

async function authors(uids: string[]): Promise<Map<string, Author>> {
    const unique = [...new Set(uids)];
    if (!unique.length) return new Map();
    const users = adminDb().collection('users');
    const snaps = await adminDb().getAll(...unique.map(uid => users.doc(uid)));
    return new Map(snaps.map(s => [s.id, {
        uid: s.id,
        name: (s.get('displayName') as string | null) || 'Member',
        photoURL: (s.get('photoURL') as string | null) ?? null,
        role: (s.get('role') as UserRole | undefined) ?? 'user',
        banned: s.get('banned') === true,
    }]));
}

const unknownAuthor = (uid: string): Author => ({ uid, name: 'Member', photoURL: null, role: 'user', banned: false });

// The viewer's vote on each of these posts or comments.
async function myVotes(refs: DocumentReference[], uid: string): Promise<Vote[]> {
    if (!refs.length) return [];
    const snaps = await adminDb().getAll(...refs.map(r => r.collection('votes').doc(uid)));
    return snaps.map(s => ((s.get('value') as Vote | undefined) ?? 0));
}

// Posts from the old feed have only `content`: its first line becomes the title.
function oldText(content: string) {
    const [first, ...rest] = content.split('\n');
    return first.length <= 120
        ? { title: first.trim() || 'Untitled', body: rest.join('\n').trim() }
        : { title: `${first.slice(0, 117)}…`, body: content };
}

function toPost(s: DocumentSnapshot, author: Author, myVote: Vote, viewer: Viewer): CommunityPost {
    const { title, body } = s.get('title') === undefined
        ? oldText((s.get('content') as string | undefined) ?? '')
        : { title: s.get('title') as string, body: (s.get('body') as string | undefined) ?? '' };
    return {
        id: s.id,
        title,
        body,
        kind: (s.get('kind') as PostKind | undefined) ?? 'text',
        url: (s.get('url') as string | undefined) ?? null,
        youtubeId: (s.get('youtubeId') as string | undefined) ?? null,
        imageUrl: (s.get('imageUrl') as string | undefined) ?? null,
        author,
        createdAt: iso(s.get('createdAt')),
        score: (s.get('score') as number | undefined) ?? 0,
        commentCount: (s.get('commentCount') as number | undefined) ?? 0,
        myVote,
        canDelete: s.get('authorId') === viewer.uid || viewer.role === 'admin',
    };
}

async function toPosts(snaps: DocumentSnapshot[], viewer: Viewer): Promise<CommunityPost[]> {
    const [people, votes] = await Promise.all([
        authors(snaps.map(s => s.get('authorId') as string)),
        myVotes(snaps.map(s => s.ref), viewer.uid),
    ]);
    return snaps.map((s, i) => {
        const uid = s.get('authorId') as string;
        return toPost(s, people.get(uid) ?? unknownAuthor(uid), votes[i], viewer);
    });
}

// Posts from the old feed have no score or hot rank, so the Hot and Top lists would leave them
// out. Give them one, once per server instance, when the counts show some are missing.
let ranked = false;
async function rankOldPosts() {
    if (ranked) return;
    const [all, withRank] = await Promise.all([
        posts().count().get(),
        posts().orderBy('hot').count().get(),
    ]);
    if (all.data().count !== withRank.data().count) {
        const writer = adminDb().bulkWriter();
        for (const s of (await posts().get()).docs) {
            if (s.get('hot') !== undefined) continue;
            const score = (s.get('likesCount') as number | undefined) ?? 0;
            const created = s.get('createdAt') instanceof Timestamp ? (s.get('createdAt') as Timestamp).toDate() : new Date(0);
            void writer.update(s.ref, { score, hot: hotRank(score, created) });
        }
        await writer.close();
    }
    ranked = true;
}

export async function listPosts(viewer: Viewer, sort: FeedSort, after: string | null, author: string | null) {
    await rankOldPosts();
    let q: Query;
    if (author) q = posts().where('authorId', '==', author).orderBy('createdAt', 'desc');
    else if (sort === 'new') q = posts().orderBy('createdAt', 'desc');
    else if (sort === 'top') q = posts().orderBy('score', 'desc');
    else q = posts().orderBy('hot', 'desc');
    if (after) {
        const cursor = await posts().doc(after).get();
        if (cursor.exists) q = q.startAfter(cursor);
    }
    const docs = (await q.limit(PAGE + 1).get()).docs;
    const page = docs.slice(0, PAGE);
    return {
        posts: await toPosts(page, viewer),
        next: docs.length > PAGE ? page[page.length - 1].id : null,
    };
}

export async function getPost(viewer: Viewer, id: string) {
    const snap = await posts().doc(id).get();
    if (!snap.exists) throw new HttpError(404, 'This post has been deleted');
    const replies = (await comments().where('postId', '==', id).get()).docs;
    const [[post], people, votes] = await Promise.all([
        toPosts([snap], viewer),
        authors(replies.map(c => c.get('authorId') as string)),
        myVotes(replies.map(c => c.ref), viewer.uid),
    ]);
    const list: CommunityComment[] = replies.map((c, i) => {
        const deleted = c.get('deleted') === true;
        const uid = c.get('authorId') as string;
        return {
            id: c.id,
            parentId: (c.get('parentId') as string | null | undefined) ?? null,
            body: deleted ? '' : ((c.get('body') ?? c.get('content') ?? '') as string),
            author: deleted ? null : (people.get(uid) ?? unknownAuthor(uid)),
            createdAt: iso(c.get('createdAt')),
            score: (c.get('score') as number | undefined) ?? 0,
            depth: (c.get('depth') as number | undefined) ?? 0,
            deleted,
            myVote: votes[i],
            canDelete: !deleted && (uid === viewer.uid || viewer.role === 'admin'),
        };
    });
    return { post, comments: list };
}

// ---- writing ----------------------------------------------------------------------------

// Counts a post or comment against the member's hourly allowance, or refuses it. Kept in
// community_limits/{uid}, which only the server can touch.
async function takeTurn(uid: string, what: keyof typeof HOURLY) {
    const ref = adminDb().collection('community_limits').doc(uid);
    const hourAgo = Date.now() - 3600_000;
    await adminDb().runTransaction(async tx => {
        const recent = (((await tx.get(ref)).get(what) as number[] | undefined) ?? []).filter(t => t > hourAgo);
        if (recent.length >= HOURLY[what]) {
            throw new HttpError(429, `That's the limit of ${HOURLY[what]} ${what} an hour. Try again a little later`);
        }
        tx.set(ref, { [what]: [...recent, Date.now()] }, { merge: true });
    });
}

const text = (value: FormDataEntryValue | null | undefined) => (typeof value === 'string' ? value.trim() : '');

// Re-encodes an upload as WebP: drops EXIF (including where a phone photo was taken), turns
// it upright, and caps its size. Only real images get through; SVG is never accepted.
async function encodeImage(file: File): Promise<Buffer> {
    if (file.size > LIMITS.imageBytes) throw new HttpError(400, 'Images can be up to 10 MB');
    const input = Buffer.from(await file.arrayBuffer());
    let out: Buffer;
    try {
        const { format } = await sharp(input).metadata();
        if (!['jpeg', 'png', 'webp', 'gif', 'avif'].includes(format ?? '')) throw new Error(format);
        out = await sharp(input, { animated: format === 'gif' || format === 'webp' })
            .rotate()
            .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer();
    } catch {
        throw new HttpError(400, 'That file is not an image we can use (JPEG, PNG, WebP, GIF or AVIF)');
    }
    return out;
}

async function saveImage(postId: string, image: Buffer) {
    // A download-token link: anyone holding it can load the image, but only members are
    // shown it. storage.rules stay closed.
    const bucket = adminBucket();
    const path = `community/${postId}/${randomUUID()}.webp`;
    const token = randomUUID();
    await bucket.file(path).save(image, {
        resumable: false,
        contentType: 'image/webp',
        metadata: { cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
    });
    return {
        imagePath: path,
        imageUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
    };
}

export async function createPost(viewer: Viewer, form: FormData): Promise<string> {
    const kind = text(form.get('kind')) as PostKind;
    const title = text(form.get('title'));
    const body = text(form.get('body'));
    const link = text(form.get('url'));
    if (!POST_KINDS.includes(kind)) throw new HttpError(400, 'Choose a kind of post');
    if (!title) throw new HttpError(400, 'Give your post a title');
    if (title.length > LIMITS.title) throw new HttpError(400, `Titles can be up to ${LIMITS.title} characters`);
    if (body.length > LIMITS.body) throw new HttpError(400, `Posts can be up to ${LIMITS.body} characters`);
    if (kind === 'text' && !body) throw new HttpError(400, 'Write something in the post');

    let url: string | null = null, video: string | null = null;
    if (kind === 'link' || kind === 'youtube') {
        if (link.length > LIMITS.url || !webUrl(link)) throw new HttpError(400, 'Paste a link starting with https://');
        url = webUrl(link)!.toString();
        video = youtubeId(link);
        if (kind === 'youtube' && !video) throw new HttpError(400, 'That is not a YouTube video link');
    }
    const file = form.get('image');
    if (kind === 'image' && !(file instanceof File && file.size)) throw new HttpError(400, 'Choose an image');
    const encoded = kind === 'image' ? await encodeImage(file as File) : null;

    await takeTurn(viewer.uid, 'posts');
    const ref = posts().doc();
    const image = encoded ? await saveImage(ref.id, encoded) : null;
    const now = Timestamp.now();
    const batch = adminDb().batch();
    batch.set(ref, {
        authorId: viewer.uid,
        title,
        body,
        kind,
        url,
        youtubeId: video,
        imageUrl: image?.imageUrl ?? null,
        imagePath: image?.imagePath ?? null,
        createdAt: now,
        score: 1,                      // the author's own upvote, as on Reddit
        hot: hotRank(1, now.toDate()),
        commentCount: 0,
    });
    batch.set(ref.collection('votes').doc(viewer.uid), { value: 1, at: now });
    await batch.commit();
    return ref.id;
}

export async function deletePost(viewer: Viewer, id: string) {
    const ref = posts().doc(id);
    const snap = await ref.get();
    if (!snap.exists) return;
    if (snap.get('authorId') !== viewer.uid && viewer.role !== 'admin') throw new HttpError(403, 'You can only delete your own posts');
    for (const c of (await comments().where('postId', '==', id).get()).docs) await adminDb().recursiveDelete(c.ref);
    await adminDb().recursiveDelete(ref);
    await adminBucket().deleteFiles({ prefix: `community/${id}/` }).catch(e => console.warn(`post ${id} images:`, e));
}

export async function addComment(viewer: Viewer, postId: string, body: string, parentId: string | null) {
    body = body.trim();
    if (!body) throw new HttpError(400, 'Write something first');
    if (body.length > LIMITS.comment) throw new HttpError(400, `Comments can be up to ${LIMITS.comment} characters`);

    let depth = 0;
    if (parentId) {
        const parent = await comments().doc(parentId).get();
        if (!parent.exists || parent.get('postId') !== postId) throw new HttpError(404, 'That comment has been deleted');
        depth = ((parent.get('depth') as number | undefined) ?? 0) + 1;
        if (depth > MAX_DEPTH) throw new HttpError(400, 'This thread is as deep as it goes');
    }
    await takeTurn(viewer.uid, 'comments');

    const ref = comments().doc();
    await adminDb().runTransaction(async tx => {
        const post = posts().doc(postId);
        if (!(await tx.get(post)).exists) throw new HttpError(404, 'This post has been deleted');
        tx.set(ref, { postId, parentId, depth, authorId: viewer.uid, body, createdAt: Timestamp.now(), score: 0 });
        tx.update(post, { commentCount: FieldValue.increment(1) });
    });
    return ref.id;
}

// A comment with replies keeps its place as "[deleted]", so the thread under it still reads.
export async function deleteComment(viewer: Viewer, id: string) {
    const ref = comments().doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.get('deleted') === true) return;
    if (snap.get('authorId') !== viewer.uid && viewer.role !== 'admin') throw new HttpError(403, 'You can only delete your own comments');
    const replies = await comments().where('parentId', '==', id).limit(1).get();
    if (replies.empty) await adminDb().recursiveDelete(ref);
    else await ref.update({ deleted: true, body: FieldValue.delete(), content: FieldValue.delete() });
    await posts().doc(snap.get('postId') as string).update({ commentCount: FieldValue.increment(-1) }).catch(() => {});
}

// One vote per member per post or comment: up, down, or cleared (0).
export async function vote(viewer: Viewer, kind: 'posts' | 'comments', id: string, value: Vote) {
    if (![-1, 0, 1].includes(value)) throw new HttpError(400, 'A vote is up, down or none');
    const ref = adminDb().collection(kind).doc(id);
    const mine = ref.collection('votes').doc(viewer.uid);
    return adminDb().runTransaction(async tx => {
        const [target, before] = await tx.getAll(ref, mine);
        if (!target.exists || target.get('deleted') === true) throw new HttpError(404, 'This has been deleted');
        const was = (before.get('value') as Vote | undefined) ?? 0;
        let score = (target.get('score') as number | undefined) ?? 0;
        if (value !== was) {
            score += value - was;
            const created = (target.get('createdAt') as Timestamp | undefined)?.toDate() ?? new Date(0);
            tx.update(ref, kind === 'posts' ? { score, hot: hotRank(score, created) } : { score });
            if (value) tx.set(mine, { value, at: Timestamp.now() });
            else tx.delete(mine);
        }
        return { score, myVote: value };
    });
}
