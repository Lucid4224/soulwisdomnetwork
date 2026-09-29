// Spec 005 step 14: Shorts from the key quotes, cut from the final cut (docs/specs/013-shorts.md).
// Three jobs, picked by SHORTS_MODE:
//   suggest  Claude picks the best moments among the final cut's key quotes, trims each to a
//            self-contained 20-60 seconds and writes a headline and a title
//   render   draws each short that changed: 1080x1920, the episode's picture trimmed at the
//            sides above large word-by-word captions, in the brand look (shortsRender.ts)
//   upload   uploads the shorts approved at Checkpoint E to YouTube, Private and scheduled one a
//            day, each linking to the full episode
// The producer edits, watches and approves them on the show notes page in between. Runs in GitHub
// Actions (.github/workflows/podcast_shorts.yml). No Descript: nothing here uses its credits.

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { TimedWord } from '../../../lib/retime';
import {
    aspectRatio, DEFAULT_ASPECT, renderInputs, sameRender, SHORT_HEIGHT, SHORT_MAX_MS, SHORT_MIN_MS, SHORT_TITLE_MAX,
    SHORT_WIDTH, shortLayout, shortMetadata, SHORTS_SUGGESTED, ShortSuggestionsSchema, showsBroll, wordBounds, wordsBetween,
    HEADLINE_MAX_CHARS, type ShortAspect,
} from '../../../lib/shorts';
import { SITE_URL } from '../../../lib/showNotes';
import { YOUTUBE_CATEGORY } from '../../../lib/youtube';
import type { Episode, EpisodeShorts, ShortItem } from '../../../types/episode';
import { loadAlert } from './config';
import { withRetry } from './errors';
import { renderShort, shortBackground } from './media';
import { NOTES_EFFORT, NOTES_MODEL } from './notesDraft';
import { sendEmail } from './notify';
import { FONTS_DIR, LOGO, shortAss } from './shortsRender';
import { createYoutube, YoutubeError } from './youtubeApi';

// US dollars per million tokens, for the cost record.
const SUGGEST_USD_PER_MTOK = { input: 4, output: 20 };
// Words shown to Claude around each quote, so it can start or end a little outside it.
const QUOTE_CONTEXT_MS = 3000;
// YouTube needs a scheduled time comfortably in the future.
const MIN_LEAD_MS = 10 * 60_000;

type Mode = 'suggest' | 'render' | 'upload';

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const mode = required('SHORTS_MODE') as Mode;
if (!['suggest', 'render', 'upload'].includes(mode)) throw new Error(`Not a shorts job: ${mode}`);
const alert = loadAlert();
const runUrl = process.env.GITHUB_RUN_URL || '';
initializeApp({
    credential: cert(JSON.parse(required('PODCAST_SA_JSON'))),
    storageBucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
});
const db = getFirestore();
const ref = db.collection('episodes').doc(episodeId);
const bucket = getStorage().bucket();
const workDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'shorts', episodeId);
const notesPage = `${SITE_URL}/admin/podcast/${episodeId}/notes`;

const finalAtOf = (episode: Episode) => (episode.final?.finishedAt as Timestamp | undefined)?.toMillis?.() ?? 0;

async function loadWords(episode: Episode) {
    if (!episode.final?.wordsPath) throw new Error('The final cut has no transcript; get the final cut again');
    const [raw] = await withRetry('Storage download', () => bucket.file(episode.final!.wordsPath!).download());
    return (JSON.parse(raw.toString('utf8')) as { words: TimedWord[] }).words;
}

// Changes one short without touching the others, which the producer may be editing.
async function updateItem(id: string, change: (item: ShortItem) => ShortItem) {
    await db.runTransaction(async tx => {
        const shorts = ((await tx.get(ref)).data() as Episode | undefined)?.shorts;
        if (!shorts) return;
        tx.update(ref, { 'shorts.items': shorts.items.map(i => (i.id === id ? change(i) : i)) });
    });
}

const SYSTEM = 'You pick moments from the Soul Wisdom Collective podcast for YouTube Shorts. The podcast explores near-death ' +
    'experiences, consciousness and the meaning of life with warmth and curiosity. A good Short grabs attention in its first ' +
    'two seconds, makes sense to someone who has never seen the episode, and ends on a complete thought or a line that lands. ' +
    'Never state as fact what a guest offered as belief or experience.';

async function suggest(episode: Episode, words: TimedWord[]) {
    const quotes = episode.final!.quotes ?? [];
    if (!quotes.length) throw new Error('The final cut has no key quotes to make shorts from');
    const notes = episode.notes!.approved!;
    // Each quote's words, numbered from 0, with a little either side.
    const windows = quotes.map(q => wordsBetween(words, q.startMs - QUOTE_CONTEXT_MS, q.endMs + QUOTE_CONTEXT_MS));
    const listing = quotes.map((q, i) => {
        const seconds = Math.round((q.endMs - q.startMs) / 1000);
        return `Quote ${i} (${q.speaker}, about ${seconds}s):\n${windows[i].map((w, j) => `[${j}]${w.text}`).join(' ')}`;
    }).join('\n\n');
    const client = new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.stream({
        model: NOTES_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: NOTES_EFFORT, format: betaZodOutputFormat(ShortSuggestionsSchema) },
        system: SYSTEM,
        messages: [{
            role: 'user',
            content: `Episode: ${notes.titles[notes.chosenTitle] ?? episode.title}\n\nSummary:\n${notes.summary}\n\n` +
                `These are the episode's key quotes as they are heard in the finished video, word by word. Each word has a number ` +
                `in brackets; a few words before and after each quote are included.\n\n${listing}\n\n` +
                `Pick the ${SHORTS_SUGGESTED} best moments for Shorts, best first, at most one per quote, with a mix of speakers ` +
                'and topics. For each, give the first and last word numbers: start on the line that hooks, cut any warm-up, and ' +
                'end where the thought is complete. Aim for 20 to 60 seconds; never under 10 or over 90.',
        }],
    }).finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to suggest shorts');
    if (!response.parsed_output) throw new Error('Claude returned suggestions in an unexpected shape');
    const { input_tokens, output_tokens } = response.usage;
    const usd = Math.round((input_tokens * SUGGEST_USD_PER_MTOK.input + output_tokens * SUGGEST_USD_PER_MTOK.output) / 1e4) / 100;

    const broll = Object.values(episode.broll?.images ?? {});
    const items: ShortItem[] = [];
    const warnings: string[] = [];
    for (const s of response.parsed_output.shorts) {
        const window = windows[s.quote];
        if (!window || s.firstWord < 0 || s.lastWord >= window.length || s.firstWord > s.lastWord) {
            warnings.push(`A suggestion pointed at words that are not there (quote ${s.quote}), so it was left out.`);
            continue;
        }
        if (items.some(i => i.quoteIndex === s.quote)) continue;
        const first = words.indexOf(window[s.firstWord]), last = words.indexOf(window[s.lastWord]);
        const { startMs, endMs } = wordBounds(words, first, last);
        if (endMs - startMs < SHORT_MIN_MS || endMs - startMs > SHORT_MAX_MS) {
            warnings.push(`A suggestion from quote ${s.quote} was ${Math.round((endMs - startMs) / 1000)}s long, so it was left out.`);
            continue;
        }
        const quote = quotes[s.quote];
        items.push({
            id: randomUUID().slice(0, 8),
            quoteIndex: s.quote,
            speaker: quote.speaker,
            startMs, endMs,
            headline: s.headline.replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX_CHARS),
            title: s.title.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, SHORT_TITLE_MAX),
            synthetic: showsBroll(broll, quote, startMs, endMs),
        });
        console.log(`  ✅ ${Math.round((endMs - startMs) / 1000)}s from quote ${s.quote} (${quote.speaker}): ${s.title}`);
    }
    if (!items.length) throw new Error('None of the suggestions could be used; try again');
    return { items, warnings, usd };
}

async function render(episode: Episode, words: TimedWord[]) {
    const shorts = episode.shorts!;
    const finalAt = finalAtOf(episode);
    const aspect: ShortAspect = shorts.aspect ?? DEFAULT_ASPECT;
    const todo = shorts.items.filter(i => !i.youtube && !sameRender(i.render, renderInputs(i, aspect, finalAt)));
    if (!todo.length) throw new Error('Every short is already drawn; change one first');
    const l = shortLayout(aspect);
    const background = path.join(workDir, 'background.png');
    await shortBackground(LOGO, background, {
        width: SHORT_WIDTH, height: SHORT_HEIGHT, logoSize: l.logo.size, logoTop: l.logo.top, videoTop: l.video.top, videoHeight: l.video.height,
    });
    // ffmpeg reads the final cut straight from Storage, only around each short.
    const [url] = await bucket.file(episode.final!.videoPath!).getSignedUrl({ action: 'read', expires: Date.now() + 3 * 60 * 60_000 });
    const warnings: string[] = [];
    let done = 0;
    for (const item of todo) {
        const inputs = renderInputs(item, aspect, finalAt);
        const durationMs = inputs.endMs - inputs.startMs;
        if (durationMs < SHORT_MIN_MS || durationMs > SHORT_MAX_MS) {
            warnings.push(`"${item.title}" is ${Math.round(durationMs / 1000)}s long; a Short must be 5 seconds to 3 minutes, so it was not drawn.`);
            continue;
        }
        const ass = path.join(workDir, `${item.id}.ass`);
        fs.writeFileSync(ass, shortAss({
            headline: inputs.headline, speaker: inputs.speaker, words: wordsBetween(words, inputs.startMs, inputs.endMs),
            startMs: inputs.startMs, durationMs, aspect,
        }));
        const local = path.join(workDir, `${item.id}.mp4`);
        await withRetry('Render', () => renderShort(url, local, {
            startSeconds: inputs.startMs / 1000, durationSeconds: durationMs / 1000, aspect: aspectRatio(aspect),
            background, ass, fontsDir: FONTS_DIR, width: SHORT_WIDTH, videoTop: l.video.top,
        }), 2);
        const renderedAt = Date.now();
        const dest = `episodes/${episodeId}/shorts/${item.id}-${renderedAt}.mp4`;
        await withRetry('Storage upload', () => bucket.upload(local, { destination: dest, metadata: { contentType: 'video/mp4' } }));
        const previous = item.render?.path;
        await updateItem(item.id, i => ({ ...i, render: { ...inputs, path: dest, renderedAt, durationMs }, approved: null }));
        if (previous) await bucket.file(previous).delete().catch(() => {});
        done++;
        console.log(`  ✅ ${item.title} (${Math.round(durationMs / 1000)}s)`);
    }
    if (!done) throw new Error(warnings[0] ?? 'No short could be drawn');
    return { done, warnings };
}

async function upload(episode: Episode, words: TimedWord[]) {
    const shorts = episode.shorts!;
    const notes = episode.notes!.approved!;
    const episodeUrl = episode.youtube?.url;
    if (!episodeUrl) throw new Error('Upload the episode to YouTube first; each short links to it');
    const youtube = createYoutube({
        clientId: required('YOUTUBE_CLIENT_ID'),
        clientSecret: required('YOUTUBE_CLIENT_SECRET'),
        refreshToken: required('YOUTUBE_REFRESH_TOKEN'),
    });
    const aspect = shorts.aspect ?? DEFAULT_ASPECT;
    const finalAt = finalAtOf(episode);
    const todo = shorts.items
        .filter(i => !i.youtube && i.publishAt && i.render && i.approved?.renderedAt === i.render.renderedAt &&
            sameRender(i.render, renderInputs(i, aspect, finalAt)))
        .sort((a, b) => a.publishAt! - b.publishAt!);
    if (!todo.length) throw new Error('No approved short is waiting to be scheduled');
    const warnings: string[] = [];
    const scheduled: { title: string; url: string; publishAt: number }[] = [];
    for (const item of todo) {
        if (item.publishAt! < Date.now() + MIN_LEAD_MS) {
            const message = 'Its time slot has passed; schedule it again.';
            await updateItem(item.id, i => ({ ...i, error: message }));
            warnings.push(`"${item.title}": ${message}`);
            continue;
        }
        const spoken = wordsBetween(words, item.startMs, item.endMs).map(w => w.text).join(' ');
        const meta = shortMetadata(item, spoken, { url: episodeUrl, hashtags: notes.hashtags, tags: notes.tags });
        const local = path.join(workDir, `${item.id}.mp4`);
        await withRetry('Storage download', () => bucket.file(item.render!.path).download({ destination: local }));
        const publishAt = new Date(item.publishAt!).toISOString();
        console.log(`🎬 Uploading "${meta.title}" for ${publishAt}`);
        try {
            const video = await youtube.upload(local, {
                snippet: {
                    title: meta.title, description: meta.description, tags: meta.tags, categoryId: YOUTUBE_CATEGORY,
                    defaultLanguage: 'en', defaultAudioLanguage: 'en',
                },
                status: {
                    privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false,
                    containsSyntheticMedia: meta.containsSyntheticMedia, embeddable: true, license: 'youtube',
                },
            });
            if (!video.id) throw new Error('YouTube did not return a video ID');
            const youtubeUrl = `https://youtube.com/shorts/${video.id}`;
            // Recorded straight away, so a failure later never leads to a second copy.
            await updateItem(item.id, i => ({
                ...i, error: null, youtube: { videoId: video.id!, url: youtubeUrl, publishAt: item.publishAt!, uploadedAt: Date.now() },
            }));
            scheduled.push({ title: meta.title, url: youtubeUrl, publishAt: item.publishAt! });
            console.log(`  ✅ ${youtubeUrl}`);
        } catch (error) {
            const message = (error as Error).message;
            console.warn(`  ⚠️ ${message}`);
            await updateItem(item.id, i => ({ ...i, error: message }));
            warnings.push(`"${item.title}": ${message}`);
            // Out of quota: the rest would fail the same way today.
            if (error instanceof YoutubeError && ['quotaExceeded', 'uploadLimitExceeded'].includes(error.reason)) {
                warnings.push('The rest wait until tomorrow; press "Schedule on YouTube" again then.');
                break;
            }
        } finally {
            fs.rmSync(local, { force: true });
        }
    }
    return { scheduled, warnings };
}

// In the producer's time zone, as the Studio sent it.
function when(ms: number, timeZone = 'UTC') {
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
    try {
        return new Date(ms).toLocaleString('en-GB', { ...options, timeZone });
    } catch {
        return new Date(ms).toLocaleString('en-GB', { ...options, timeZone: 'UTC' });
    }
}

async function main() {
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    if (episode.notes?.status !== 'approved' || !episode.notes.approved) throw new Error('Approve the show notes first');
    const final = episode.final;
    if (final?.status !== 'ready' || !final.videoPath) throw new Error('Get the final cut from Descript first');
    if (mode !== 'suggest' && !episode.shorts?.items.length) throw new Error('Suggest or add shorts first');
    fs.mkdirSync(workDir, { recursive: true });
    await ref.update({
        'shorts.status': 'working', 'shorts.startedAt': FieldValue.serverTimestamp(), 'shorts.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    });
    const words = await loadWords(episode);
    const done: Record<string, unknown> = {
        'shorts.status': 'ready', 'shorts.finishedAt': FieldValue.serverTimestamp(), 'shorts.error': null,
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (mode === 'suggest') {
        console.log(`✂️  Suggesting shorts for ${episode.title}`);
        const { items, warnings, usd } = await withRetry('Claude', () => suggest(episode, words), 3);
        // Shorts already on YouTube stay; everything else is replaced. The version bump stops an
        // open page from saving its older list over the new one.
        await db.runTransaction(async tx => {
            const shorts = ((await tx.get(ref)).data() as Episode).shorts as Partial<EpisodeShorts> | undefined;
            tx.update(ref, {
                ...done,
                'shorts.items': [...(shorts?.items ?? []).filter(i => i.youtube), ...items],
                'shorts.version': (shorts?.version ?? 0) + 1,
                'shorts.aspect': shorts?.aspect ?? DEFAULT_ASPECT,
                'shorts.finalAt': finalAtOf(episode),
                'shorts.warnings': warnings,
                'costs.items': FieldValue.arrayUnion({ item: 'shorts_suggest', usd, at: new Date() }),
                'costs.totalUsd': FieldValue.increment(usd),
            });
        });
        return;
    }

    if (mode === 'render') {
        console.log(`🎞️  Drawing shorts for ${episode.title}`);
        const { done: count, warnings } = await render(episode, words);
        await ref.update({ ...done, 'shorts.warnings': warnings });
        await sendEmail({ alert }, `Shorts ready to review: ${episode.title}`, [
            `${count} short${count === 1 ? ' is' : 's are'} drawn for "${episode.title}". Watch and approve them (Checkpoint E):`,
            notesPage,
            ...(warnings.length ? ['', 'Check:', ...warnings.map(w => `  - ${w}`)] : []),
        ].join('\n'));
        return;
    }

    const { scheduled, warnings } = await upload(episode, words);
    if (!scheduled.length) throw new Error(warnings.join(' ') || 'No short was scheduled');
    await ref.update({ ...done, 'shorts.warnings': warnings });
    await sendEmail({ alert }, `Shorts scheduled: ${episode.title}`, [
        `${scheduled.length} short${scheduled.length === 1 ? '' : 's'} from "${episode.title}" scheduled on YouTube (Private until each goes live):`,
        ...scheduled.map(s => `  ${when(s.publishAt, episode.shorts?.timeZone)}  ${s.title}\n    ${s.url}`),
        ...(warnings.length ? ['', 'Check:', ...warnings.map(w => `  - ${w}`)] : []),
    ].join('\n'));
}

main().catch(async error => {
    const message = (error as Error).message;
    console.error(`❌ ${message}`);
    await ref.update({
        'shorts.status': 'failed', 'shorts.error': message, 'shorts.finishedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    const what = { suggest: 'Suggesting shorts', render: 'Drawing the shorts', upload: 'Scheduling the shorts' }[mode] ?? 'The shorts job';
    await sendEmail({ alert }, `Shorts failed: ${episodeId}`,
        `${what} did not finish.\n\nError: ${message}\n\nTry again from the show notes page: ${notesPage}${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
