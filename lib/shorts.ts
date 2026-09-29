// Shorts from the key quotes (spec 005 step 14, Checkpoint E; docs/specs/013-shorts.md). Shared by
// the shorts job, the server and the Studio: the vertical layout, the limits, what makes a render
// current, the caption timing and what is sent to YouTube. The producer picks which key quotes
// become shorts; Claude only writes their headlines and titles.

import { z } from 'zod';
import type { TimedWord } from './retime';

export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;

// Stacked layout: the episode's 16:9 picture, trimmed at the sides, above large captions.
// Zoom recordings always leave room at the sides (decided 29 Sept 2026).
export const SHORT_ASPECTS = ['14:9', '13:9'] as const;
export type ShortAspect = (typeof SHORT_ASPECTS)[number];
export const DEFAULT_ASPECT: ShortAspect = '14:9';
export const aspectRatio = (a: ShortAspect) => (a === '13:9' ? 13 / 9 : 14 / 9);
// Share of the 16:9 frame's width left out on each side.
export const sideCrop = (a: ShortAspect) => (1 - aspectRatio(a) / (16 / 9)) / 2;

// Where everything sits on the 1080x1920 frame. YouTube's buttons and the title cover the
// bottom quarter and a strip on the right, so everything that matters is above y = 1500.
export function shortLayout(a: ShortAspect) {
    const videoTop = 490;
    const videoHeight = Math.round(SHORT_WIDTH / aspectRatio(a) / 2) * 2;
    const videoBottom = videoTop + videoHeight;
    return {
        logo: { size: 180, top: 60 },
        headline: { centerY: 350, marginX: 90 },
        video: { top: videoTop, height: videoHeight },
        speakerTop: videoBottom + 26,
        captionsTop: videoBottom + 86,
        captionsMarginX: 90,
    };
}

export const SHORT_MIN_MS = 5_000;
export const SHORT_TARGET_MS = 60_000;          // shorter holds viewers better
export const SHORT_MAX_MS = 180_000;            // YouTube counts up to three minutes as a Short
export const HEADLINE_MAX_CHARS = 60;           // with asterisks
export const SHORT_TITLE_MAX = 100;
// How far around a short the Studio shows words, so its ends can be moved.
export const TRIM_WINDOW_MS = 15_000;
export const DAY_MS = 24 * 60 * 60_000;

// What Claude returns for the headline and title of each short picked from the key quotes.
export const ShortTextsSchema = z.object({
    shorts: z.array(z.object({
        short: z.number().int().describe('The number of the short, as given'),
        headline: z.string().describe(
            'Two to six words shown large above the video, read in a second. Mark one or two key words for gold ' +
            'by wrapping them in asterisks, e.g. "Heaven *Felt* Like *Home*". No quotation marks, no emoji.'),
        title: z.string().describe('YouTube title for the Short, under 70 characters, curiosity-led and specific, no hashtags, no clickbait.'),
    })),
});

// Share of a key quote's words heard at its place in the final cut. Low means the edit cut or
// changed it, so its times are not to be trusted.
export function quoteMatch(quoteText: string, heard: TimedWord[]) {
    const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9'\s]+/g, ' ').split(/\s+/).filter(Boolean);
    const want = tokens(quoteText);
    if (!want.length) return 1;
    const have = new Map<string, number>();
    for (const t of heard.flatMap(w => tokens(w.text))) have.set(t, (have.get(t) ?? 0) + 1);
    let found = 0;
    for (const t of want) {
        const n = have.get(t) ?? 0;
        if (n > 0) {
            found++;
            have.set(t, n - 1);
        }
    }
    return found / want.length;
}
export const QUOTE_MATCH_LOW = 0.7;

// One short as the producer edits it.
export const ShortEditSchema = z.object({
    id: z.string().regex(/^[\w-]{4,40}$/),
    quoteIndex: z.number().int().min(0).nullable(),
    speaker: z.string().max(100),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    headline: z.string().max(HEADLINE_MAX_CHARS),
    title: z.string().max(SHORT_TITLE_MAX),
    synthetic: z.boolean(),
});
export type ShortEdit = z.infer<typeof ShortEditSchema>;

// What a render was made from. A render is current while all of this still matches.
// Bumped when the drawing itself changes, so every short drawn before is drawn again.
// 2: the video no longer missing from the first frame (29 Sept 2026).
export const RENDER_VERSION = 2;

export interface ShortRenderInputs {
    version?: number;                   // RENDER_VERSION it was drawn with; none means 1
    startMs: number;
    endMs: number;
    headline: string;
    speaker: string;
    aspect: ShortAspect;
    finalAt: number;
}

export function renderInputs(item: ShortEdit, aspect: ShortAspect, finalAt: number): ShortRenderInputs {
    return { version: RENDER_VERSION, startMs: item.startMs, endMs: item.endMs, headline: item.headline.trim(), speaker: item.speaker, aspect, finalAt };
}

export function sameRender(a: ShortRenderInputs | null | undefined, b: ShortRenderInputs) {
    return !!a && (a.version ?? 1) === (b.version ?? 1) && a.startMs === b.startMs && a.endMs === b.endMs && a.headline === b.headline &&
        a.speaker === b.speaker && a.aspect === b.aspect && a.finalAt === b.finalAt;
}

// Clean ends: a little air before the first word and after the last, never into the next one.
export function wordBounds(words: TimedWord[], first: number, last: number) {
    const prevEnd = first > 0 ? words[first - 1].end : 0;
    const nextStart = last + 1 < words.length ? words[last + 1].start : Infinity;
    return {
        startMs: Math.round(Math.max(prevEnd, words[first].start - 120, 0)),
        endMs: Math.round(Math.min(nextStart, words[last].end + 300)),
    };
}

// The words heard in a short, by the time they start.
export const wordsBetween = (words: TimedWord[], startMs: number, endMs: number) =>
    words.filter(w => w.start >= startMs - 50 && w.start < endMs);

// Burned-in captions: a few words at a time, large, the word being spoken in gold.
const CAPTION_CHARS = 30;
const CAPTION_MAX_MS = 2600;
const CAPTION_PAUSE_MS = 500;

export interface CaptionChunk { startMs: number; endMs: number; words: TimedWord[] }

export function captionChunks(words: TimedWord[]): CaptionChunk[] {
    const chunks: CaptionChunk[] = [];
    let current: TimedWord[] = [];
    const flush = () => {
        if (current.length) chunks.push({ startMs: current[0].start, endMs: current[current.length - 1].end, words: current });
        current = [];
    };
    for (const w of words) {
        const text = w.text.trim();
        if (!text) continue;
        if (current.length) {
            const last = current[current.length - 1];
            const length = current.map(x => x.text).join(' ').length + 1 + text.length;
            if (length > CAPTION_CHARS || w.end - current[0].start > CAPTION_MAX_MS || w.start - last.end > CAPTION_PAUSE_MS ||
                /[.?!]["”’)]*$/.test(last.text)) flush();
        }
        current.push({ ...w, text });
    }
    flush();
    // Each stays up until the next, across short pauses.
    for (let i = 0; i < chunks.length; i++) {
        const next = chunks[i + 1]?.startMs ?? Infinity;
        chunks[i].endMs = Math.min(chunks[i].endMs + 400, next);
    }
    return chunks;
}

const TITLE_CLEAN = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

// What goes to YouTube for one short: the spoken words, a link to the full episode, hashtags.
export function shortMetadata(item: { title: string; speaker: string; synthetic: boolean }, spoken: string,
    episode: { url: string; linkText: string; hashtags: string[]; tags: string[] }) {
    const quote = spoken.length > 600 ? `${spoken.slice(0, 600).replace(/\s+\S*$/, '')}…` : spoken;
    const hashtags = [...episode.hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).slice(0, 2), '#shorts'];
    return {
        title: TITLE_CLEAN(item.title).slice(0, SHORT_TITLE_MAX),
        description: TITLE_CLEAN(`“${quote}” — ${item.speaker}`) + `\n\n${episode.linkText}: ${episode.url}\n\n${hashtags.join(' ')}`,
        tags: episode.tags.slice(0, 15),
        containsSyntheticMedia: item.synthetic,
    };
}

// One a day: the n-th approved short goes out n days after the first.
export const publishSlot = (firstAt: number, n: number) => firstAt + n * DAY_MS;

// Whether an AI b-roll still falls inside a short, for YouTube's altered-or-synthetic flag. B-roll
// times are in the original recording; inside one quote the two recordings run at the same pace.
export function showsBroll(broll: { startMs: number; durationSeconds: number }[],
    quote: { startMs: number; originalMs: number } | undefined, startMs: number, endMs: number) {
    if (!broll.length) return false;
    if (!quote) return true;                    // no way to tell, so say yes
    const from = quote.originalMs + (startMs - quote.startMs), to = quote.originalMs + (endMs - quote.startMs);
    return broll.some(b => b.startMs < to && b.startMs + b.durationSeconds * 1000 > from);
}
