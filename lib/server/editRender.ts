// Editor Light (spec 015): asks GitHub Actions to render the edit saved in the Studio, and
// reports where the render stands, for the "Edit here instead" panel on the notes page.

import { FieldValue } from 'firebase-admin/firestore';
import type { Episode, EpisodeEditRender } from '@/types/episode';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startEditRender } from './github';
import { HttpError } from './staff';

// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 360 * 60_000;       // the workflow's own limit is 350 minutes

const WORKING: EpisodeEditRender['status'][] = ['queued', 'downloading', 'rendering', 'saving'];

export interface EditRenderView {
    status: EpisodeEditRender['status'] | null;
    error: string | null;
    canStart: boolean;
    stale: boolean;                   // the edit changed after this render was made
    driveUrl: string | null;
    videoUrl: string | null;          // a short-lived link to watch or download the render
    durationSeconds: number | null;
    cuts: number | null;
    warnings: string[];
}

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

function busy(r: EpisodeEditRender | undefined) {
    if (!r || !WORKING.includes(r.status)) return false;
    const since = Math.max(millis(r.requestedAt) ?? 0, millis(r.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

// Renders the edit as it is saved now; running it again replaces the files.
export async function requestEditRender(id: string) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (!episode.edit) throw new HttpError(409, 'Make at least one change in the editor first');
        if (!episode.media?.sourcePath) throw new HttpError(409, 'The original video is not in Cloud Storage yet');
        if (busy(episode.editRender)) throw new HttpError(409, 'The edit is already being rendered');
        tx.set(ref, {
            editRender: { status: 'queued', requestedAt: FieldValue.serverTimestamp(), error: null },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    try {
        await startEditRender(id);
    } catch (error) {
        const message = `Could not start the render: ${(error as Error).message}`;
        await ref.update({ 'editRender.status': 'failed', 'editRender.error': message });
        throw new HttpError(502, message);
    }
}

export async function getEditRender(id: string): Promise<EditRenderView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const r = episode.editRender;
    const lost = !!r && WORKING.includes(r.status) && !busy(r);
    const ready = r?.status === 'ready';
    return {
        // A request whose run died reads as failed, so the panel offers a retry.
        status: lost ? 'failed' : r?.status ?? null,
        error: r?.error ?? (lost ? 'The render did not finish. Check the Podcast Edit Render run in GitHub Actions, then try again.' : null),
        canStart: !!episode.edit && !!episode.media?.sourcePath && !busy(r),
        stale: ready && r.editVersion !== episode.edit?.version,
        driveUrl: ready ? r.driveUrl ?? null : null,
        videoUrl: ready && r.videoPath
            ? await adminBucket().file(r.videoPath).getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60_000 }).then(([u]) => u).catch(() => null)
            : null,
        durationSeconds: ready ? r.durationSeconds ?? null : null,
        cuts: ready ? r.cuts ?? null : null,
        warnings: ready ? r.warnings ?? [] : [],
    };
}
