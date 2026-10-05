// Why: the two Part I jobs Claude does for the editor and YouTube, run by the notes job when the
// producer asks for them: translating the final cut's captions (and the YouTube title and description)
// into other languages, and finding retakes in the accepted transcript. GitHub Actions only.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { buildCues, toSrt } from '../../../lib/captions';
import type { TimedWord } from '../../../lib/retime';
import { RetakesSchema, retakesSystemPrompt, retakesUserMessage, timeRetakes, type RetakeLine, type Retake } from '../../../lib/retakes';
import type { StudioSettings } from '../../../lib/studioSettings';
import {
    applyTranslations, captionsSystemPrompt, captionsUserMessage, cleanMeta, cueBatches, languageName, metaSystemPrompt, metaUserMessage,
    TranslatedCuesSchema, TranslatedMetaSchema,
} from '../../../lib/translate';
import { youtubeMetadata } from '../../../lib/youtube';
import type { Episode, EpisodeTranslations } from '../../../types/episode';
import { NOTES_MODEL, type Effort } from './notesDraft';

// US dollars per million tokens, for the episode's cost record.
const USD_PER_MTOK = { input: 4, output: 20 };
// Requests sent at once while translating, so a long episode finishes well inside the job's time.
const PARALLEL = 4;

// One structured request to Claude; returns the parsed answer and what it cost.
async function ask<S extends z.ZodType>(client: Anthropic, schema: S, system: string, content: string, effort: Effort, maxTokens: number) {
    const response = await client.beta.messages.stream({
        model: NOTES_MODEL,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content }],
    }).finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('Claude declined the request');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude\'s answer was cut off (max_tokens); try again');
    if (!response.parsed_output) throw new Error('Claude answered in an unexpected shape');
    const { input_tokens, output_tokens } = response.usage;
    const usd = (input_tokens * USD_PER_MTOK.input + output_tokens * USD_PER_MTOK.output) / 1e6;
    return { parsed: response.parsed_output as z.infer<S>, usd };
}

// Runs `work` on every item, at most PARALLEL at a time, keeping the order.
async function inParallel<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const lane = async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]); } };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane));
    return out;
}

export interface TranslateDeps {
    download: (storagePath: string) => Promise<Buffer>;
    upload: (storagePath: string, text: string, contentType: string) => Promise<void>;
}

// Translates the final cut's captions into each language asked for and saves one SRT per language;
// the YouTube title and description are translated too when the notes are approved.
export async function translateCaptions(client: Anthropic, episodeId: string, episode: Episode, settings: StudioSettings, deps: TranslateDeps):
    Promise<{ tracks: NonNullable<EpisodeTranslations['tracks']>; finalAt: number; usd: number }> {
    const final = episode.final;
    if (final?.status !== 'ready' || !final.wordsPath) throw new Error('Make the final cut first; the captions come from its transcript');
    const languages = episode.translations?.languages ?? [];
    if (!languages.length) throw new Error('Choose at least one language');
    const words = (JSON.parse((await deps.download(final.wordsPath)).toString('utf8')) as { words: TimedWord[] }).words;
    const cues = buildCues(words);
    if (!cues.length) throw new Error('The final cut has no captions to translate');
    const meta = youtubeMetadata(episode, settings);
    const tracks: NonNullable<EpisodeTranslations['tracks']> = {};
    let usd = 0;
    for (const code of languages) {
        const language = languageName(code);
        console.log(`🌍 ${language}: ${cues.length} captions`);
        const answers = await inParallel(cueBatches(cues), batch =>
            ask(client, TranslatedCuesSchema, captionsSystemPrompt(language, settings.showName), captionsUserMessage(batch), 'low', 32000));
        usd += answers.reduce((sum, a) => sum + a.usd, 0);
        const { cues: translated, missing } = applyTranslations(cues, answers.flatMap(a => a.parsed.cues));
        const path = `episodes/${episodeId}/captions/${code}.srt`;
        await deps.upload(path, toSrt(translated), 'application/x-subrip');
        let title = '', description = '';
        if (meta) {
            const m = await ask(client, TranslatedMetaSchema, metaSystemPrompt(language), metaUserMessage(meta.title, meta.description), 'low', 16000);
            usd += m.usd;
            ({ title, description } = cleanMeta(m.parsed));
        }
        tracks[code] = { path, title, description, missing };
    }
    const finalAt = (final.finishedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return { tracks, finalAt, usd: Math.round(usd * 100) / 100 };
}

// Finds the retakes in the accepted transcript, timed from its words.
export async function findRetakes(client: Anthropic, episode: Episode, download: TranslateDeps['download']):
    Promise<{ found: Retake[]; notFound: number; usd: number }> {
    const reviewedPath = episode.review?.reviewedPath;
    if (!reviewedPath) throw new Error('Accept the transcript first');
    const lines = (JSON.parse((await download(reviewedPath)).toString('utf8')) as { lines: RetakeLine[] }).lines;
    const { parsed, usd } = await ask(client, RetakesSchema, retakesSystemPrompt(), retakesUserMessage(lines), 'medium', 32000);
    const { retakes, notFound } = timeRetakes(lines, parsed);
    return { found: retakes, notFound, usd: Math.round(usd * 100) / 100 };
}
