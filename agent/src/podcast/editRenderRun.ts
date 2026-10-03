// Editor Light (spec 015): the render job as GitHub Actions runs it
// (.github/workflows/podcast_edit_render.yml). Connects Firestore, Cloud Storage and Drive,
// as final.ts does, then hands them to runEditRender in editRenderJob.ts. On failure it
// marks the render failed and emails the alert address, so the Studio can offer a retry.

import * as path from 'path';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { mmss } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { createDrive, ensureFolder, parentOf, putFile } from './drive';
import { renderEdit } from './editRender';
import { runEditRender } from './editRenderJob';
import { withRetry } from './errors';
import { describeError, failureSubject, sendEmail } from './notify';

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const alert = loadAlert();
const runUrl = process.env.GITHUB_RUN_URL || '';
const serviceAccount = JSON.parse(required('PODCAST_SA_JSON'));
initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
});
const ref = getFirestore().collection('episodes').doc(episodeId);
const bucket = getStorage().bucket();
const drive = createDrive(serviceAccount);
const workDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'edit-render', episodeId);

async function main() {
    const result = await runEditRender(episodeId, {
        getEpisode: async () => (await ref.get()).data() as Episode | undefined,
        download: async (storagePath, dest) => {
            await withRetry('Storage download', () => bucket.file(storagePath).download({ destination: dest }));
        },
        upload: async (local, storagePath, contentType) => {
            await withRetry('Storage upload', () => bucket.upload(local, { destination: storagePath, resumable: true, metadata: { contentType } }));
        },
        // "04 Final" sits beside "02 Processed" unless a folder is set explicitly, as in final.ts.
        saveToDrive: async (local, name) => {
            const folderId = process.env.DRIVE_FINAL_FOLDER_ID
                || await ensureFolder(drive, await parentOf(drive, required('DRIVE_PROCESSED_FOLDER_ID')), '04 Final');
            const fileId = await putFile(drive, folderId, name, 'video/mp4', local);
            return { fileId, folderId };
        },
        update: async fields => { await ref.update(fields); },
        render: renderEdit,
        now: () => FieldValue.serverTimestamp(),
    }, workDir);
    const episode = (await ref.get()).data() as Episode;
    console.log(`✅ Rendered ${mmss(result.durationSeconds * 1000)}, ${result.cuts} cuts: ${result.driveUrl}`);
    await sendEmail({ alert }, `Editor Light render ready: ${episode.title}`, [
        `The Editor Light render of "${episode.title}" is saved (${mmss(result.durationSeconds * 1000)}, ` +
            `${result.cuts} cuts, ${mmss(result.timeSavedSeconds * 1000)} shorter):`,
        result.driveUrl,
        ...(result.warnings.length ? ['', 'Check:', ...result.warnings.map(w => `  - ${w}`)] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'editRender.status': 'failed', 'editRender.error': message, 'editRender.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await sendEmail({ alert }, failureSubject(`Editor Light render failed: ${episodeId}`, message),
        `The Editor Light render could not be made.\n\n${describeError(message)}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
