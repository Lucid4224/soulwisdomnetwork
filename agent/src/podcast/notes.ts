// Spec 005 step 5: draft the show notes for one episode from its accepted transcript.
// Runs in GitHub Actions (.github/workflows/podcast_notes.yml), started by the Podcast
// Studio when a transcript is accepted or a producer asks for new notes.
// docs/specs/007-show-notes.md

import Anthropic from '@anthropic-ai/sdk';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { mmss } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { draftNotes, type ReviewedLine } from './notesDraft';
import { describeError, failureSubject, sendEmail } from './notify';

const SITE = 'https://soulwisdomcollective.com';

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const alert = loadAlert();
const runUrl = process.env.GITHUB_RUN_URL || '';
initializeApp({
    credential: cert(JSON.parse(required('PODCAST_SA_JSON'))),
    storageBucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
});
const ref = getFirestore().collection('episodes').doc(episodeId);
let approved = false;   // never overwrite approved notes, even to record a failure

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
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
    const { notes, unverified, model, inputTokens, outputTokens, usd } = await draftNotes(client, episode, lines);
    console.log(`✅ ${model}: ${inputTokens} in, ${outputTokens} out, ~$${usd}; ${unverified.length} quote(s) not found verbatim`);

    await ref.update({
        'notes.status': 'ready',
        'notes.generated': notes,
        'notes.draft': notes,
        'notes.version': FieldValue.increment(1),
        'notes.model': model,
        'notes.unverifiedQuotes': unverified,
        'notes.generatedAt': FieldValue.serverTimestamp(),
        'notes.error': null,
        'costs.items': FieldValue.arrayUnion({ item: 'show_notes', usd, at: new Date() }),
        'costs.totalUsd': FieldValue.increment(usd),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await sendEmail({ alert }, `Show notes ready: ${episode.title}`, [
        `Claude has drafted the show notes for "${episode.title}".`,
        '',
        `Review and approve them: ${SITE}/admin/podcast/${episodeId}/notes`,
        '',
        `Suggested title: ${notes.titles[0]}`,
        '',
        'In this episode:',
        ...notes.teaserClips.map(c => `  [${mmss(c.startMs)}] ${c.speaker}: "${c.text}"`),
        '',
        notes.summary,
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    if (!approved) {
        await ref.update({ 'notes.status': 'failed', 'notes.error': message, updatedAt: FieldValue.serverTimestamp() })
            .catch(() => {});
    }
    await sendEmail({ alert }, failureSubject(`Show notes failed: ${episodeId}`, message),
        `Show notes could not be drafted.\n\n${describeError(message)}\n\nTry again from the Podcast Studio.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
