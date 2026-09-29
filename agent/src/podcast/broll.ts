// Spec 005 step 7: generate b-roll stills for one episode from its approved show notes.
// Runs in GitHub Actions (.github/workflows/podcast_broll.yml), started from the show notes
// page in the Podcast Studio. docs/specs/008-broll-images.md
//
// BROLL_INDEX set: regenerate that one image. Unset: generate every image that is missing
// or whose idea or style has changed since it was made, and drop images for ideas that were removed.

import OpenAI from 'openai';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { BROLL_MODEL, BROLL_QUALITY, BROLL_SIZE, BROLL_USD_PER_IMAGE, brollPrompt, type BrollStyle } from '../../../lib/broll';
import type { BrollImage, Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { describeError, failureSubject, sendEmail } from './notify';

// Images at once; each takes up to a minute or two.
const PARALLEL = 3;

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const only = process.env.BROLL_INDEX ? Number(process.env.BROLL_INDEX) : null;
if (only !== null && !(Number.isInteger(only) && only >= 0)) throw new Error(`Not a valid b-roll index: ${process.env.BROLL_INDEX}`);
initializeApp({
    credential: cert(JSON.parse(required('PODCAST_SA_JSON'))),
    storageBucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
});
const ref = getFirestore().collection('episodes').doc(episodeId);
const alert = loadAlert();
const runUrl = process.env.GITHUB_RUN_URL || '';

const failureEmail = (message: string, what: string) => sendEmail({ alert }, failureSubject(`B-roll images failed: ${episodeId}`, message),
    `${what}\n\n${describeError(message)}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const ideas = episode.notes?.status === 'approved' ? episode.notes.approved?.broll ?? [] : [];
    if (!ideas.length) throw new Error('Approve show notes with at least one b-roll idea first');
    if (only !== null && only >= ideas.length) throw new Error(`There is no b-roll idea ${only + 1}`);

    // Notes approved before styles existed have none; they are photoreal.
    const styleOf = (i: number): BrollStyle => (ideas[i] as { style?: BrollStyle }).style ?? 'photo';
    const existing = episode.broll?.images ?? {};
    const todo = only !== null
        ? [only]
        : ideas.map((_, i) => i).filter(i =>
            existing[i]?.idea !== ideas[i].idea.trim() || (existing[i]?.style ?? 'photo') !== styleOf(i));
    const removed = only === null ? Object.keys(existing).filter(k => Number(k) >= ideas.length) : [];

    await ref.update({
        'broll.status': 'generating', 'broll.startedAt': FieldValue.serverTimestamp(), 'broll.error': null,
        ...Object.fromEntries(removed.map(k => [`broll.images.${k}`, FieldValue.delete()])),
        updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`🖼️  ${episode.title}: ${todo.length} of ${ideas.length} image(s) to generate`);

    const openai = new OpenAI({ apiKey: required('OPENAI_API_KEY') });
    const bucket = getStorage().bucket();
    const failures: string[] = [];

    async function generate(i: number) {
        const idea = ideas[i];
        const style = styleOf(i);
        const prompt = brollPrompt(idea.idea, style);
        try {
            const result = await openai.images.generate({
                model: BROLL_MODEL, prompt, size: BROLL_SIZE, quality: BROLL_QUALITY, output_format: 'png', n: 1,
            });
            const b64 = result.data?.[0]?.b64_json;
            if (!b64) throw new Error('No image came back');
            const path = `episodes/${episodeId}/broll/${String(i + 1).padStart(2, '0')}-${Date.now()}.png`;
            await bucket.file(path).save(Buffer.from(b64, 'base64'), { contentType: 'image/png', resumable: false });
            const image: BrollImage = {
                index: i, idea: idea.idea.trim(), style, startMs: idea.startMs, durationSeconds: idea.durationSeconds,
                prompt, model: BROLL_MODEL, quality: BROLL_QUALITY, size: BROLL_SIZE, path,
                usd: BROLL_USD_PER_IMAGE, createdAt: new Date(),
            };
            // Each image is saved as soon as it is ready, so the page fills in as the run goes.
            await ref.update({
                [`broll.images.${i}`]: image,
                'costs.items': FieldValue.arrayUnion({ item: `broll_${i + 1}`, usd: BROLL_USD_PER_IMAGE, at: new Date() }),
                'costs.totalUsd': FieldValue.increment(BROLL_USD_PER_IMAGE),
                updatedAt: FieldValue.serverTimestamp(),
            });
            console.log(`  ✅ ${i + 1} (${style}): ${idea.idea.slice(0, 70)}`);
        } catch (error) {
            const message = (error as Error).message;
            console.error(`  ❌ ${i + 1}: ${message}`);
            failures.push(`Image ${i + 1}: ${message}`);
        }
    }

    const queue = [...todo];
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) await generate(i);
    }));

    await ref.update({
        'broll.status': failures.length === todo.length && todo.length ? 'failed' : 'ready',
        'broll.error': failures.length ? failures.join('; ') : null,
        'broll.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
    if (failures.length) {
        console.error(`${failures.length} image(s) failed`);
        await failureEmail(failures.join('\n'), `${failures.length} of ${todo.length} b-roll image(s) could not be made.`);
        process.exit(1);
    }
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'broll.status': 'failed', 'broll.error': message, 'broll.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await failureEmail(message, 'The b-roll images could not be made.');
    process.exit(1);
});
