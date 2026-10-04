// The YouTube upload (docs/specs/012-youtube-upload.md): ask GitHub Actions to upload the approved
// episode, or update the video already there, and show where it stands on the notes page.

import { FieldValue } from 'firebase-admin/firestore';
import { getSettings } from './studioSettings';
import { youtubeMetadata } from '@/lib/youtube';
import type { Episode, EpisodeYoutube } from '@/types/episode';
import type { YoutubeView } from '@/types/studio';
import { adminDb } from './firebaseAdmin';
import { startYoutube } from './github';
import { HttpError } from './staff';

// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 130 * 60_000;       // the workflow's own limit is 120 minutes

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

const WORKING: EpisodeYoutube['status'][] = ['queued', 'uploading', 'processing'];

function busy(y: EpisodeYoutube | undefined) {
    if (!y || !WORKING.includes(y.status)) return false;
    const since = Math.max(millis(y.requestedAt) ?? 0, millis(y.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

// Uploading needs a current Checkpoint D approval.
function blocker(episode: Episode) {
    const a = episode.approval;
    if (episode.final?.status !== 'ready') return 'Get the final cut first (from Descript or the Editor Light render)';
    if (!a) return 'Approve the episode first (Checkpoint D)';
    if (a.notesVersion !== episode.notes?.approvedVersion || a.finalAt !== (millis(episode.final.finishedAt) ?? 0)) {
        return 'The notes or the final cut changed after the approval; approve the episode again';
    }
    return null;
}

export async function requestYoutube(id: string) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        const problem = blocker(episode);
        if (problem) throw new HttpError(409, problem);
        if (busy(episode.youtube)) throw new HttpError(409, 'The upload is already running');
        tx.update(ref, {
            'youtube.status': 'queued', 'youtube.requestedAt': FieldValue.serverTimestamp(), 'youtube.error': null,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
    try {
        await startYoutube(id);
    } catch (error) {
        const message = `Could not start the upload: ${(error as Error).message}`;
        await ref.update({ 'youtube.status': 'failed', 'youtube.error': message });
        throw new HttpError(502, message);
    }
}

// After the video was deleted in YouTube Studio: the next upload makes a new video.
export async function forgetYoutube(id: string) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (busy(episode.youtube)) throw new HttpError(409, 'The upload is running');
        tx.update(ref, { youtube: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    });
}

export async function getYoutube(id: string): Promise<YoutubeView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const y = episode.youtube;
    const lost = !!y && WORKING.includes(y.status) && !busy(y);
    const finalAt = millis(episode.final?.finishedAt) ?? 0;
    const approvalAt = millis(episode.approval?.approvedAt) ?? 0;
    const problem = blocker(episode);
    return {
        // A request whose run died reads as failed, so the page offers a retry.
        status: lost ? 'failed' : y?.status ?? null,
        error: y?.error ?? (lost ? 'The upload did not finish. Check the Podcast YouTube Upload run in GitHub Actions, then try again.' : null),
        blocker: problem,
        videoId: y?.videoId ?? null,
        url: y?.url ?? null,
        privacyStatus: y?.privacyStatus ?? null,
        finishedAt: millis(y?.finishedAt),
        warnings: y?.status === 'ready' ? y.warnings ?? [] : [],
        // The video file is from an earlier final cut, or the details from an earlier approval.
        finalOutdated: !!y?.videoId && y.finalAt !== finalAt,
        detailsOutdated: y?.status === 'ready' && !!y.videoId && y.approvalAt !== approvalAt,
        // Exactly what the upload will send, with the Studio settings' description lines.
        preview: youtubeMetadata(episode, await getSettings()),
    };
}
