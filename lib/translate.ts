// Part I: captions in other languages. Claude translates the final cut's English captions cue by
// cue, so every translated caption keeps its exact timing, and translates the YouTube title and
// description too. The notes job runs it (agent/src/podcast/translate.ts); the YouTube job adds each
// language as its own caption track and the title and description as YouTube translations.

import { z } from 'zod';
import type { Cue } from './captions';

// Languages offered, with YouTube's language codes.
export const LANGUAGES = [
    { code: 'es', name: 'Spanish' }, { code: 'pt', name: 'Portuguese' }, { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' }, { code: 'it', name: 'Italian' }, { code: 'nl', name: 'Dutch' },
    { code: 'pl', name: 'Polish' }, { code: 'ru', name: 'Russian' }, { code: 'uk', name: 'Ukrainian' },
    { code: 'tr', name: 'Turkish' }, { code: 'ar', name: 'Arabic' }, { code: 'he', name: 'Hebrew' },
    { code: 'hi', name: 'Hindi' }, { code: 'id', name: 'Indonesian' }, { code: 'fil', name: 'Filipino' },
    { code: 'vi', name: 'Vietnamese' }, { code: 'zh-Hans', name: 'Chinese (Simplified)' }, { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' }, { code: 'sw', name: 'Swahili' },
] as const;
export type LanguageCode = typeof LANGUAGES[number]['code'];
export const LANGUAGE_CODES = LANGUAGES.map(l => l.code) as [LanguageCode, ...LanguageCode[]];
export const LANGUAGES_MAX = 10;

// A language's English name, or the code itself when it is not in the list.
export function languageName(code: string): string {
    return LANGUAGES.find(l => l.code === code)?.name ?? code;
}

// The languages asked for: known codes only, each once, in the list's order, at most LANGUAGES_MAX.
export function cleanLanguages(codes: unknown): LanguageCode[] {
    const asked = new Set(Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : []);
    return LANGUAGE_CODES.filter(c => asked.has(c)).slice(0, LANGUAGES_MAX);
}

// Cues sent to Claude per request; small enough to answer quickly, large enough to keep the context.
export const TRANSLATE_BATCH = 150;

export const TranslatedCuesSchema = z.object({ cues: z.array(z.object({ i: z.number().int(), text: z.string() })) });
export type TranslatedCues = z.infer<typeof TranslatedCuesSchema>;

export const TranslatedMetaSchema = z.object({ title: z.string(), description: z.string() });

// The cues as numbered texts (one line per cue), in batches of TRANSLATE_BATCH.
export function cueBatches(cues: Cue[], size = TRANSLATE_BATCH): { i: number; text: string }[][] {
    const items = cues.map((c, i) => ({ i, text: c.lines.join(' ') }));
    const out: { i: number; text: string }[][] = [];
    for (let k = 0; k < items.length; k += size) out.push(items.slice(k, k + size));
    return out;
}

// Instructions for the caption translation.
export function captionsSystemPrompt(language: string, showName: string): string {
    return `You translate the English captions of a video from ${showName} into ${language}. ` +
        'Each caption is one numbered item and is shown on screen while those words are spoken, so translate each item on its own, ' +
        'keeping its meaning inside that item; never move words between items, merge or split them. Return every item with its number. ' +
        'Keep names of people and places as they are. Write natural, spoken ' + language + ' that reads quickly, about as long as the English.';
}

// The batch as the request's message.
export function captionsUserMessage(batch: { i: number; text: string }[]): string {
    return `<captions>\n${batch.map(c => `${c.i}\t${c.text}`).join('\n')}\n</captions>\n\nTranslate every caption.`;
}

// Instructions for the YouTube title and description.
export function metaSystemPrompt(language: string): string {
    return `You translate a YouTube video's title and description into ${language}, for viewers who search in ${language}. ` +
        'Keep every line\'s place. Leave timestamps (such as 0:00 or 1:02:03), web addresses, hashtags and names of people exactly as they are; ' +
        'translate the chapter titles after the timestamps. The title stays under 100 characters.';
}

export function metaUserMessage(title: string, description: string): string {
    return `<title>\n${title}\n</title>\n\n<description>\n${description}\n</description>`;
}

// Breaks a translated caption into at most two lines of about `max` characters (by words, or by
// characters for languages written without spaces).
export function wrapLines(text: string, max = 42): string[] {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return [t];
    const words = t.split(' ');
    if (words.length === 1) {
        const half = Math.ceil(t.length / 2);
        return [t.slice(0, half), t.slice(half)];
    }
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
        if (diff < bestDiff) { best = i; bestDiff = diff; }
    }
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

// The translated cues on the original timing. A cue Claude left out keeps its English text and is counted.
export function applyTranslations(cues: Cue[], translated: { i: number; text: string }[]): { cues: Cue[]; missing: number } {
    const byIndex = new Map<number, string>();
    for (const t of translated) if (t.text.trim()) byIndex.set(t.i, t.text);
    let missing = 0;
    const out = cues.map((c, i) => {
        const text = byIndex.get(i);
        if (text === undefined) { missing++; return { ...c }; }
        return { ...c, lines: wrapLines(text) };
    });
    return { cues: out, missing };
}

// Cuts text to `max` bytes of UTF-8 without breaking a character (YouTube counts description bytes).
export function fitUtf8(text: string, max: number): string {
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    if (bytes(text) <= max) return text;
    let out = '', used = 0;
    for (const ch of text) {
        const n = bytes(ch);
        if (used + n > max) break;
        out += ch;
        used += n;
    }
    return out;
}

// The translated title and description, kept within YouTube's limits and without the angle brackets it refuses.
export function cleanMeta(meta: { title: string; description: string }): { title: string; description: string } {
    const strip = (s: string) => s.replace(/[<>]/g, '');
    return { title: [...strip(meta.title).trim()].slice(0, 100).join(''), description: fitUtf8(strip(meta.description).trim(), 5000) };
}
