// Uploads from the Studio: a recording (a new episode), a logo, an intro video, a music track (Part H) or an
// image to lay over a video (Part I). The browser
// sends the file straight to Cloud Storage through a one-time upload link made here, so nothing
// in the browser needs Storage access (storage.rules stays closed) and no Drive is involved.
// A finished recording becomes an episode and the ingest job is started for it, which then
// makes the preview, transcribes and hands it to speaker review exactly as for a Drive file.

import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { episodeTitle, recordedAt } from '@/agent/src/podcast/naming';
import type { Episode } from '@/types/episode';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startIngest } from './github';
import { HttpError } from './staff';
import { getSettings } from './studioSettings';

export type UploadKind = 'episode' | 'logo' | 'intro' | 'music' | 'overlay';

const MAX_BYTES: Record<UploadKind, number> = { episode: 20e9, logo: 5e6, intro: 2e9, music: 2e8, overlay: 2e7 };
const TYPES: Record<UploadKind, RegExp> = {
    episode: /^video\//,
    logo: /^image\/(png|jpeg)$/,
    intro: /^video\/(mp4|quicktime)$/,
    music: /^audio\/(mpeg|mp4|x-m4a|wav|x-wav|aac)$/,
    overlay: /^image\/(png|jpeg)$/,
};
const EXT: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac',
};

// Keeps a file name safe as part of a Storage path.
const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150) || 'recording.mp4';

export interface UploadStart { uploadUrl: string; path: string; episodeId: string | null }

// A one-time resumable upload link for one file. The origin is the Studio page's own, so the
// browser may send the file to it (Cloud Storage answers that origin only).
export async function startUpload(body: { kind?: string; fileName?: string; contentType?: string; size?: number }, origin: string): Promise<UploadStart> {
    const kind = body.kind as UploadKind;
    if (!(kind in MAX_BYTES)) throw new HttpError(400, 'Unknown upload');
    const fileName = String(body.fileName ?? '');
    const contentType = String(body.contentType ?? '');
    const size = Number(body.size ?? 0);
    if (!fileName || !TYPES[kind].test(contentType)) {
        throw new HttpError(400, kind === 'logo' ? 'The logo must be a PNG or JPEG image' : kind === 'intro' ? 'The intro must be an MP4 or MOV video' : kind === 'music' ? 'The music must be an MP3, M4A, WAV or AAC file' : kind === 'overlay' ? 'The image must be a PNG or JPEG' : 'Choose a video recording (an MP4 from Zoom works)');
    }
    if (!(size > 0) || size > MAX_BYTES[kind]) throw new HttpError(400, `That file is too large (the limit is ${MAX_BYTES[kind] / 1e9} GB)`);
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new HttpError(400, 'Upload from the Studio page');

    let episodeId: string | null = null;
    let path: string;
    if (kind === 'episode') {
        episodeId = `up${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
        path = `episodes/${episodeId}/source/${safeName(fileName)}`;
    } else if (kind === 'overlay') {
        // Images laid over videos live apart from the settings, one name per upload.
        path = `overlays/${Date.now().toString(36)}${randomBytes(3).toString('hex')}.${EXT[contentType] ?? 'bin'}`;
    } else {
        path = `settings/${kind}-${Date.now()}.${EXT[contentType] ?? 'bin'}`;
    }
    const [uploadUrl] = await adminBucket().file(path).createResumableUpload({ origin, metadata: { contentType } });
    return { uploadUrl, path, episodeId };
}

// After the browser has sent the recording: make the episode and start processing it.
export async function finishEpisodeUpload(body: { episodeId?: string; path?: string; title?: string }) {
    const episodeId = String(body.episodeId ?? '');
    const path = String(body.path ?? '');
    if (!/^up[a-z0-9]{12,}$/.test(episodeId) || !path.startsWith(`episodes/${episodeId}/source/`)) {
        throw new HttpError(400, 'Not an upload from this Studio');
    }
    const [exists] = await adminBucket().file(path).exists();
    if (!exists) throw new HttpError(409, 'The upload did not finish; try again');
    const [meta] = await adminBucket().file(path).getMetadata();
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    const title = String(body.title ?? '').trim().slice(0, 150) || episodeTitle(fileName);
    const settings = await getSettings();

    const episode: Episode = {
        title,
        recordedAt: recordedAt(fileName),
        status: 'ingesting',
        stage: 'copy',
        source: 'upload',
        drive: { fileId: episodeId, fileName, mimeType: String(meta.contentType ?? 'video/mp4'), sizeBytes: Number(meta.size ?? 0) },
        media: { sourcePath: path },
        candidateSpeakers: settings.hosts,
        costs: { items: [], totalUsd: 0 },
        error: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };
    try {
        await adminDb().collection('episodes').doc(episodeId).create(episode);
    } catch {
        throw new HttpError(409, 'This upload already became an episode');
    }
    try {
        await startIngest({ skip_wait: true });
    } catch (error) {
        // The episode is saved; the next processing run (or Retry) picks it up.
        return { episodeId, started: false, message: `Uploaded. Processing could not start yet: ${(error as Error).message}` };
    }
    return { episodeId, started: true, message: 'Uploaded. Processing has started; it shows under Processing within a minute or two.' };
}
