// Spec 005 step 14: Shorts from the key quotes, cut from the final cut (docs/specs/013-shorts.md).
// Three jobs, picked by SHORTS_MODE:
//   titles   Claude writes a headline and a YouTube title for each short the producer picked
//            from the key quotes and has not given both yet
//   render   draws each short that changed: 1080x1920, the episode's picture trimmed at the
//            sides above large word-by-word captions, in the brand look (shortsRender.ts)
//   upload   uploads the shorts approved at Checkpoint E to YouTube, Private and scheduled one a
//            day, each linking to the full episode
// The producer edits, watches and approves them on the show notes page in between. Runs in GitHub
// Actions (.github/workflows/podcast_shorts.yml). No Descript: nothing here uses its credits.

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
    SHORT_WIDTH, shortLayout, shortMetadata, ShortTextsSchema, wordsBetween,
    HEADLINE_MAX_CHARS, type ShortAspect,
} from '../../../lib/shorts';
import { SITE_URL } from '../../../lib/showNotes';
import { YOUTUBE_CATEGORY } from '../../../lib/youtube';
import type { Episode, ShortItem } from '../../../types/episode';
import { loadAlert } from './config';
import { withRetry } from './errors';
import { renderShort, shortBackground } from './media';
import { NOTES_EFFORT, NOTES_MODEL } from './notesDraft';
import { sendEmail } from './notify';
import { FONTS_DIR, LOGO, shortAss } from './shortsRender';
import { createYoutube, YoutubeError } from './youtubeApi';

// US dollars per million tokens, for the cost record.
const TEXTS_USD_PER_MTOK = { input: 4, output: 20 };
// YouTube needs a scheduled time comfortably in the future.
const MIN_LEAD_MS = 10 * 60_000;

type Mode = 'titles' | 'render' | 'upload';

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const mode = required('SHORTS_MODE') as Mode;
if (!['titles', 'render', 'upload'].includes(mode)) throw new Error(`Not a shorts job: ${mode}`);
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

// Headlines and titles for the shorts that lack one or the other; the producer picked the moments.
// Shorts are numbered for Claude (random ids are easy to copy wrong); any it leaves out are asked
// for once more.
async function writeTexts(episode: Episode, words: TimedWord[]) {
    const todo = (episode.shorts?.items ?? []).filter(i => !i.youtube && (!i.headline.trim() || !i.title.trim()));
    if (!todo.length) throw new Error('Every short already has a headline and a title; clear one to have it rewritten');
    const notes = episode.notes!.approved!;
    const client = new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') });
    const texts = new Map<string, { headline: string; title: string }>();
    let usd = 0;
    for (let round = 1; round <= 2; round++) {
        const batch = todo.filter(i => !texts.has(i.id));
        if (!batch.length) break;
        const listing = batch.map((i, n) => `Short ${n + 1} (${i.speaker}, ${Math.round((i.endMs - i.startMs) / 1000)}s):\n` +
            wordsBetween(words, i.startMs, i.endMs).map(w => w.text).join(' ')).join('\n\n');
        const response = await client.beta.messages.stream({
            model: NOTES_MODEL,
            max_tokens: 32000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: NOTES_EFFORT, format: betaZodOutputFormat(ShortTextsSchema) },
            system: SYSTEM,
            messages: [{
                role: 'user',
                content: `Episode: ${notes.titles[notes.chosenTitle] ?? episode.title}\n\nSummary:\n${notes.summary}\n\n` +
                    `These ${batch.length} Shorts were cut from the episode; each is shown with the words heard in it.\n\n${listing}\n\n` +
                    `Write a headline and a YouTube title for every one of the ${batch.length}, numbered as above. Each should make ` +
                    'someone stop scrolling and fit what is actually said in that Short.',
            }],
        }).finalMessage();
        if (response.stop_reason === 'refusal') throw new Error('Claude declined to write the headlines and titles');
        if (!response.parsed_output) throw new Error('Claude returned headlines and titles in an unexpected shape');
        const { input_tokens, output_tokens } = response.usage;
        usd += (input_tokens * TEXTS_USD_PER_MTOK.input + output_tokens * TEXTS_USD_PER_MTOK.output) / 1e6;
        for (const t of response.parsed_output.shorts) {
            const item = batch[t.short - 1];
            const headline = t.headline.replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX_CHARS);
            const title = t.title.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, SHORT_TITLE_MAX);
            if (!item || !headline || !title) continue;
            texts.set(item.id, { headline, title });
            console.log(`  ✅ ${headline} | ${title}`);
        }
        console.log(`  Round ${round}: ${texts.size} of ${todo.length} done`);
    }
    const missing = todo.length - texts.size;
    return {
        texts, usd: Math.round(usd * 100) / 100,
        warnings: missing ? [`Claude left out ${missing} short${missing === 1 ? '' : 's'}; press the button again for ${missing === 1 ? 'it' : 'them'}.`] : [],
    };
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
    // The episode once it is on YouTube; before that, the podcast playlist, then the site.
    const playlistId = process.env.YOUTUBE_PLAYLIST_ID?.trim();
    const link = episode.youtube?.url ? { url: episode.youtube.url, linkText: 'Watch the full conversation' }
        : playlistId ? { url: `https://www.youtube.com/playlist?list=${playlistId}`, linkText: 'Full episodes' }
            : { url: SITE_URL, linkText: 'Full episodes' };
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
        const meta = shortMetadata(item, spoken, { ...link, hashtags: notes.hashtags, tags: notes.tags });
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
    if (!episode.shorts?.items.length) throw new Error('Pick some key quotes for shorts first');
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

    if (mode === 'titles') {
        console.log(`✍️  Headlines and titles for the shorts of ${episode.title}`);
        const { texts, usd, warnings } = await withRetry('Claude', () => writeTexts(episode, words), 3);
        // Fills only what is still empty, on the shorts as they are now. The version bump stops an
        // open page from saving its older copy over the new texts.
        await db.runTransaction(async tx => {
            const shorts = ((await tx.get(ref)).data() as Episode).shorts!;
            tx.update(ref, {
                ...done,
                'shorts.items': shorts.items.map(i => {
                    const t = texts.get(i.id);
                    if (!t || i.youtube) return i;
                    return { ...i, headline: i.headline.trim() ? i.headline : t.headline, title: i.title.trim() ? i.title : t.title };
                }),
                'shorts.version': (shorts.version ?? 0) + 1,
                'shorts.warnings': warnings,
                'costs.items': FieldValue.arrayUnion({ item: 'shorts_titles', usd, at: new Date() }),
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
    const what = { titles: 'Writing the headlines and titles', render: 'Drawing the shorts', upload: 'Scheduling the shorts' }[mode] ?? 'The shorts job';
    await sendEmail({ alert }, `Shorts failed: ${episodeId}`,
        `${what} did not finish.\n\nError: ${message}\n\nTry again from the show notes page: ${notesPage}${runUrl ? `\n\nRun log: ${runUrl}` : ''}`);
    process.exit(1);
});
