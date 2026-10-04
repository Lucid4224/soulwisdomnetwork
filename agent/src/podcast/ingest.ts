// Spec 005 steps 1-3: pick up new recordings from Drive, copy them to Cloud Storage, make
// a 720p proxy and an audio-only file, and transcribe with candidate speaker names.
// Recordings uploaded in the Studio (lib/server/uploads.ts) are already in Cloud Storage; they
// go through the same steps without Drive, which is optional when only uploads are used.
// Runs in GitHub Actions (.github/workflows/podcast_ingest.yml), NOT on App Hosting.
//
// Every step records its output on the episode document before moving on, so a failed or
// interrupted run resumes where it stopped and never pays for the same transcript twice.

import type { Transcript } from 'assemblyai';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as fs from 'fs';
import * as path from 'path';
import type { DetectedSpeaker, Episode, EpisodeStage } from '../../../types/episode';
import { ASSEMBLYAI_USD_PER_HOUR, MAX_ATTEMPTS, SETTLE_MINUTES, loadConfig } from './config';
import {
    checkFolderAccess, createDrive, createGoogleDoc, downloadFile, isVideo, listFolderFiles, listSubfolders, moveItem, type DriveFile,
} from './drive';
import { PermanentError, withRetry } from './errors';
import { makeAudio, makeProxy, probeDuration } from './media';
import { episodeTitle, recordedAt } from './naming';
import { sendEmail, sendFailureAlert, type Failure } from './notify';
import { postUsageReport } from './usageReport';
import { readableTranscript, speakerSummary } from './readable';
import { loadSettings } from './settings';
import { createAssemblyAI, hasFailed, submitTranscription, summariseSpeakers, waitForTranscript } from './transcribe';

const config = loadConfig();
const serviceAccount = JSON.parse(config.serviceAccountJson);

initializeApp({ credential: cert(serviceAccount), storageBucket: config.bucket });
const db = getFirestore();
const bucket = getStorage().bucket();
const drive = createDrive(serviceAccount);
// The Drive inbox is used when its folders are set and the Studio settings have not turned it off.
const driveFolders = !!(config.toProcessFolderId && config.processedFolderId);
const assembly = createAssemblyAI(config.assemblyAiKey);

async function storageHas(objectPath: string | undefined) {
    if (!objectPath) return false;
    const [exists] = await withRetry('Storage exists', () => bucket.file(objectPath).exists());
    return exists;
}

async function upload(local: string, destination: string, contentType: string) {
    await withRetry('Storage upload', () => bucket.upload(local, { destination, resumable: true, metadata: { contentType } }));
    return destination;
}

function touch(ref: DocumentReference, fields: Record<string, unknown>) {
    return withRetry('Firestore update', () => ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp() }));
}

// Checkpoint A hand-off: a readable transcript in Storage, a Google Doc next to the video
// (shared drives only), and one "ready for review" email. Each part is recorded so a rerun
// never sends a second email or makes a second Doc.
async function publishReview(ref: DocumentReference, episode: Episode, speakers: DetectedSpeaker[], transcript: Transcript) {
    const review = episode.review ?? {};
    const text = readableTranscript(
        { title: episode.title, recordedAt: episode.recordedAt, durationSeconds: episode.media?.durationSeconds },
        speakers, transcript,
    );

    if (!review.transcriptTextPath) {
        const local = path.join(config.workDir, `${ref.id}-transcript.txt`);
        fs.writeFileSync(local, text);
        review.transcriptTextPath = await upload(local, `episodes/${ref.id}/transcripts/raw.txt`, 'text/plain; charset=utf-8');
        fs.rmSync(local, { force: true });
        await touch(ref, { 'review.transcriptTextPath': review.transcriptTextPath });
    }

    if (!review.docUrl && config.processedFolderId) {
        try {
            review.docUrl = await createGoogleDoc(drive, config.processedFolderId, `${episode.title} — transcript`, text);
            await touch(ref, { 'review.docUrl': review.docUrl });
            console.log(`  📄 Transcript Doc: ${review.docUrl}`);
        } catch (error) {
            console.warn(`  ⚠️ Could not create the transcript Doc (needs the folders in a shared drive): ` +
                `${(error as Error).message}`);
        }
    }

    if (!review.notifiedAt) {
        const body = [
            `"${episode.title}" is transcribed and ready for speaker review.`,
            '',
            review.docUrl ? `Transcript (Google Doc): ${review.docUrl}` : 'The full transcript is attached.',
            '',
            'Each speaker below shows when they first speak and two sample lines. Jump to those times in',
            'the video to check the names. "Speaker X (unknown)" means no name was matched, and',
            '"Name - 1" / "Name - 2" means two voices both sounded like that person.',
            '',
            speakerSummary(speakers),
        ].join('\n');
        const sent = await sendEmail(config, `Ready for speaker review: ${episode.title}`, body,
            [{ filename: `${episode.title} - transcript.txt`, content: text }]);
        if (sent) {
            await touch(ref, { 'review.notifiedAt': FieldValue.serverTimestamp() });
            // The episode has started: post what it should take to the Usage page.
            await postUsageReport(db, ref.id, 'started');
        }
    }
}

// Episodes that finished before the review hand-off existed, or whose email or Doc failed.
async function catchUpReviews() {
    const snap = await db.collection('episodes').where('status', '==', 'awaiting_speaker_review').get();
    for (const doc of snap.docs) {
        const episode = doc.data() as Episode;
        if (episode.review?.notifiedAt && episode.review?.docUrl) continue;
        if (!episode.transcription?.transcriptPath) continue;
        try {
            const [raw] = await withRetry('Storage download', () => bucket.file(episode.transcription!.transcriptPath!).download());
            const transcript = JSON.parse(raw.toString('utf-8')) as Transcript;
            let speakers = episode.transcription.speakers ?? [];
            if (!episode.review?.notifiedAt) {
                // Nobody has reviewed yet, so refresh the summary with the current rules.
                speakers = summariseSpeakers(transcript);
                await touch(doc.ref, { 'transcription.speakers': speakers });
            }
            console.log(`📨 ${episode.title}: catching up the review hand-off`);
            await publishReview(doc.ref, episode, speakers, transcript);
        } catch (error) {
            console.error(`❌ ${episode.title}: review hand-off failed: ${(error as Error).message}`);
        }
    }
}

// `uploaded`: the recording was uploaded in the Studio; its original is already in Cloud
// Storage, so it is read from there and there is no Drive file to move.
async function processEpisode(video: DriveFile, candidates: string[], uploaded = false): Promise<Failure | null> {
    const fileId = video.id!;
    const fileName = video.name ?? fileId;
    const title = episodeTitle(fileName);

    // createdTime too: an upload can keep the file's original modifiedTime.
    const lastChange = Math.max(Date.parse(video.createdTime ?? '') || 0, Date.parse(video.modifiedTime ?? '') || 0);
    if (!config.skipWait && lastChange > Date.now() - SETTLE_MINUTES * 60_000) {
        console.log(`⏳ ${title}: added in the last ${SETTLE_MINUTES} min, waiting for the next run.`);
        return null;
    }

    const ref = db.collection('episodes').doc(fileId);
    const existing = (await ref.get()).data() as Episode | undefined;

    if (existing?.error?.permanent) {
        console.log(`⛔ ${title}: failed permanently at "${existing.error.stage}" — skipping until retried.`);
        return null;
    }
    if (existing?.status === 'awaiting_speaker_review' && !uploaded) {
        // Finished on an earlier run but the Drive move did not happen.
        await moveItem(drive, fileId, config.toProcessFolderId, config.processedFolderId);
        console.log(`📁 ${title}: already transcribed, moved to Processed.`);
        return null;
    }

    // Guests are not known up front; they are named at Checkpoint A. `candidates` are the
    // Studio settings' speaker names (the hosts by default).

    if (config.dryRun) {
        console.log(`🔎 [dry run] "${title}": would ingest "${fileName}" (${video.mimeType}, ${video.size} bytes)` +
            `${existing ? ` — resuming from "${existing.stage}"` : ''}`);
        return null;
    }

    console.log(`🎙️ ${title}: ${existing ? `resuming at "${existing.stage}"` : 'new episode'}`);
    if (!existing) {
        const episode: Episode = {
            title,
            recordedAt: recordedAt(fileName),
            status: 'ingesting',
            stage: 'copy',
            drive: {
                fileId,
                fileName,
                mimeType: video.mimeType ?? 'video/mp4',
                sizeBytes: Number(video.size ?? 0),
            },
            candidateSpeakers: candidates,
            costs: { items: [], totalUsd: 0 },
            error: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };
        await ref.set(episode);
    }

    const workDir = path.join(config.workDir, 'podcast', fileId);
    fs.mkdirSync(workDir, { recursive: true });
    const localSource = path.join(workDir, `source${path.extname(fileName) || '.mp4'}`);
    const localProxy = path.join(workDir, 'proxy_720p.mp4');
    const localAudio = path.join(workDir, 'audio.m4a');
    const prefix = `episodes/${fileId}`;
    let stage: EpisodeStage = existing?.stage ?? 'copy';

    const ensureLocalSource = async () => {
        if (fs.existsSync(localSource)) return;
        if (uploaded) {
            console.log(`  ⬇️ Downloading "${fileName}" from Cloud Storage`);
            await withRetry('Storage download', () => bucket.file(existing!.media!.sourcePath!).download({ destination: localSource }));
        } else {
            console.log(`  ⬇️ Downloading "${fileName}" from Drive`);
            await downloadFile(drive, fileId, localSource);
        }
    };

    try {
        // 1. Copy the original to Cloud Storage.
        stage = 'copy';
        let media = existing?.media ?? {};
        if (!(await storageHas(media.sourcePath))) {
            await ensureLocalSource();
            console.log('  ☁️ Uploading original to Cloud Storage');
            const sourcePath = await upload(localSource, `${prefix}/source/${fileName}`, video.mimeType ?? 'video/mp4');
            media = { ...media, sourcePath };
            await touch(ref, { status: 'ingesting', stage, 'media.sourcePath': sourcePath });
        }

        // 2. 720p proxy and audio-only file.
        stage = 'media';
        if (!(await storageHas(media.proxyPath)) || !(await storageHas(media.audioPath))) {
            await touch(ref, { status: 'ingesting', stage });
            await ensureLocalSource();
            const durationSeconds = await probeDuration(localSource);
            console.log(`  🎞️ Making proxy and audio (${Math.round(durationSeconds / 60)} min)`);
            await makeProxy(localSource, localProxy);
            await makeAudio(localSource, localAudio);
            const proxyPath = await upload(localProxy, `${prefix}/proxy_720p.mp4`, 'video/mp4');
            const audioPath = await upload(localAudio, `${prefix}/audio.m4a`, 'audio/mp4');
            media = { ...media, proxyPath, audioPath, durationSeconds };
            await touch(ref, {
                'media.proxyPath': proxyPath, 'media.audioPath': audioPath, 'media.durationSeconds': durationSeconds,
            });
        }
        fs.rmSync(localSource, { force: true });

        // 3. Transcribe the raw recording with candidate speaker names.
        stage = 'transcribe';
        let transcriptId = existing?.transcription?.transcriptId;
        if (transcriptId && await hasFailed(assembly, transcriptId)) transcriptId = undefined;
        if (!transcriptId) {
            const estimate = Math.round((media.durationSeconds ?? 0) / 3600 * ASSEMBLYAI_USD_PER_HOUR * 100) / 100;
            const spent = existing?.costs?.totalUsd ?? 0;
            if (spent + estimate > config.costCapUsd) {
                throw new PermanentError(`Cost cap: $${spent} spent + $${estimate} transcription exceeds the $${config.costCapUsd} cap`);
            }
            if (!fs.existsSync(localAudio)) {
                await withRetry('Storage download', () => bucket.file(media.audioPath!).download({ destination: localAudio }));
            }
            console.log(`  📝 Submitting to AssemblyAI with ${candidates.join(', ')}`);
            transcriptId = await submitTranscription(assembly, localAudio, config.speechModels, candidates);
            await touch(ref, {
                status: 'transcribing',
                stage,
                transcription: { provider: 'assemblyai', transcriptId, speechModels: config.speechModels },
                'costs.items': FieldValue.arrayUnion({ item: 'transcription_raw', usd: estimate, at: new Date() }),
                'costs.totalUsd': FieldValue.increment(estimate),
            });
        } else {
            await touch(ref, { status: 'transcribing', stage });
        }

        console.log(`  ⏱️ Waiting for transcript ${transcriptId}`);
        const transcript = await waitForTranscript(assembly, transcriptId);
        const transcriptLocal = path.join(workDir, 'transcript_raw.json');
        fs.writeFileSync(transcriptLocal, JSON.stringify(transcript));
        const transcriptPath = await upload(transcriptLocal, `${prefix}/transcripts/raw.json`, 'application/json');
        const speakers = summariseSpeakers(transcript);
        const speakerId = transcript.speech_understanding?.response?.speaker_identification;

        // 4. Ready for Checkpoint A; move the video out of the inbox.
        stage = 'finalize';
        await touch(ref, {
            status: 'awaiting_speaker_review',
            stage,
            error: null,
            'transcription.transcriptPath': transcriptPath,
            'transcription.speakerIdStatus': speakerId?.status ?? null,
            'transcription.speakerMapping': speakerId?.mapping ?? {},
            'transcription.speakers': speakers,
        });
        if (!uploaded) await moveItem(drive, fileId, config.toProcessFolderId, config.processedFolderId);
        console.log(`  ✅ ${title}: ${speakers.length} speaker(s) detected, ready for speaker review.`);
        try {
            await publishReview(ref, (await ref.get()).data() as Episode, speakers, transcript);
        } catch (error) {
            // The episode itself is done; the next run's catch-up retries the hand-off.
            console.warn(`  ⚠️ Review hand-off failed, will retry next run: ${(error as Error).message}`);
        }
        return null;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = (existing?.error?.attempts ?? 0) + 1;
        const permanent = error instanceof PermanentError || attempts >= MAX_ATTEMPTS;
        console.error(`  ❌ ${title} failed at "${stage}" (attempt ${attempts}${permanent ? ', permanent' : ''}): ${message}`);
        await touch(ref, {
            status: 'failed',
            stage,
            error: { stage, message, permanent, attempts, at: FieldValue.serverTimestamp() },
        });
        return permanent ? { episode: title, stage, message, fileId } : null;
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

async function main() {
    console.log(`🤖 Podcast ingest starting${config.dryRun ? ' [dry run]' : ''}${config.skipWait ? ' [skipping the upload wait]' : ''}`);

    if (config.retryFileId) {
        const ref = db.collection('episodes').doc(config.retryFileId);
        if ((await ref.get()).exists) {
            await touch(ref, { error: null });
            console.log(`🔁 Cleared the error on ${config.retryFileId}; it will be retried now.`);
        } else {
            console.warn(`⚠️ No episode with file ID ${config.retryFileId}.`);
        }
    }

    console.log(`🔑 Using service account ${serviceAccount.client_email}`);
    const settings = await loadSettings(db);
    const candidates = settings.hosts;
    const failures: Failure[] = [];

    if (driveFolders && settings.useDrive) {
        const inboxName = await checkFolderAccess(drive, config.toProcessFolderId, 'To Process');
        const doneName = await checkFolderAccess(drive, config.processedFolderId, 'Processed');
        console.log(`🔑 Drive access OK: "${inboxName}" and "${doneName}"`);

        // One video file = one episode. Anything else in the inbox is left alone.
        const videos = (await listFolderFiles(drive, config.toProcessFolderId)).filter(isVideo);
        console.log(`📂 ${videos.length} video(s) in "${inboxName}"`);
        for (const sub of await listSubfolders(drive, config.toProcessFolderId)) {
            console.warn(`⚠️ Subfolder "${sub.name}" is ignored — drop video files straight into "${inboxName}".`);
        }

        for (const video of videos) {
            try {
                const failure = await processEpisode(video, candidates);
                if (failure) failures.push(failure);
            } catch (error) {
                // Failed before an episode document existed (e.g. Drive unreachable).
                const message = error instanceof Error ? error.message : String(error);
                console.error(`❌ ${video.name}: ${message}`);
                failures.push({ episode: video.name ?? video.id!, stage: 'copy', message, fileId: video.id! });
            }
        }
    } else {
        console.log('📂 No Drive inbox set up; processing Studio uploads only.');
    }

    // Recordings uploaded in the Studio that are not through yet (a failure that is not
    // permanent is tried again, as a Drive file still in the inbox would be).
    const uploads = (await db.collection('episodes').where('source', '==', 'upload').get()).docs
        .filter(d => {
            const e = d.data() as Episode;
            return e.status === 'ingesting' || e.status === 'transcribing' || (e.status === 'failed' && !e.error?.permanent);
        });
    console.log(`⬆️ ${uploads.length} uploaded recording(s) to process`);
    for (const doc of uploads) {
        const e = doc.data() as Episode;
        try {
            const failure = await processEpisode({ id: doc.id, name: e.drive.fileName, mimeType: e.drive.mimeType, size: String(e.drive.sizeBytes) }, candidates, true);
            if (failure) failures.push(failure);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`❌ ${e.title}: ${message}`);
            failures.push({ episode: e.title, stage: 'copy', message, fileId: doc.id });
        }
    }

    if (!config.dryRun) await catchUpReviews();

    await sendFailureAlert(config, failures);
    if (failures.length > 0) process.exit(1);
    console.log('🏁 Done.');
}

main().catch(async error => {
    console.error('❌ Podcast ingest crashed:', error);
    await sendFailureAlert(config, [{
        episode: '(whole run)', stage: 'startup', message: error instanceof Error ? error.message : String(error), fileId: '',
    }]).catch(() => {});
    process.exit(1);
});
