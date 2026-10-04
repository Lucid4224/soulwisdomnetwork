// Thumbnails and Checkpoint D (docs/specs/011-thumbnails.md): ask GitHub Actions for the raw
// material, keep the producer's picks, serve the images to the Studio (which draws the options
// in the browser), and record the approved thumbnail and the approval of the episode.

import { finalIsCurrent } from '@/lib/finalCut';
import { FieldValue } from 'firebase-admin/firestore';
import { BROLL_STYLE_IDS, type BrollStyle } from '@/lib/broll';
import { THUMB_KINDS, THUMB_MAX_BYTES, type ThumbKind } from '@/lib/thumbnail';
import type { Episode, EpisodeThumbnails } from '@/types/episode';
import type { ThumbnailsView } from '@/types/studio';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startThumbnails } from './github';
import { ESTIMATE_USD, withinDailyLimit } from './spending';
import { HttpError } from './staff';

// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 40 * 60_000;       // the workflow's own limit is 30 minutes
const TEXT_MAX = 60;                // a little over Claude's limit, for hand edits with asterisks
const IDEA_MAX = 600;

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

function busy(t: EpisodeThumbnails | undefined) {
    if (t?.status !== 'queued' && t?.status !== 'working') return false;
    const since = Math.max(millis(t.requestedAt) ?? 0, millis(t.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

// The final cut is current when it came from the Descript project (or, with Editor Light, the
// saved edit) and notes as they are now (lib/finalCut.ts).
function finalProblem(episode: Episode) {
    const f = episode.final;
    if (episode.notes?.status !== 'approved') return 'Approve the show notes first';
    if (f?.status !== 'ready') return 'Get the final cut first (from Descript or the Editor Light render)';
    if (!finalIsCurrent(episode)) {
        return 'The final cut is out of date; get it again first';
    }
    return null;
}

const finalAt = (episode: Episode) => millis(episode.final?.finishedAt) ?? 0;

// Everything that stands between the episode and Checkpoint D's approval.
function blockers(episode: Episode) {
    const out: string[] = [];
    const problem = finalProblem(episode);
    if (problem) out.push(problem);
    const t = episode.thumbnails;
    if (t?.status !== 'ready' || !t.frames?.length) out.push('Make the thumbnail options');
    else if (!problem && t.finalAt !== finalAt(episode)) out.push('The thumbnail options came from an earlier final cut; make them again');
    return out;
}

export async function requestThumbnails(id: string, body: { only?: unknown; idea?: unknown; style?: unknown }) {
    const onlyImage = body.only === 'image';
    let imageRequest: { idea: string; style: BrollStyle } | null = null;
    if (onlyImage) {
        const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
        if (!idea || idea.length > IDEA_MAX) throw new HttpError(400, `Describe the image in up to ${IDEA_MAX} characters`);
        if (!BROLL_STYLE_IDS.includes(body.style as BrollStyle)) throw new HttpError(400, 'Not a valid image style');
        imageRequest = { idea, style: body.style as BrollStyle };
    }
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        const problem = finalProblem(episode);
        if (problem) throw new HttpError(409, problem);
        if (busy(episode.thumbnails)) throw new HttpError(409, 'Thumbnail options are already being made');
        if (onlyImage && episode.thumbnails?.status !== 'ready' && !episode.thumbnails?.frames?.length) {
            throw new HttpError(409, 'Make the thumbnail options first');
        }
        tx.update(ref, {
            'thumbnails.status': 'queued', 'thumbnails.only': onlyImage ? 'image' : null,
            'thumbnails.imageRequest': imageRequest,
            'thumbnails.requestedAt': FieldValue.serverTimestamp(), 'thumbnails.error': null,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
    try {
        await withinDailyLimit('thumbnails', onlyImage ? ESTIMATE_USD.brollImage : ESTIMATE_USD.thumbnails, () => startThumbnails(id, onlyImage));
    } catch (error) {
        const message = `Could not start making thumbnails: ${(error as Error).message}`;
        await ref.update({ 'thumbnails.status': 'failed', 'thumbnails.error': message });
        throw new HttpError(502, message);
    }
}

// The producer's picks: the text, the frame and the option, saved as they go.
export async function saveThumbnailChoices(id: string, body: { text?: unknown; frame?: unknown; choice?: unknown }) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const t = ((await tx.get(ref)).data() as Episode | undefined)?.thumbnails;
        if (!t?.frames?.length) throw new HttpError(409, 'Make the thumbnail options first');
        const update: Record<string, unknown> = {};
        if (body.text !== undefined) {
            if (typeof body.text !== 'string' || body.text.trim().length > TEXT_MAX) throw new HttpError(400, `Keep the text to ${TEXT_MAX} characters`);
            update['thumbnails.text'] = body.text.replace(/\s+/g, ' ').trim();
        }
        if (body.frame !== undefined) {
            if (!Number.isInteger(body.frame) || (body.frame as number) < 0 || (body.frame as number) >= t.frames.length) throw new HttpError(400, 'There is no such frame');
            update['thumbnails.frame'] = body.frame;
        }
        if (body.choice !== undefined) {
            if (body.choice !== null && !THUMB_KINDS.includes(body.choice as ThumbKind)) throw new HttpError(400, 'Not a thumbnail option');
            update['thumbnails.choice'] = body.choice;
        }
        if (Object.keys(update).length) tx.update(ref, update);
    });
}

export async function getThumbnails(id: string): Promise<ThumbnailsView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const t = episode.thumbnails;
    const lost = (t?.status === 'queued' || t?.status === 'working') && !busy(t);
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    const a = episode.approval;
    const key = (path: string) => path.split('/').pop() ?? '';
    return {
        // A request whose run died reads as failed, so the page offers a retry.
        status: lost ? 'failed' : t?.status ?? null,
        only: t?.only ?? null,
        error: t?.error ?? (lost ? 'Making thumbnails did not finish. Check the Podcast Thumbnails run in GitHub Actions, then try again.' : null),
        canStart: !finalProblem(episode),
        stale: !!t?.frames?.length && episode.final?.status === 'ready' && t.finalAt !== finalAt(episode),
        hooks: t?.hooks ?? [],
        text: t?.text ?? '',
        frames: (t?.frames ?? []).map(f => ({ atMs: f.atMs, speaker: f.speaker, text: f.text, key: key(f.path) })),
        frame: t?.frame ?? 0,
        image: t?.image ? { idea: t.image.idea, style: t.image.style, prompt: t.image.prompt, key: key(t.image.path) } : null,
        choice: t?.choice ?? null,
        finishedAt: millis(t?.finishedAt),
        title: notes ? notes.titles[notes.chosenTitle] ?? null : null,
        chapterCount: episode.final?.status === 'ready' ? episode.final.chapters?.length ?? 0 : 0,
        blockers: blockers(episode),
        approval: a ? {
            by: a.approvedBy.name, at: millis(a.approvedAt) ?? 0, kind: a.kind, text: a.text, key: key(a.thumbnailPath),
            stale: a.notesVersion !== episode.notes?.approvedVersion || a.finalAt !== finalAt(episode),
        } : null,
    };
}

// One image for the Studio to draw with. Served from here rather than a Storage link so the
// browser can read its pixels (a cross-origin image cannot be exported from a canvas).
export async function getThumbnailImage(id: string, name: string) {
    const episode = (await episodeRef(id).get()).data() as Episode | undefined;
    if (!episode) throw new HttpError(404, 'Episode not found');
    const t = episode.thumbnails;
    const frame = /^frame-(\d+)$/.exec(name);
    const path = frame ? t?.frames?.[Number(frame[1])]?.path
        : name === 'ai' ? t?.image?.path
            : name === 'approved' ? episode.approval?.thumbnailPath : undefined;
    if (!path) throw new HttpError(404, 'No such image');
    const [bytes] = await adminBucket().file(path).download();
    return { bytes, contentType: path.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

// Checkpoint D: keeps the thumbnail exactly as drawn in the Studio and approves the episode
// for publishing. `image` is the JPEG, base64.
export async function approveEpisode(id: string, body: { kind?: unknown; text?: unknown; image?: unknown }, user: { uid: string }) {
    if (!THUMB_KINDS.includes(body.kind as ThumbKind)) throw new HttpError(400, 'Pick a thumbnail');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > TEXT_MAX) throw new HttpError(400, `Keep the text to ${TEXT_MAX} characters`);
    const bytes = typeof body.image === 'string' ? Buffer.from(body.image, 'base64') : Buffer.alloc(0);
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isJpeg) throw new HttpError(400, 'The thumbnail did not come through as a JPEG');
    if (bytes.length > THUMB_MAX_BYTES) throw new HttpError(400, 'The thumbnail is over YouTube\'s 2 MB limit');

    const ref = episodeRef(id);
    const before = (await ref.get()).data() as Episode | undefined;
    if (!before) throw new HttpError(404, 'Episode not found');
    const blocked = blockers(before);
    if (blocked.length) throw new HttpError(409, blocked[0]);

    const thumbnailPath = `episodes/${id}/thumbnails/approved-${Date.now()}.jpg`;
    await adminBucket().file(thumbnailPath).save(bytes, { contentType: 'image/jpeg', resumable: false });
    const profile = (await adminDb().collection('users').doc(user.uid).get()).data() ?? {};
    const approvedBy = { uid: user.uid, name: (profile.displayName as string) || (profile.email as string) || 'a producer' };
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        const now = blockers(episode);
        if (now.length) throw new HttpError(409, now[0]);
        tx.update(ref, {
            approval: {
                thumbnailPath, kind: body.kind, text, approvedBy, approvedAt: FieldValue.serverTimestamp(),
                notesVersion: episode.notes?.approvedVersion ?? 0, finalAt: finalAt(episode),
            },
            'thumbnails.choice': body.kind,
            'thumbnails.text': text,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
}

export async function withdrawApproval(id: string) {
    await episodeRef(id).update({ approval: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
}
