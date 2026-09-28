// Spec 005 steps 10-11: the final cut. Once the edit is done in Descript:
//   10. publish the "Episode" timeline through Descript's API, download the render,
//       normalize its loudness, and keep it in Cloud Storage and in Drive ("04 Final")
//   11. transcribe the final cut and move the show notes' chapter and quote times onto it,
//       since filler removal, cuts, the cold open and the intro all shift them
// Runs in GitHub Actions (.github/workflows/podcast_final.yml), started from the show notes
// page. Running it again after more edits in Descript replaces the files.
// docs/specs/010-final-cut.md

import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { retimeChapters, retimeQuotes, timeMap, type TimedWord } from '../../../lib/retime';
import { mmss } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert, speechModels } from './config';
import { createDescript, DescriptError } from './descriptApi';
import { createDrive, ensureFolder, parentOf, putFile } from './drive';
import { withRetry } from './errors';
import { makeAudio, normalizeLoudness, probeDuration } from './media';
import { sendEmail } from './notify';
import { createAssemblyAI, transcribeWords } from './transcribe';

// AssemblyAI transcription without speaker labels, per audio hour.
const WORDS_USD_PER_HOUR = 0.21;
// Below this share of the original's words found again, the times are probably wrong.
const LOW_COVERAGE = 0.5;

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const descript = createDescript(required('DESCRIPT_API_TOKEN'));
const assembly = createAssemblyAI(required('ASSEMBLYAI_API_KEY'));
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
const workDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'final', episodeId);

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

async function download(url: string, dest: string) {
    await withRetry('Descript download', async () => {
        const res = await fetch(url);
        if (!res.ok || !res.body) throw new Error(`Download failed with ${res.status}`);
        await pipeline(Readable.fromWeb(res.body as WebReadableStream), fs.createWriteStream(dest));
    });
}

// A private share page if the Descript workspace allows it, otherwise its default.
async function publish(projectId: string, compositionId: string | undefined) {
    const body = { project_id: projectId, ...(compositionId ? { composition_id: compositionId } : {}), media_type: 'Video', resolution: '1080p' };
    try {
        return await descript.call<{ job_id: string }>('POST', '/jobs/publish', { ...body, access_level: 'private' });
    } catch (error) {
        if (!(error instanceof DescriptError) || error.status !== 403) throw error;
        console.log('  Private share pages are not allowed in this workspace; using its default');
        return descript.call<{ job_id: string }>('POST', '/jobs/publish', body);
    }
}

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const project = episode.descript;
    if (project?.status !== 'ready' || !project.projectId) throw new Error('Send the episode to Descript first');
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    if (!notes) throw new Error('Approve the show notes first');
    const reviewedPath = episode.review?.reviewedPath;
    if (!reviewedPath) throw new Error('The transcript has not been accepted yet');
    fs.mkdirSync(workDir, { recursive: true });
    const warnings: string[] = [];

    // Step 10: publish, download, normalize, keep.
    await ref.update({
        'final.status': 'publishing', 'final.startedAt': FieldValue.serverTimestamp(), 'final.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`🎬 Publishing ${project.projectUrl}`);
    const job = await publish(project.projectId, project.compositionId);
    const published = await descript.waitFor(job.job_id, 'publish');
    const result = published.result;
    if (result?.status !== 'success' || !result.download_url) {
        throw new Error(`Descript could not publish the episode: ${result?.error_message ?? result?.status ?? 'no result'}`);
    }
    const rendered = path.join(workDir, 'rendered.mp4');
    await download(result.download_url, rendered);
    console.log(`  ✅ Downloaded the render (${Math.round(fs.statSync(rendered).size / 1e6)} MB)`);

    await ref.update({ 'final.status': 'mastering', 'final.shareUrl': result.share_url ?? null });
    const master = path.join(workDir, 'final.mp4');
    const loudness = await normalizeLoudness(rendered, master);
    const durationSeconds = await probeDuration(master);
    console.log(`  ✅ Loudness ${loudness.beforeLufs} → ${loudness.afterLufs} LUFS; ${mmss(durationSeconds * 1000)}`);

    const videoPath = `episodes/${episodeId}/final/episode.mp4`;
    await withRetry('Storage upload', () => bucket.upload(master, { destination: videoPath, resumable: true, metadata: { contentType: 'video/mp4' } }));
    // "04 Final" sits beside "03 For Descript" and "02 Processed" unless a folder is set explicitly.
    const folderId = process.env.DRIVE_FINAL_FOLDER_ID
        || await ensureFolder(drive, await parentOf(drive, required('DRIVE_PROCESSED_FOLDER_ID')), '04 Final');
    const driveFileId = await putFile(drive, folderId, `${safe(episode.title)}.mp4`, 'video/mp4', master);
    const driveUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    await ref.update({
        'final.videoPath': videoPath, 'final.driveFileId': driveFileId, 'final.driveUrl': driveUrl, 'final.folderUrl': folderUrl,
        'final.durationSeconds': durationSeconds, 'final.loudness': loudness, 'final.projectId': project.projectId,
        updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  ✅ Saved to Storage and Drive: ${driveUrl}`);

    // Step 11: line the final cut up with the original and move the times.
    await ref.update({ 'final.status': 'retiming' });
    const audio = path.join(workDir, 'final.m4a');
    await makeAudio(master, audio);
    const { words: finalWords } = await transcribeWords(assembly, audio, speechModels());
    const wordsPath = `episodes/${episodeId}/final/words.json`;
    await withRetry('Storage upload', () => bucket.file(wordsPath).save(JSON.stringify({ words: finalWords }), { contentType: 'application/json', resumable: false }));
    const transcriptUsd = Math.round(durationSeconds / 3600 * WORDS_USD_PER_HOUR * 100) / 100;

    const [raw] = await withRetry('Storage download', () => bucket.file(reviewedPath).download());
    const lines = (JSON.parse(raw.toString('utf8')) as { lines: { words: TimedWord[] }[] }).lines;
    const map = timeMap(lines.flatMap(l => l.words), finalWords, durationSeconds * 1000);
    const { chapters, warnings: chapterWarnings } = retimeChapters(notes.chapters, map);
    const quotes = retimeQuotes(notes.quotes, map);
    warnings.push(...chapterWarnings);
    if (map.coverage < LOW_COVERAGE) {
        warnings.push(`Only ${Math.round(map.coverage * 100)}% of the original's words were found in the final cut, ` +
            'so the new times may be off; check the chapters against the video.');
    }
    console.log(`  ✅ ${map.anchors} words matched (${Math.round(map.coverage * 100)}% of the original); ${chapters.length} chapters`);

    await ref.update({
        'final.status': 'ready',
        'final.wordsPath': wordsPath,
        'final.coverage': map.coverage,
        'final.chapters': chapters,
        'final.quotes': quotes,
        'final.notesVersion': episode.notes?.approvedVersion ?? 0,
        'final.warnings': warnings,
        'final.finishedAt': FieldValue.serverTimestamp(),
        'final.error': null,
        'costs.items': FieldValue.arrayUnion({ item: 'final_transcript', usd: transcriptUsd, at: new Date() }),
        'costs.totalUsd': FieldValue.increment(transcriptUsd),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await sendEmail({ alert }, `Final cut ready: ${episode.title}`, [
        `The final cut of "${episode.title}" is saved (${mmss(durationSeconds * 1000)}, loudness ${loudness.afterLufs} LUFS):`,
        driveUrl,
        '',
        'Chapters on the final cut:',
        ...chapters.map(c => `  ${mmss(c.startMs)} ${c.title}   (was ${mmss(c.originalMs)})`),
        ...(warnings.length ? ['', 'Check:', ...warnings.map(w => `  - ${w}`)] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'final.status': 'failed', 'final.error': message, 'final.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await sendEmail({ alert }, `Final cut failed: ${episodeId}`,
        `The final cut could not be made.\n\nError: ${message}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
