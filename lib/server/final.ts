// The final cut (docs/specs/010-final-cut.md): ask GitHub Actions to publish the edited
// episode from Descript and re-time the show notes on it, and show where it stands on the
// notes page.

import { FieldValue } from 'firebase-admin/firestore';
import type { Episode, EpisodeFinal } from '@/types/episode';
import type { FinalView } from '@/types/studio';
import { adminDb } from './firebaseAdmin';
import { startFinal } from './github';
import { HttpError } from './staff';

// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 190 * 60_000;       // the workflow's own limit is 180 minutes

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

const WORKING: EpisodeFinal['status'][] = ['queued', 'publishing', 'mastering', 'retiming'];

function busy(f: EpisodeFinal | undefined) {
    if (!f || !WORKING.includes(f.status)) return false;
    const since = Math.max(millis(f.requestedAt) ?? 0, millis(f.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

function descriptBusy(episode: Episode) {
    const s = episode.descript?.status;
    return s === 'queued' || s === 'importing' || s === 'cleaning';
}

// Publishes whatever is in the Descript project now; running it again picks up later edits.
export async function requestFinal(id: string) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (episode.notes?.status !== 'approved') throw new HttpError(409, 'Approve the show notes first');
        if (descriptBusy(episode)) throw new HttpError(409, 'Wait until the Descript project is made');
        if (episode.descript?.status !== 'ready' || !episode.descript.projectId) throw new HttpError(409, 'Send the episode to Descript first');
        if (busy(episode.final)) throw new HttpError(409, 'The final cut is already being made');
        tx.set(ref, {
            final: { status: 'queued', requestedAt: FieldValue.serverTimestamp(), error: null },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    try {
        await startFinal(id);
    } catch (error) {
        const message = `Could not start the final cut: ${(error as Error).message}`;
        await ref.update({ 'final.status': 'failed', 'final.error': message });
        throw new HttpError(502, message);
    }
}

export async function getFinal(id: string): Promise<FinalView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const f = episode.final;
    const lost = !!f && WORKING.includes(f.status) && !busy(f);
    const ready = f?.status === 'ready';
    return {
        // A request whose run died reads as failed, so the page offers a retry.
        status: lost ? 'failed' : f?.status ?? null,
        error: f?.error ?? (lost ? 'The final cut did not finish. Check the Podcast Final Cut run in GitHub Actions, then try again.' : null),
        canStart: episode.notes?.status === 'approved' && episode.descript?.status === 'ready' && !!episode.descript.projectId,
        stale: ready && (f.projectId !== episode.descript?.projectId || f.notesVersion !== episode.notes?.approvedVersion),
        driveUrl: f?.driveUrl ?? null,
        folderUrl: f?.folderUrl ?? null,
        shareUrl: f?.shareUrl ?? null,
        durationSeconds: f?.durationSeconds ?? null,
        loudness: f?.loudness ?? null,
        coverage: f?.coverage ?? null,
        chapters: ready ? f.chapters ?? [] : [],
        quoteCount: ready ? f.quotes?.length ?? 0 : 0,
        warnings: ready ? f.warnings ?? [] : [],
        finishedAt: millis(f?.finishedAt),
    };
}
