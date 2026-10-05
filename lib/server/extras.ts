// Why: the server-side extras logic — request the social posts and follow-up email (checking notes
// are approved, direction is valid, and the spending limit holds) and read them back for the page.

import { FieldValue } from 'firebase-admin/firestore';
import type { Episode, EpisodeExtras } from '@/types/episode';
import type { ExtrasView } from '@/types/studio';
import { adminDb } from './firebaseAdmin';
import { startNotes } from './github';
import { ESTIMATE_USD, withinDailyLimit } from './spending';
import { HttpError } from './staff';
import { EXTRAS_DIRECTION_MAX } from '@/lib/extras';

// A request that has not turned into extras by now is treated as lost and can be retried.
const STALE_MS = 20 * 60_000;

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

// Whether the extras are still being written (queued or working and not stale).
function busy(x: EpisodeExtras | undefined) {
    if (x?.status !== 'queued' && x?.status !== 'working') return false;
    const since = Math.max(millis(x.requestedAt) ?? 0, millis(x.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

// Requests the social posts and follow-up email: checks the notes are approved, the direction is
// valid, and the spending limit holds, then starts the notes job (which runs the extras).
export async function requestExtras(id: string, body: { direction?: unknown }) {
    const direction = typeof body.direction === 'string' ? body.direction : '';
    if (direction.length > EXTRAS_DIRECTION_MAX) {
        throw new HttpError(400, `Keep the direction under ${EXTRAS_DIRECTION_MAX} characters`);
    }
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (episode.notes?.status !== 'approved' || !episode.notes?.approved) {
            throw new HttpError(409, 'Approve the show notes first');
        }
        if (busy(episode.extras)) throw new HttpError(409, 'Claude is already writing them');
        tx.update(ref, {
            'extras.status': 'queued',
            'extras.requestedAt': FieldValue.serverTimestamp(),
            'extras.error': null,
            'extras.direction': direction.trim(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
    try {
        await withinDailyLimit('social posts', ESTIMATE_USD.extras, () => startNotes(id));
    } catch (error) {
        const message = `Could not start writing: ${(error as Error).message}`;
        await ref.update({ 'extras.status': 'failed', 'extras.error': message });
        throw new HttpError(502, message);
    }
}

// Reads the extras for the show notes page. A queued or working request that is no longer busy reads as failed.
export async function getExtras(id: string): Promise<ExtrasView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const x = episode.extras;
    const stillBusy = busy(x);
    const status = x ? (stillBusy ? x.status : x.status === 'queued' || x.status === 'working' ? 'failed' : x.status) : null;
    return {
        status,
        error: x?.error ?? (!stillBusy && (x?.status === 'queued' || x?.status === 'working')
            ? 'Writing did not finish. Check the Podcast Show Notes run in GitHub Actions, then try again.'
            : null),
        direction: x?.direction ?? '',
        result: x?.result ?? null,
        generatedAt: millis(x?.generatedAt),
    };
}
