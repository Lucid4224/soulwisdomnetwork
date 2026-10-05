// Spec 005 step 5: draft the show notes for one episode from its accepted transcript.
// The same run also writes the social posts and follow-up email when those were asked for.
// Runs in GitHub Actions (.github/workflows/podcast_notes.yml), started by the Podcast
// Studio when a transcript is accepted or a producer asks for new notes.
// docs/specs/007-show-notes.md

import Anthropic from '@anthropic-ai/sdk';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { mmss, mergeRedraft, parseShowNotes, redraftDirection } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { writeExtras } from './extras';
import { draftNotes, NOTES_EFFORT, NOTES_MODEL, type ReviewedLine } from './notesDraft';
import { describeError, failureSubject, sendEmail } from './notify';
import { loadSettings, storageBucket } from './settings';

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
let approved = false;   // never overwrite approved notes, even to record a failure
let extrasRun = false;  // the extras run, so the catch handler knows which failure to record

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    // Notes waiting to be drafted go first; the other run started does the extras.
    if (episode.extras?.status === 'queued' && episode.notes?.status !== 'queued') return runExtras(episode);
    const reviewedPath = episode.review?.reviewedPath;
    if (episode.status !== 'speakers_confirmed' || !reviewedPath) {
        throw new Error('The transcript has not been accepted yet');
    }
    if (episode.notes?.status === 'approved') {
        approved = true;
        throw new Error('Show notes are already approved; nothing to do');
    }

    await ref.update({
        'notes.status': 'generating', 'notes.startedAt': FieldValue.serverTimestamp(), 'notes.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });

    const [raw] = await getStorage().bucket().file(reviewedPath).download();
    const lines = (JSON.parse(raw.toString('utf8')) as { lines: ReviewedLine[] }).lines;
    console.log(`📝 ${episode.title}: ${lines.length} lines`);

    const client = new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') });
    // The Studio settings choose the kind of recording and the writing (lib/studioSettings.ts).
    const settings = await loadSettings(getFirestore());
    const SITE = settings.studioUrl;
    // A redraft request from the producer: the direction goes into the prompt, and only the
    // chosen part is replaced.
    const redraft = episode.notes?.redraft ?? null;
    const direction = redraftDirection(redraft);
    const { notes, unverified, model, inputTokens, outputTokens, usd } = await draftNotes(client, episode, lines, NOTES_MODEL, NOTES_EFFORT, settings, direction);
    // When only one part is redrafted, the saved draft keeps the rest as the producer left it.
    const merged = redraft && redraft.only !== 'all' && episode.notes?.draft
        ? mergeRedraft(parseShowNotes(episode.notes.draft), notes, redraft.only) : notes;
    console.log(`✅ ${model}: ${inputTokens} in, ${outputTokens} out, ~$${usd}; ${unverified.length} quote(s) not found verbatim`);

    await ref.update({
        'notes.status': 'ready',
        'notes.generated': notes,
        'notes.draft': merged,
        'notes.version': FieldValue.increment(1),
        'notes.model': model,
        'notes.unverifiedQuotes': unverified,
        'notes.generatedAt': FieldValue.serverTimestamp(),
        'notes.error': null,
        'notes.redraft': null,
        'costs.items': FieldValue.arrayUnion({ item: 'show_notes', usd, at: new Date() }),
        'costs.totalUsd': FieldValue.increment(usd),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await sendEmail({ alert }, `Show notes ready: ${episode.title}`, [
        `Claude has drafted the show notes for "${episode.title}".`,
        '',
        `Review and approve them: ${SITE}/admin/podcast/${episodeId}/notes#notes`,
        '',
        `Suggested title: ${notes.titles[0]}`,
        '',
        'In this episode:',
        ...notes.teaserClips.map(c => `  [${mmss(c.startMs)}] ${c.speaker}: "${c.text}"`),
        '',
        notes.summary,
    ].join('\n'));
}

// Writes the social posts and follow-up email when the producer asked for them; the notes are already approved.
async function runExtras(episode: Episode) {
    extrasRun = true;
    await ref.update({
        'extras.status': 'working',
        'extras.startedAt': FieldValue.serverTimestamp(),
        'extras.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });
    const client = new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') });
    const settings = await loadSettings(getFirestore());
    const { extras, usd } = await writeExtras(client, episode, settings);
    await ref.update({
        'extras.status': 'ready',
        'extras.result': extras,
        'extras.generatedAt': FieldValue.serverTimestamp(),
        'extras.error': null,
        'costs.items': FieldValue.arrayUnion({ item: 'writing_extras', usd, at: new Date() }),
        'costs.totalUsd': FieldValue.increment(usd),
        updatedAt: FieldValue.serverTimestamp(),
    });
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    if (extrasRun) {
        await ref.update({ 'extras.status': 'failed', 'extras.error': message, updatedAt: FieldValue.serverTimestamp() })
            .catch(() => {});
        await sendEmail({ alert }, failureSubject(`Social posts failed: ${episodeId}`, message),
            `The social posts and follow-up email could not be written.\n\n${describeError(message)}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
        process.exit(1);
    }
    if (!approved) {
        await ref.update({ 'notes.status': 'failed', 'notes.error': message, updatedAt: FieldValue.serverTimestamp() })
            .catch(() => {});
    }
    await sendEmail({ alert }, failureSubject(`Show notes failed: ${episodeId}`, message),
        `Show notes could not be drafted.\n\n${describeError(message)}\n\nTry again from the Podcast Studio.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
