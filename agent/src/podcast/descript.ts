// Spec 005 step 8, part 2: make the Descript project from the edit package, through
// Descript's API (https://docs.descriptapi.com). One composition, "Episode": the
// "In this episode" clips in order, then the intro, then the full episode, then the intro again as the outro. B-roll images go in as media for
// the producer to place. Then Underlord removes filler words and applies Studio Sound.
// Runs in GitHub Actions (.github/workflows/podcast_descript.yml), started from the show
// notes page. Each run makes a new project. docs/specs/009-edit-package.md

import * as path from 'path';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { mmss } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { createDescript } from './descriptApi';
import { sendEmail } from './notify';

const FOLDER = 'Soul Wisdom Podcast';
const COMPOSITION = 'Episode';
// Descript asks for URLs that stay valid 12-48 hours.
const LINK_MS = 36 * 60 * 60_000;

const CLEAN_PROMPT = `In the composition "${COMPOSITION}", remove filler words (such as um, uh, and repeated false ` +
    'starts) throughout, and apply Studio Sound to every clip. Do not remove, shorten, reorder or add anything else: ' +
    'a producer will make every other edit by hand.';

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const { call: descript, waitFor } = createDescript(required('DESCRIPT_API_TOKEN'));
const alert = loadAlert();
const runUrl = process.env.GITHUB_RUN_URL || '';
initializeApp({
    credential: cert(JSON.parse(required('PODCAST_SA_JSON'))),
    storageBucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
});
const ref = getFirestore().collection('episodes').doc(episodeId);
const bucket = getStorage().bucket();

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);

const signed = async (objectPath: string) =>
    (await bucket.file(objectPath).getSignedUrl({ action: 'read', expires: Date.now() + LINK_MS }))[0];

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    if (!notes) throw new Error('Approve the show notes first');
    const pkg = episode.package;
    if (pkg?.status !== 'ready') throw new Error('Build the edit package first');
    if ((pkg.notesVersion ?? -1) !== (episode.notes?.approvedVersion ?? 0)) {
        throw new Error('The notes were approved again after the edit package was built; rebuild the package first');
    }
    const clipPaths = pkg.clipPaths ?? [];
    if (clipPaths.length !== notes.teaserClips.length) throw new Error('The edit package has no clips in Cloud Storage; rebuild it first');
    const sourcePath = episode.media?.sourcePath;
    if (!sourcePath) throw new Error('The original video is not in Cloud Storage');

    await ref.update({
        'descript.status': 'importing', 'descript.startedAt': FieldValue.serverTimestamp(), 'descript.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });

    // Media keys are the names (and folders) the producer sees in the Descript project.
    const title = notes.titles[notes.chosenTitle] ?? episode.title;
    // The package's 1920x1080 fill of a recording that is not 16:9, otherwise the original.
    const episodeFile = pkg.episodePath ?? sourcePath;
    const fullKey = `Full episode/${safe(episode.title)}${path.extname(episodeFile) || '.mp4'}`;
    const clipKeys = notes.teaserClips.map((c, i) => `In this episode/Clip ${i + 1} - ${safe(c.speaker)}.mp4`);
    const addMedia: Record<string, { url: string; language: string }> = {};
    for (const [i, key] of clipKeys.entries()) addMedia[key] = { url: await signed(clipPaths[i]), language: 'en' };
    const introKey = 'Intro/Soul Wisdom Collective intro.mp4';
    const warnings: string[] = [];
    // The outro is the intro again, under its own name so it is a clip of its own on the timeline.
    const outroKey = 'Intro/Soul Wisdom Collective outro.mp4';
    if (pkg.introPath) {
        addMedia[introKey] = { url: await signed(pkg.introPath), language: 'en' };
        addMedia[outroKey] = { url: await signed(pkg.introPath), language: 'en' };
    }
    else warnings.push('The edit package has no intro; rebuild it to include one.');
    addMedia[fullKey] = { url: await signed(episodeFile), language: 'en' };
    // The generic "In this episode" banner, to place over clips added by hand (the cut clips have it already).
    if (pkg.bannerPath) addMedia['Titles/In this episode banner.png'] = { url: await signed(pkg.bannerPath), language: 'en' };
    for (const [i, b] of notes.broll.entries()) {
        const image = episode.broll?.images?.[i];
        if (!image) {
            warnings.push(`B-roll ${i + 1} had no image, so it was not sent.`);
            continue;
        }
        addMedia[`B-roll/${String(i + 1).padStart(2, '0')} at ${mmss(b.startMs).replace(/:/g, '.')} for ${b.durationSeconds}s.png`] = {
            url: await signed(image.path), language: 'en',
        };
    }

    const created = await descript<{ job_id: string; project_id: string; project_url: string }>('POST', '/jobs/import/project_media', {
        project_name: safe(title),
        folder_name: FOLDER,
        team_access: 'edit',
        add_media: addMedia,
        add_compositions: [{ name: COMPOSITION, width: 1920, height: 1080, clips: [...clipKeys, ...(pkg.introPath ? [introKey, fullKey, outroKey] : [fullKey])].map(media => ({ media })) }],
    });
    console.log(`🎬 Descript project ${created.project_url} (import job ${created.job_id})`);
    await ref.update({
        'descript.projectId': created.project_id, 'descript.projectUrl': created.project_url,
        'descript.importJobId': created.job_id, 'descript.agentJobId': null, 'descript.agentResponse': null,
    });

    const imported = await waitFor(created.job_id, 'import');
    const result = imported.result;
    if (!result || (result.status !== 'success' && result.status !== 'partial')) {
        throw new Error(`Descript could not import the media: ${result?.error_message ?? result?.status ?? 'no result'}`);
    }
    for (const [key, s] of Object.entries(result.media_status ?? {})) {
        if (s.status !== 'success') warnings.push(`"${key}" did not import: ${s.error_message ?? 'unknown error'}`);
    }
    if (result.media_status?.[fullKey]?.status !== 'success') throw new Error('Descript could not import the full episode');
    const compositionId = result.created_compositions?.find(c => c.name === COMPOSITION)?.id ?? result.created_compositions?.[0]?.id;
    const mediaSeconds = result.media_seconds_used ?? 0;
    console.log(`  ✅ Imported (${Math.round(mediaSeconds / 60)} media minutes)`);

    await ref.update({ 'descript.status': 'cleaning', 'descript.compositionId': compositionId ?? null });
    const agent = await descript<{ job_id: string }>('POST', '/jobs/agent', {
        project_id: created.project_id,
        ...(compositionId ? { composition_id: compositionId } : {}),
        prompt: CLEAN_PROMPT,
    });
    await ref.update({ 'descript.agentJobId': agent.job_id });
    const cleaned = await waitFor(agent.job_id, 'clean-up');
    if (cleaned.result?.status !== 'success') {
        // The project exists and is usable; say what did not happen rather than failing it.
        warnings.push(`Underlord could not finish the clean-up (${cleaned.result?.error_message ?? 'no reason given'}); ` +
            'remove filler words and apply Studio Sound in Descript.');
    }
    const agentResponse = cleaned.result?.agent_response ?? '';
    const aiCredits = cleaned.result?.ai_credits_used ?? 0;
    console.log(`  ✅ Clean-up: ${agentResponse.slice(0, 300)}`);

    await ref.update({
        'descript.status': 'ready',
        'descript.agentResponse': agentResponse,
        'descript.warnings': warnings,
        'descript.mediaSecondsUsed': mediaSeconds + (cleaned.result?.media_seconds_used ?? 0),
        'descript.aiCreditsUsed': aiCredits,
        'descript.notesVersion': episode.notes?.approvedVersion ?? 0,
        'descript.finishedAt': FieldValue.serverTimestamp(),
        'descript.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });

    await sendEmail({ alert }, `Ready to edit in Descript: ${episode.title}`, [
        `The Descript project for "${episode.title}" is ready:`,
        created.project_url,
        '',
        `The "${COMPOSITION}" timeline has the ${clipKeys.length} "In this episode" clips, then ${pkg.introPath ? 'the intro, then the full episode, then the intro again as the outro' : 'the full episode'}.`,
        'B-roll images are in the B-roll media folder, named with where they go; the "In this episode" banner is in Titles.',
        'Filler words removed and Studio Sound applied:',
        agentResponse ? `  ${agentResponse}` : '  (no summary from Underlord)',
        ...(warnings.length ? ['', 'Check:', ...warnings.map(w => `  - ${w}`)] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'descript.status': 'failed', 'descript.error': message, 'descript.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await sendEmail({ alert }, `Descript import failed: ${episodeId}`,
        `The Descript project could not be made.\n\nError: ${message}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
