// Spec 005 step 8, part 1: the edit package. Gathers everything for the Descript edit into
// one Drive folder, "03 For Descript/<episode>", from the approved show notes:
//   00 the full episode (a Drive copy of the original) and the show's intro
//      (assets/podcast/intro.mp4 in this repo), which also closes the episode as the outro
//   00 the generic "In this episode" banner, a transparent PNG to place by hand
//   01 each "In this episode" clip, cut from the original, numbered in order, with the
//      "In this episode" tag and the speaker's name in the lower left
//   02 each b-roll image, named with where it goes
//   Notes: title, clip order, chapters, b-roll timings and key quotes
// Runs in GitHub Actions (.github/workflows/podcast_package.yml), started from the show notes
// page. Rebuilding replaces the files in place. docs/specs/009-edit-package.md

import * as fs from 'fs';
import * as path from 'path';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { BROLL_STYLES } from '../../../lib/broll';
import { chapterList, mmss, type ShowNotes } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { copyFile, createDrive, ensureFolder, findFile, listFolderFiles, parentOf, putFile, trashFile } from './drive';
import { withRetry } from './errors';
import { assStill, BROLL_MOTIONS, cutClip, fillFrame, isWidescreen, kenBurns, videoSize } from './media';
import { describeError, failureSubject, sendEmail } from './notify';
import { FONTS_DIR } from './shortsRender';
import { teaserAss } from './teaserBanner';

// Breathing room around each clip, so no word is cut short; trim it in Descript.
const CLIP_LEAD_MS = 300;
const CLIP_TAIL_MS = 600;
const SITE = 'https://soulwisdomcollective.com';
// The show's intro, versioned in the repo; replace the file to change it for later builds.
const INTRO_FILE = path.resolve('assets/podcast/intro.mp4');
const INTRO_NAME = '00 Intro - Soul Wisdom Collective.mp4';
const BANNER_NAME = '00 In this episode banner.png';

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
const workDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'package', episodeId);

// Drive allows almost anything in a name, but the folder gets downloaded to Macs and PCs.
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
const at = (ms: number) => mmss(ms).replace(/:/g, '.');

function notesText(episode: Episode, notes: ShowNotes, clips: string[], broll: string[], brollClips: string[]) {
    const title = notes.titles[notes.chosenTitle] ?? episode.title;
    const lines = [
        title,
        '='.repeat(Math.min(title.length, 80)),
        '',
        `Episode: ${episode.title}${episode.recordedAt ? ` (recorded ${episode.recordedAt.slice(0, 10)})` : ''}`,
        `Show notes: ${SITE}/admin/podcast/${episodeId}/notes`,
        '',
        'Times below are in the full, unedited episode. They shift once filler words and cuts are made.',
        '',
        'TIMELINE: the "In this episode" clips, then the intro, then the full episode, then the intro again as the outro.',
        '',
        'IN THIS EPISODE (cold open, in order)',
        ...(notes.teaserClips.length ? notes.teaserClips.map((c, i) =>
            `  ${i + 1}. [${mmss(c.startMs)}–${mmss(c.endMs)}] ${c.speaker}: "${c.text}"\n     File: ${clips[i] ?? '(not cut)'}`) : ['  (none)']),
        '',
        'CHAPTERS',
        ...chapterList(notes).split('\n').map(l => `  ${l}`),
        '',
        'B-ROLL (place the .mp4 over the moment: the slow pan and zoom is built in; the .png is the still)',
        ...(notes.broll.length ? notes.broll.map((b, i) =>
            `  ${i + 1}. At ${mmss(b.startMs)} for ${b.durationSeconds}s (${BROLL_STYLES[b.style ?? 'photo'].label}): ${b.idea}\n` +
            `     Why: ${b.why}\n     File: ${brollClips[i] ?? broll[i] ?? '(no image yet)'}`) : ['  (none)']),
        '',
        'KEY QUOTES (for shorts)',
        ...(notes.quotes.length ? notes.quotes.map((q, i) => `  ${i + 1}. [${mmss(q.startMs)}–${mmss(q.endMs)}] ${q.speaker}: "${q.text}"`) : ['  (none)']),
        '',
    ];
    return lines.join('\n');
}

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    if (!notes) throw new Error('Approve the show notes first');
    await ref.update({
        'package.status': 'building', 'package.startedAt': FieldValue.serverTimestamp(), 'package.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });

    // "03 For Descript" sits beside "02 Processed" unless a folder is set explicitly.
    const root = process.env.DRIVE_DESCRIPT_FOLDER_ID
        || await ensureFolder(drive, await parentOf(drive, required('DRIVE_PROCESSED_FOLDER_ID')), '03 For Descript');
    const folderId = await ensureFolder(drive, root, safe(episode.title));
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    await ref.update({ 'package.folderId': folderId, 'package.folderUrl': folderUrl });
    console.log(`📦 ${episode.title} → ${folderUrl}`);
    fs.mkdirSync(workDir, { recursive: true });

    const keep: string[] = [];
    const warnings: string[] = [];

    const ext = path.extname(episode.drive.fileName) || '.mp4';
    const sourcePath = episode.media?.sourcePath;
    if (!sourcePath) throw new Error('The original video is not in Cloud Storage');
    const localSource = path.join(workDir, `source${ext}`);
    if (!fs.existsSync(localSource)) {
        console.log('  ⬇️ Downloading the original');
        await withRetry('Storage download', () => bucket.file(sourcePath).download({ destination: localSource }));
    }

    // Recordings that are not 16:9 (Zoom's 1920x1044 and the like) would show thin bars in a
    // 1920x1080 frame. They get a filled copy: scaled evenly, overflow trimmed from the edges,
    // never stretched. The clips are cut the same way.
    const size = await videoSize(localSource);
    const fill = !isWidescreen(size);
    const fillPath = `episodes/${episodeId}/package/episode-1080p.mp4`;
    let episodePath: string | null = null;

    // 00: the full episode. A 16:9 original is copied inside Drive (it stays in 02 Processed).
    const fullName = `00 Full episode - ${safe(episode.title)}${fill ? '.mp4' : ext}`;
    if (fill) {
        episodePath = fillPath;
        const [stored] = await bucket.file(fillPath).exists();
        if (stored && episode.package?.episodePath === fillPath && await findFile(drive, folderId, fullName)) {
            console.log(`  ✔ Full episode already filled to 1920x1080 (from ${size.width}x${size.height})`);
        } else {
            const localFilled = path.join(workDir, 'episode-1080p.mp4');
            if (stored) await withRetry('Storage download', () => bucket.file(fillPath).download({ destination: localFilled }));
            else {
                console.log(`  🎞️ Filling ${size.width}x${size.height} to 1920x1080 (trimming edges, no stretching)`);
                await fillFrame(localSource, localFilled);
                await withRetry('Storage upload', () => bucket.upload(localFilled, { destination: fillPath, resumable: true, metadata: { contentType: 'video/mp4' } }));
            }
            await putFile(drive, folderId, fullName, 'video/mp4', localFilled);
            console.log('  ✅ Full episode (1920x1080)');
        }
    } else if (await findFile(drive, folderId, fullName)) console.log('  ✔ Full episode already there');
    else {
        try {
            await copyFile(drive, episodeId, folderId, fullName);
            console.log('  ✅ Full episode copied');
        } catch (error) {
            warnings.push(`The full episode could not be copied from Drive (${(error as Error).message}); add it by hand.`);
        }
    }
    keep.push(fullName);

    // The intro, also kept in Cloud Storage so Descript can fetch it.
    let introPath: string | null = null;
    if (fs.existsSync(INTRO_FILE)) {
        await putFile(drive, folderId, INTRO_NAME, 'video/mp4', INTRO_FILE);
        introPath = `episodes/${episodeId}/package/intro.mp4`;
        await withRetry('Storage upload', () => bucket.upload(INTRO_FILE, { destination: introPath!, resumable: false, metadata: { contentType: 'video/mp4' } }));
        keep.push(INTRO_NAME);
        console.log('  ✅ Intro');
    } else {
        warnings.push('The intro (assets/podcast/intro.mp4) is missing from the repo, so it was left out.');
    }

    // The generic banner (the tag without a name), for clips added by hand in Descript.
    const localBanner = path.join(workDir, 'banner.png');
    fs.writeFileSync(path.join(workDir, 'banner.ass'), teaserAss({ durationMs: 1000 }));
    fs.writeFileSync(path.join(workDir, 'banner-matte.ass'), teaserAss({ durationMs: 1000, matte: true }));
    await assStill(path.join(workDir, 'banner.ass'), path.join(workDir, 'banner-matte.ass'), FONTS_DIR, localBanner);
    await putFile(drive, folderId, BANNER_NAME, 'image/png', localBanner);
    const bannerPath = `episodes/${episodeId}/package/banner.png`;
    await withRetry('Storage upload', () => bucket.upload(localBanner, { destination: bannerPath, resumable: false, metadata: { contentType: 'image/png' } }));
    keep.push(BANNER_NAME);
    console.log('  ✅ Banner');

    // 01: teaser clips, cut from the original at full quality, with the tag burned in.
    const clips: string[] = [];
    const clipPaths: string[] = [];     // the same clips in Cloud Storage, for the Descript import
    if (notes.teaserClips.length) {
        for (const [i, c] of notes.teaserClips.entries()) {
            const start = Math.max(0, c.startMs - CLIP_LEAD_MS);
            const end = Math.max(c.endMs, c.startMs + 1000) + CLIP_TAIL_MS;
            const name = `01 In this episode - clip ${i + 1} (${at(c.startMs)}-${at(c.endMs)}) ${safe(c.speaker)}.mp4`;
            const local = path.join(workDir, `clip-${i + 1}.mp4`);
            const ass = path.join(workDir, `clip-${i + 1}.ass`);
            fs.writeFileSync(ass, teaserAss({ speaker: c.speaker, durationMs: end - start }));
            await cutClip(localSource, local, start / 1000, (end - start) / 1000, fill, { ass, fontsDir: FONTS_DIR });
            await putFile(drive, folderId, name, 'video/mp4', local);
            const clipPath = `episodes/${episodeId}/package/clip-${i + 1}.mp4`;
            await withRetry('Storage upload', () => bucket.upload(local, { destination: clipPath, resumable: true, metadata: { contentType: 'video/mp4' } }));
            clipPaths.push(clipPath);
            clips.push(name);
            keep.push(name);
            console.log(`  ✅ ${name}`);
        }
    }

    // 02: b-roll, named with where it goes: each image as a clip with a slow zoom or pan built in
    // (alternating, so they do not all move the same way), and the still for animating by hand.
    // Stale or missing images are reported.
    const broll: string[] = [];
    const brollClips: string[] = [];
    const brollClipPaths: (string | null)[] = notes.broll.map(() => null);   // in Cloud Storage, for the Descript import
    for (const [i, b] of notes.broll.entries()) {
        const image = episode.broll?.images?.[i];
        if (!image) {
            warnings.push(`B-roll ${i + 1} has no image yet.`);
            continue;
        }
        if (image.idea !== b.idea.trim() || (image.style ?? 'photo') !== (b.style ?? 'photo')) {
            warnings.push(`B-roll ${i + 1}'s image was made for an older idea or style; regenerate it and rebuild.`);
        }
        const name = `02 B-roll ${i + 1} at ${at(b.startMs)} for ${b.durationSeconds}s.png`;
        const local = path.join(workDir, `broll-${i + 1}.png`);
        await withRetry('Storage download', () => bucket.file(image.path).download({ destination: local }));
        await putFile(drive, folderId, name, 'image/png', local);
        broll[i] = name;
        keep.push(name);

        const motion = BROLL_MOTIONS[i % BROLL_MOTIONS.length];
        const clipName = `02 B-roll ${i + 1} at ${at(b.startMs)} for ${b.durationSeconds}s - moving.mp4`;
        const localClip = path.join(workDir, `broll-${i + 1}.mp4`);
        await kenBurns(local, localClip, b.durationSeconds, motion);
        await putFile(drive, folderId, clipName, 'video/mp4', localClip);
        const clipPath = `episodes/${episodeId}/package/broll-${i + 1}.mp4`;
        await withRetry('Storage upload', () => bucket.upload(localClip, { destination: clipPath, resumable: false, metadata: { contentType: 'video/mp4' } }));
        brollClipPaths[i] = clipPath;
        brollClips[i] = clipName;
        keep.push(clipName);
        console.log(`  ✅ ${clipName} (${{ in: 'zoom in', out: 'zoom out', left: 'pan left', right: 'pan right' }[motion]}) and the still`);
    }

    const notesName = `Notes - ${safe(episode.title)}.txt`;
    const localNotes = path.join(workDir, 'notes.txt');
    fs.writeFileSync(localNotes, notesText(episode, notes, clips, broll, brollClips));
    await putFile(drive, folderId, notesName, 'text/plain', localNotes);
    keep.push(notesName);

    // Files from an earlier build that no longer belong (a clip or idea was removed).
    for (const f of await listFolderFiles(drive, folderId)) {
        if (f.id && f.name && !keep.includes(f.name) && (/^(0[12] |Notes - )/.test(f.name) || f.name.startsWith('00 Full episode - '))) {
            await trashFile(drive, f.id).catch(e => warnings.push(`Could not remove the old "${f.name}" (${(e as Error).message}).`));
        }
    }

    await ref.update({
        'package.status': 'ready',
        'package.files': keep,
        'package.clipPaths': clipPaths,
        'package.brollClipPaths': brollClipPaths,
        'package.introPath': introPath,
        'package.bannerPath': bannerPath,
        'package.episodePath': episodePath,
        'package.sourceSize': `${size.width}x${size.height}`,
        'package.warnings': warnings,
        'package.notesVersion': episode.notes?.approvedVersion ?? 0,
        'package.finishedAt': FieldValue.serverTimestamp(),
        'package.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`✅ ${keep.length} files${warnings.length ? `; ${warnings.length} warning(s):\n  ${warnings.join('\n  ')}` : ''}`);

    await sendEmail({ alert }, `Edit package ready: ${episode.title}`, [
        `Everything for the Descript edit of "${episode.title}" is in one folder:`,
        folderUrl,
        '',
        ...keep.map(n => `  ${n}`),
        ...(warnings.length ? ['', 'Check:', ...warnings.map(w => `  - ${w}`)] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'package.status': 'failed', 'package.error': message, 'package.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await sendEmail({ alert }, failureSubject(`Edit package failed: ${episodeId}`, message),
        `The edit package could not be built.\n\n${describeError(message)}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
