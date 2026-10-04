// Spec 005 step 12: the raw material for three thumbnail options, made from the final cut and
// the approved show notes:
//   - five short texts for the image, from Claude
//   - frames from the final cut at the strongest quotes, for the producer to pick from
//   - one AI background in the brand look
// The Studio draws the three options from these (components/studio/thumbnailCanvas.ts) and the
// producer picks one at Checkpoint D. Runs in GitHub Actions (.github/workflows/podcast_thumbnails.yml).
// docs/specs/011-thumbnails.md
//
// THUMB_ONLY=image: make only a new AI background, from the idea the producer wrote.

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { BROLL_MODEL, BROLL_QUALITY, BROLL_SIZE, BROLL_USD_PER_IMAGE, type BrollStyle } from '../../../lib/broll';
import { thumbnailsSystemPrompt, type StudioSettings } from '../../../lib/studioSettings';
import { FRAME_CANDIDATES, HOOK_MAX_CHARS, HooksSchema, thumbnailImagePrompt } from '../../../lib/thumbnail';
import type { Episode, EpisodeThumbnails, ThumbnailFrame } from '../../../types/episode';
import { loadAlert } from './config';
import { withRetry } from './errors';
import { grabFrame } from './media';
import { NOTES_EFFORT, NOTES_MODEL } from './notesDraft';
import { describeError, failureSubject, sendEmail } from './notify';
import { loadSettings, storageBucket } from './settings';

// US dollars per million tokens, for the cost record.
const HOOKS_USD_PER_MTOK = { input: 4, output: 20 };
// Frames closer together than this show the same moment.
const MIN_FRAME_GAP_MS = 20_000;

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const onlyImage = process.env.THUMB_ONLY === 'image';
const alert = loadAlert();
const runUrl = process.env.GITHUB_RUN_URL || '';
const serviceAccount = JSON.parse(required('PODCAST_SA_JSON'));
initializeApp({ credential: cert(serviceAccount), storageBucket: storageBucket(serviceAccount) });
const ref = getFirestore().collection('episodes').doc(episodeId);
const bucket = getStorage().bucket();
const workDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'thumbnails', episodeId);

// The Studio settings (lib/studioSettings.ts): the writing and image style. Loaded first in main().
let settings: StudioSettings;

async function draftHooks(episode: Episode) {
    const notes = episode.notes!.approved!;
    const client = new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.stream({
        model: NOTES_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: NOTES_EFFORT, format: betaZodOutputFormat(HooksSchema) },
        system: thumbnailsSystemPrompt(settings),
        messages: [{
            role: 'user',
            content: `YouTube title: ${notes.titles[notes.chosenTitle] ?? episode.title}\n\n` +
                `Description:\n${notes.description}\n\nSummary:\n${notes.summary}\n\n` +
                `Key quotes:\n${notes.quotes.slice(0, 12).map(q => `- ${q.speaker}: "${q.text.slice(0, 400)}"`).join('\n')}\n\n` +
                'Write the thumbnail texts and the background image idea.',
        }],
    }).finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write thumbnail texts');
    if (!response.parsed_output) throw new Error('Claude returned thumbnail texts in an unexpected shape');
    const { hooks, image } = response.parsed_output;
    const { input_tokens, output_tokens } = response.usage;
    const usd = Math.round((input_tokens * HOOKS_USD_PER_MTOK.input + output_tokens * HOOKS_USD_PER_MTOK.output) / 1e4) / 100;
    const clean = hooks.map(h => h.replace(/\s+/g, ' ').trim()).filter(h => h && h.replace(/\*/g, '').length <= HOOK_MAX_CHARS);
    if (!clean.length) throw new Error('Claude wrote no usable thumbnail texts');
    return { hooks: clean.slice(0, 5), image, usd };
}

// The strongest quotes are the likeliest frames with an expressive face; a couple of seconds
// in, the speaker is mid-thought rather than drawing breath.
function frameTimes(episode: Episode) {
    const quotes = [...(episode.final?.quotes ?? [])].sort((a, b) => a.startMs - b.startMs);
    const spaced: typeof quotes = [];
    for (const q of quotes) {
        if (!spaced.length || q.startMs - spaced[spaced.length - 1].startMs >= MIN_FRAME_GAP_MS) spaced.push(q);
    }
    const step = Math.max(1, spaced.length / FRAME_CANDIDATES);
    const picked = Array.from({ length: Math.min(FRAME_CANDIDATES, spaced.length) }, (_, i) => spaced[Math.floor(i * step)]);
    return picked.map(q => ({ atMs: q.startMs + Math.min(2500, Math.max(0, (q.endMs - q.startMs) / 2)), speaker: q.speaker, text: q.text }));
}

async function grabFrames(episode: Episode, stamp: number): Promise<ThumbnailFrame[]> {
    const videoPath = episode.final!.videoPath!;
    // ffmpeg reads the final cut straight from Storage, only around each moment.
    const [url] = await bucket.file(videoPath).getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60_000 });
    const durationMs = (episode.final!.durationSeconds ?? 0) * 1000;
    const frames: ThumbnailFrame[] = [];
    for (const [i, t] of frameTimes(episode).entries()) {
        const atMs = Math.min(t.atMs, Math.max(0, durationMs - 1000));
        const local = path.join(workDir, `frame-${i}.jpg`);
        // One unreadable moment only costs a candidate.
        try {
            await grabFrame(url, local, atMs / 1000);
        } catch (error) {
            console.warn(`  ⚠️ No frame at ${Math.round(atMs / 1000)}s: ${(error as Error).message}`);
            continue;
        }
        const dest = `episodes/${episodeId}/thumbnails/frame-${String(i + 1).padStart(2, '0')}-${stamp}.jpg`;
        await withRetry('Storage upload', () => bucket.upload(local, { destination: dest, metadata: { contentType: 'image/jpeg' } }));
        frames.push({ path: dest, atMs, speaker: t.speaker, text: t.text.slice(0, 200) });
        console.log(`  ✅ Frame ${frames.length} at ${Math.round(atMs / 1000)}s (${t.speaker})`);
    }
    if (!frames.length) throw new Error('The final cut has no quotes to take frames from');
    return frames;
}

async function makeImage(idea: string, style: BrollStyle, stamp: number): Promise<NonNullable<EpisodeThumbnails['image']>> {
    const openai = new OpenAI({ apiKey: required('OPENAI_API_KEY') });
    const prompt = thumbnailImagePrompt(idea, style, settings.imageStyle);
    const result = await openai.images.generate({
        model: BROLL_MODEL, prompt, size: BROLL_SIZE, quality: BROLL_QUALITY, output_format: 'png', n: 1,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new Error('No AI image came back');
    const dest = `episodes/${episodeId}/thumbnails/ai-${stamp}.png`;
    await bucket.file(dest).save(Buffer.from(b64, 'base64'), { contentType: 'image/png', resumable: false });
    console.log(`  ✅ AI image (${style}): ${idea.slice(0, 70)}`);
    return { idea: idea.trim(), style, prompt, model: BROLL_MODEL, path: dest, usd: BROLL_USD_PER_IMAGE, createdAt: new Date() };
}

async function main() {
    settings = await loadSettings(getFirestore());
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    if (episode.notes?.status !== 'approved' || !episode.notes.approved) throw new Error('Approve the show notes first');
    const final = episode.final;
    if (final?.status !== 'ready' || !final.videoPath) throw new Error('Get the final cut first (from Descript or the Editor Light render)');
    fs.mkdirSync(workDir, { recursive: true });
    const stamp = Date.now();
    await ref.update({
        'thumbnails.status': 'working', 'thumbnails.startedAt': FieldValue.serverTimestamp(), 'thumbnails.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });

    if (onlyImage) {
        const request = episode.thumbnails?.imageRequest ?? episode.thumbnails?.image;
        if (!request?.idea) throw new Error('Write an idea for the AI image first');
        const image = await makeImage(request.idea, request.style, stamp);
        await ref.update({
            'thumbnails.status': 'ready', 'thumbnails.image': image, 'thumbnails.imageRequest': null,
            'thumbnails.finishedAt': FieldValue.serverTimestamp(),
            'costs.items': FieldValue.arrayUnion({ item: 'thumbnail_image', usd: image.usd, at: new Date() }),
            'costs.totalUsd': FieldValue.increment(image.usd),
            updatedAt: FieldValue.serverTimestamp(),
        });
        return;
    }

    console.log(`🖼️  Thumbnails for ${episode.title}`);
    const hooks = await withRetry('Claude', () => draftHooks(episode), 3);
    console.log(`  ✅ Texts: ${hooks.hooks.join(' | ')}`);
    const frames = await grabFrames(episode, stamp);
    // Without the AI background the frame and brand options still work, so a failed image (the
    // OpenAI account out of credits, say) is a note on the page rather than a failed run.
    let image: Awaited<ReturnType<typeof makeImage>> | null = null;
    let imageError: string | null = null;
    try {
        image = await makeImage(hooks.image.idea, hooks.image.style, stamp);
    } catch (error) {
        const message = (error as Error).message;
        const hint = /no credits|quota|billing/i.test(message) ? ' The OpenAI account is out of credits; add some at platform.openai.com (Settings → Billing).' : '';
        imageError = `The AI image could not be made (${message}).${hint} The frame and brand options are ready. ` +
            `To try again, write an idea under "AI image" and press "New AI image"; the suggested one was: ${hooks.image.idea}`;
        console.log(`  ⚠️ ${imageError}`);
    }
    const usd = Math.round((hooks.usd + (image?.usd ?? 0)) * 100) / 100;

    // A fresh set replaces the producer's earlier picks, which pointed at the old frames.
    await ref.update({
        'thumbnails.status': 'ready',
        'thumbnails.hooks': hooks.hooks,
        'thumbnails.frames': frames,
        'thumbnails.image': image,
        'thumbnails.imageRequest': null,
        'thumbnails.error': imageError,
        'thumbnails.finalAt': (final.finishedAt as Timestamp | undefined)?.toMillis?.() ?? 0,
        'thumbnails.text': hooks.hooks[0],
        'thumbnails.frame': 0,
        'thumbnails.choice': null,
        'thumbnails.finishedAt': FieldValue.serverTimestamp(),
        'costs.items': FieldValue.arrayUnion(
            { item: 'thumbnail_text', usd: hooks.usd, at: new Date() },
            ...(image ? [{ item: 'thumbnail_image', usd: image.usd, at: new Date() }] : [])),
        'costs.totalUsd': FieldValue.increment(usd),
        updatedAt: FieldValue.serverTimestamp(),
    });

    await sendEmail({ alert }, `Thumbnail options ready: ${episode.title}`, [
        `Three thumbnail options for "${episode.title}" are ready to pick from (Checkpoint D):`,
        `${settings.studioUrl}/admin/podcast/${episodeId}/notes#thumbnail`,
        '',
        'Suggested texts:',
        ...hooks.hooks.map(h => `  ${h.replace(/\*/g, '')}`),
        ...(imageError ? ['', `Check: ${imageError}`] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'thumbnails.status': 'failed', 'thumbnails.error': message, 'thumbnails.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    await sendEmail({ alert }, failureSubject(`Thumbnails failed: ${episodeId}`, message),
        `The thumbnail options could not be made.\n\n${describeError(message)}\n\nTry again from the show notes page.${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
