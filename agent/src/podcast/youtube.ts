// Spec 005 step 13: upload the approved episode to YouTube. The final cut, the approved title and
// description with the final cut's chapter times, tags, the altered-or-synthetic-content flag,
// the thumbnail approved at Checkpoint D, and captions from the final cut's own transcript.
// Runs in GitHub Actions (.github/workflows/podcast_youtube.yml), started from the show notes page.
// docs/specs/012-youtube-upload.md
//
// The video is uploaded once. Running it again updates that video's title, description, tags,
// thumbnail and captions, and keeps whatever visibility was set in YouTube Studio. With the
// YOUTUBE_PLAYLIST_ID repo variable set, each video is also added to that playlist (the podcast).

import * as fs from 'fs';
import * as path from 'path';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { buildCues, toSrt } from '../../../lib/captions';
import type { TimedWord } from '../../../lib/retime';
import { youtubeMetadata } from '../../../lib/youtube';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { withRetry } from './errors';
import { describeError, failureSubject, sendEmail } from './notify';
import { loadSettings, storageBucket } from './settings';
import { postUsageReport } from './usageReport';
import { createYoutube, type VideoResource } from './youtubeApi';

// Our captions track, told apart from any added by hand in YouTube Studio.
const CAPTION_NAME = 'English';
const PROCESSING_WAIT_MS = 10 * 60_000;

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
initializeApp({ credential: cert(serviceAccount), storageBucket: storageBucket(serviceAccount) });
const ref = getFirestore().collection('episodes').doc(episodeId);
const bucket = getStorage().bucket();
const workDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'youtube', episodeId);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
    const youtube = createYoutube({
        clientId: required('YOUTUBE_CLIENT_ID'),
        clientSecret: required('YOUTUBE_CLIENT_SECRET'),
        refreshToken: required('YOUTUBE_REFRESH_TOKEN'),
    });
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const final = episode.final;
    const approval = episode.approval;
    if (final?.status !== 'ready' || !final.videoPath) throw new Error('Get the final cut first (from Descript or the Editor Light render)');
    const finalAt = (final.finishedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (!approval) throw new Error('Approve the episode first (Checkpoint D)');
    if (approval.notesVersion !== episode.notes?.approvedVersion || approval.finalAt !== finalAt) {
        throw new Error('The notes or the final cut changed after the approval; approve the episode again');
    }
    // The description's link and subscribe lines come from the Studio settings.
    const meta = youtubeMetadata(episode, await loadSettings(getFirestore()));
    if (!meta) throw new Error('Approve the show notes first');
    fs.mkdirSync(workDir, { recursive: true });
    const warnings: string[] = [];
    const approvalAt = (approval.approvedAt as Timestamp | undefined)?.toMillis?.() ?? 0;

    await ref.update({
        'youtube.status': 'uploading', 'youtube.startedAt': FieldValue.serverTimestamp(), 'youtube.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });
    const snippet = {
        title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId,
        defaultLanguage: 'en', defaultAudioLanguage: 'en',
    };

    let videoId = episode.youtube?.videoId;
    let video: VideoResource | null;
    if (videoId) {
        // Already on YouTube: update it in place, keeping its visibility and any schedule.
        const existing = await youtube.getVideo(videoId);
        if (!existing) throw new Error('The video is no longer on YouTube. Use "Forget this upload" on the page, then upload again.');
        console.log(`📝 Updating https://youtu.be/${videoId}`);
        video = await youtube.updateVideo({
            id: videoId, snippet,
            status: {
                privacyStatus: existing.status?.privacyStatus ?? meta.privacyStatus,
                ...(existing.status?.publishAt ? { publishAt: existing.status.publishAt } : {}),
                selfDeclaredMadeForKids: false, containsSyntheticMedia: meta.containsSyntheticMedia,
            },
        });
        if (episode.youtube?.finalAt !== finalAt) {
            warnings.push('The video file on YouTube is from an earlier final cut; only the details were updated. To replace the video, ' +
                'delete it in YouTube Studio, use "Forget this upload", then upload again.');
        }
    } else {
        const local = path.join(workDir, 'episode.mp4');
        await withRetry('Storage download', () => bucket.file(final.videoPath!).download({ destination: local }));
        console.log(`🎬 Uploading "${meta.title}" (${Math.round(fs.statSync(local).size / 1e6)} MB)`);
        video = await youtube.upload(local, {
            snippet,
            status: {
                privacyStatus: meta.privacyStatus, selfDeclaredMadeForKids: false,
                containsSyntheticMedia: meta.containsSyntheticMedia, embeddable: true, license: 'youtube',
            },
        });
        videoId = video.id;
        if (!videoId) throw new Error('YouTube did not return a video ID');
        // Recorded straight away, so a failure below never leads to a second copy.
        await ref.update({
            'youtube.videoId': videoId, 'youtube.url': `https://youtu.be/${videoId}`,
            'youtube.uploadedAt': FieldValue.serverTimestamp(), 'youtube.finalAt': finalAt,
        });
        console.log(`  ✅ Uploaded: https://youtu.be/${videoId}`);
    }

    await ref.update({ 'youtube.status': 'processing' });
    try {
        const [jpeg] = await withRetry('Storage download', () => bucket.file(approval.thumbnailPath).download());
        await youtube.setThumbnail(videoId, jpeg);
        console.log('  ✅ Thumbnail set');
    } catch (error) {
        const message = (error as Error).message;
        console.warn(`  ⚠️ ${message}`);
        warnings.push(/403/.test(message)
            ? 'YouTube refused the thumbnail. Custom thumbnails need a verified channel (YouTube Studio → Settings → Channel → Feature eligibility); then upload again to set it.'
            : `The thumbnail was not set: ${message}`);
    }

    let captionId: string | null = null;
    try {
        if (!final.wordsPath) throw new Error('the final cut has no transcript');
        const [raw] = await withRetry('Storage download', () => bucket.file(final.wordsPath!).download());
        const words = (JSON.parse(raw.toString('utf8')) as { words: TimedWord[] }).words;
        const srt = toSrt(buildCues(words));
        for (const c of await youtube.listCaptions(videoId)) {
            if (c.snippet.name === CAPTION_NAME && c.snippet.language === 'en') await youtube.deleteCaption(c.id);
        }
        captionId = (await youtube.insertCaption(videoId, CAPTION_NAME, srt)).id;
        console.log('  ✅ Captions added');
    } catch (error) {
        const message = (error as Error).message;
        console.warn(`  ⚠️ ${message}`);
        warnings.push(`The captions were not added: ${message}`);
    }

    // The channel's podcast (repo variable YOUTUBE_PLAYLIST_ID); runs on updates too, so older uploads get added.
    const playlistId = process.env.YOUTUBE_PLAYLIST_ID?.trim();
    if (playlistId) {
        try {
            console.log(await youtube.addToPlaylist(playlistId, videoId) ? '  ✅ Added to the podcast playlist' : '  ✅ Already in the podcast playlist');
        } catch (error) {
            const message = (error as Error).message;
            console.warn(`  ⚠️ ${message}`);
            warnings.push(`The video was not added to the podcast playlist (check the YOUTUBE_PLAYLIST_ID repo variable): ${message}`);
        }
    }

    // Wait a little for YouTube to accept the file, so a rejection shows up here.
    const waitUntil = Date.now() + PROCESSING_WAIT_MS;
    let current = await youtube.getVideo(videoId);
    while (current?.status?.uploadStatus === 'uploaded' && Date.now() < waitUntil) {
        await sleep(30_000);
        current = await youtube.getVideo(videoId);
    }
    const s = current?.status;
    if (s?.uploadStatus === 'rejected' || s?.uploadStatus === 'failed') {
        warnings.push(`YouTube ${s.uploadStatus} the video: ${s.rejectionReason ?? s.failureReason ?? 'no reason given'}.`);
    }
    const privacyStatus = s?.privacyStatus ?? video.status?.privacyStatus ?? 'unknown';
    if (!episode.youtube?.videoId && privacyStatus === 'private' && meta.privacyStatus !== 'private') {
        warnings.push('YouTube made it Private: until the API project passes YouTube\'s audit, every upload through the API stays private. ' +
            'Watch it in YouTube Studio; after the audit, uploads will be ' + meta.privacyStatus + '.');
    }

    await ref.update({
        'youtube.status': 'ready',
        'youtube.privacyStatus': privacyStatus,
        'youtube.approvalAt': approvalAt,
        'youtube.captionId': captionId,
        'youtube.playlistId': playlistId || null,
        'youtube.warnings': warnings,
        'youtube.finishedAt': FieldValue.serverTimestamp(),
        'youtube.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });

    // The episode is finished: post what it took to the Usage page (first upload only).
    if (!episode.youtube?.videoId) await postUsageReport(getFirestore(), episodeId, 'finished');

    await sendEmail({ alert }, `On YouTube: ${meta.title}`, [
        `"${meta.title}" is on YouTube (${privacyStatus}):`,
        `https://youtu.be/${videoId}`,
        `YouTube Studio: https://studio.youtube.com/video/${videoId}/edit`,
        ...(warnings.length ? ['', 'Check:', ...warnings.map(w => `  - ${w}`)] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'youtube.status': 'failed', 'youtube.error': message, 'youtube.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await sendEmail({ alert }, failureSubject(`YouTube upload failed: ${episodeId}`, message),
        `The YouTube upload could not be finished.\n\n${describeError(message)}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
