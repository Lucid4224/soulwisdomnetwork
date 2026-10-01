// B-roll stills for one episode (docs/specs/008-broll-images.md): ask GitHub Actions to
// generate them from the approved show notes, and show them on the notes page.

import { FieldValue } from 'firebase-admin/firestore';
import type { Episode, EpisodeBroll } from '@/types/episode';
import type { BrollView } from '@/types/studio';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startBroll } from './github';
import { ESTIMATE_USD, withinDailyLimit } from './spending';
import { HttpError } from './staff';

const IMAGE_LINK_MS = 6 * 60 * 60_000;
// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 40 * 60_000;

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

function busy(broll: EpisodeBroll | undefined) {
    if (broll?.status !== 'queued' && broll?.status !== 'generating') return false;
    const since = Math.max(millis(broll.requestedAt) ?? 0, millis(broll.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

// Starts the Podcast B-roll workflow for the approved ideas; `index` regenerates one image.
export async function requestBroll(id: string, index: number | null) {
    const ref = episodeRef(id);
    let images = 0;   // to make, as agent/src/podcast/broll.ts decides: new ideas, or changed ones
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        const ideas = episode.notes?.status === 'approved' ? episode.notes.approved?.broll ?? [] : [];
        const made = episode.broll?.images ?? {};
        images = index !== null ? 1 : ideas.filter((b, i) => made[i]?.idea !== b.idea.trim() || (made[i]?.style ?? 'photo') !== (b.style ?? 'photo')).length;
        if (!ideas.length) throw new HttpError(409, 'Approve the show notes with at least one b-roll idea first');
        if (index !== null && index >= ideas.length) throw new HttpError(400, 'There is no such b-roll idea');
        if (busy(episode.broll)) throw new HttpError(409, 'B-roll images are already being generated');
        tx.set(ref, {
            broll: { status: 'queued', only: index, requestedAt: FieldValue.serverTimestamp(), error: null },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    try {
        await withinDailyLimit('b-roll images', images * ESTIMATE_USD.brollImage, () => startBroll(id, index));
    } catch (error) {
        const message = `Could not start generating: ${(error as Error).message}`;
        await ref.update({ 'broll.status': 'failed', 'broll.error': message });
        throw new HttpError(502, message);
    }
}

export async function getBroll(id: string): Promise<BrollView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const b = episode.broll;
    const lost = (b?.status === 'queued' || b?.status === 'generating') && !busy(b);
    const images = await Promise.all(Object.values(b?.images ?? {}).map(async image => ({
        index: image.index,
        idea: image.idea,
        style: image.style ?? 'photo',
        url: (await adminBucket().file(image.path).getSignedUrl({ action: 'read', expires: Date.now() + IMAGE_LINK_MS }))[0],
        model: image.model,
        prompt: image.prompt,
        usd: image.usd,
        createdAt: millis(image.createdAt),
    })));
    return {
        // A request whose run died reads as failed, so the page offers a retry.
        status: lost ? 'failed' : b?.status ?? null,
        only: b?.only ?? null,
        error: b?.error ?? (lost ? 'Generating did not finish. Check the Podcast B-roll run in GitHub Actions, then try again.' : null),
        notesApproved: episode.notes?.status === 'approved',
        images: images.sort((x, y) => x.index - y.index),
    };
}
