// Part B: smarter Shorts picking — Claude reads the final cut and suggests the moments
// that would make the strongest YouTube Shorts, best first, each with a score, a hook and
// a reason. The producer can give direction, preview each pick, add it as a short, or
// swap it in for a short already chosen. Ticking key quotes keeps working as before.

import { z } from 'zod';
import type { TimedWord } from './retime';
import { mmss } from './showNotes';
import { SHORT_MAX_MS, SHORT_MIN_MS, wordBounds, type ShortEdit } from './shorts';

// Suggestions kept and asked for, and the max length of the producer's direction.
export const PICK_COUNT = 10;       // how many suggestions we keep
export const PICK_ASK = 15;          // how many we ask Claude for (it may return fewer)
export const DIRECTION_MAX = 1000;   // the producer's direction, in characters

// What Claude returns for the picks. No .min()/.max(): Claude's output format does not take them.
export const ShortPicksSchema = z.object({
    picks: z.array(z.object({
        startMs: z.number().int().describe('The time in milliseconds of the transcript line where the moment starts'),
        endMs: z.number().int().describe('The time in milliseconds just after the moment\'s last word'),
        speaker: z.string().describe('Who is speaking, by name if the transcript or key quotes show it'),
        score: z.number().int().describe('1 to 10: how well it would hold a stranger scrolling past'),
        hook: z.string().describe('The opening words of the moment, exactly as spoken'),
        reason: z.string().describe('One plain sentence on why this moment works as a Short'),
    })),
});

// One stored suggestion, after snapping and ranking.
export const ShortSuggestionSchema = z.object({
    id: z.string().regex(/^[\w-]{4,40}$/),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    speaker: z.string().max(100),
    score: z.number().int().min(1).max(10),
    hook: z.string().max(200),
    reason: z.string().max(300),
});
export type ShortSuggestion = z.infer<typeof ShortSuggestionSchema>;

// The final cut as lines "[<startMs>ms <mmss>] word word ...", for Claude to read.
export function pickingTranscript(words: TimedWord[]): string {
    const lines: TimedWord[][] = [];
    let line: TimedWord[] = [];
    let prevEnd: number | null = null;
    // A new line starts before a word when the previous word ends a sentence, or the gap
    // from the previous word's end is over 1500 ms, or the line already has 40 words.
    for (const w of words) {
        if (!w.text.trim()) continue;
        const startsNew = !line.length
            ? false
            : prevEnd !== null && (
                /[.?!]["”’)]*$/.test(line[line.length - 1].text) ||
                w.start - prevEnd > 1500 ||
                line.length >= 40
            );
        if (line.length && startsNew) {
            lines.push(line);
            line = [];
        }
        line.push(w);
        prevEnd = w.end;
    }
    if (line.length) lines.push(line);
    if (!lines.length) return '';
    return lines.map(l => `[${Math.round(l[0].start)}ms ${mmss(Math.round(l[0].start))}] ${l.map(w => w.text).join(' ')}`).join('\n');
}

// Snaps a pick to clean word ends, running on to finish the sentence. Returns null if the
// result is too short, too long, or past the end of the words.
export function snapPick(words: TimedWord[], startMs: number, endMs: number): { startMs: number; endMs: number } | null {
    // First word with start >= startMs - 50; none means the pick is past the end.
    let first = -1;
    for (let i = 0; i < words.length; i++) {
        if (words[i].start >= startMs - 50) { first = i; break; }
    }
    if (first < 0) return null;
    // Last word with start < endMs; none or before first means the pick is empty or past.
    let last = -1;
    for (let i = words.length - 1; i >= first; i--) {
        if (words[i].start < endMs) { last = i; break; }
    }
    if (last < first) return null;
    // Run on to the first word that ends a sentence, looking at words last..last+8.
    for (let i = last; i <= Math.min(last + 8, words.length - 1); i++) {
        if (/[.?!]["”’)]*$/.test(words[i].text)) { last = i; break; }
    }
    const bounds = wordBounds(words, first, last);
    const len = bounds.endMs - bounds.startMs;
    if (len < SHORT_MIN_MS || len > SHORT_MAX_MS) return null;
    return bounds;
}

// Whether two stretches overlap by more than half of the shorter one's length.
export function overlapping(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean {
    const overlap = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
    if (overlap <= 0) return false;
    const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
    return overlap > shorter / 2;
}

// Ranks picks: score rounded and kept to 1..10, whitespace collapsed and trimmed, sorted
// by score high to low then startMs low to high, keeping each that overlaps none already kept.
export function rankPicks(picks: { startMs: number; endMs: number; score: number; speaker: string; hook: string; reason: string }[], max = PICK_COUNT) {
    const clean = picks.map(p => ({
        startMs: p.startMs,
        endMs: p.endMs,
        score: Math.min(10, Math.max(1, Math.round(p.score))),
        speaker: p.speaker.trim().slice(0, 100),
        hook: p.hook.replace(/\s+/g, ' ').trim().slice(0, 200),
        reason: p.reason.replace(/\s+/g, ' ').trim().slice(0, 300),
    }));
    clean.sort((a, b) => b.score - a.score || a.startMs - b.startMs);
    const kept: typeof clean = [];
    for (const p of clean) {
        if (kept.length >= max) break;
        if (kept.some(k => overlapping(k, p))) continue;
        kept.push(p);
    }
    return kept;
}

// The speaker of the key quote sharing the most time with the stretch, else the
// fallback (trimmed), else 'Speaker'. Capped at 100 characters.
export function speakerFor(quotes: { speaker: string; startMs: number; endMs: number }[], startMs: number, endMs: number, fallback: string): string {
    let best: { speaker: string; shared: number } | null = null;
    for (const q of quotes) {
        const shared = Math.min(q.endMs, endMs) - Math.max(q.startMs, startMs);
        if (shared > 0 && (!best || shared > best.shared)) best = { speaker: q.speaker, shared };
    }
    if (best) return best.speaker.slice(0, 100);
    const trimmed = fallback.trim();
    return (trimmed || 'Speaker').slice(0, 100);
}

// Whether a suggestion is already covered by one of the existing shorts.
export function isTaken(s: { startMs: number; endMs: number }, items: { startMs: number; endMs: number }[]): boolean {
    return items.some(i => overlapping(i, s));
}

// Turns a suggestion into a short edit, with no quote index and empty texts.
export function suggestionToShort(s: ShortSuggestion, id: string): ShortEdit {
    return { id, quoteIndex: null, speaker: s.speaker, startMs: s.startMs, endMs: s.endMs, headline: '', title: '', synthetic: false };
}

// Swaps a suggestion in for a short already chosen: same id, synthetic and place kept;
// quoteIndex nulled; speaker, startMs, endMs taken from the pick; headline and title cleared.
export function swapIn(items: ShortEdit[], targetId: string, s: ShortSuggestion): ShortEdit[] {
    return items.map(i => i.id === targetId
        ? { ...i, quoteIndex: null, speaker: s.speaker, startMs: s.startMs, endMs: s.endMs, headline: '', title: '' }
        : i);
}

// The instructions sent to Claude, with the count filled in. Direction appended when not empty.
export function pickInstructions(count: number, direction: string): string {
    let text = `Pick up to ${count} moments that would make the strongest YouTube Shorts, each 20 to 90 seconds and never over three minutes. For each give startMs, the time of the transcript line where it starts; endMs, the time just after its last word; the speaker; a score from 1 to 10 for how well it would hold a stranger scrolling past; the hook, its opening words exactly as spoken; and the reason, one plain sentence on why it works. Prefer moments that open on a strong line and end on a complete thought. No two moments may overlap.`;
    const d = direction.trim();
    if (d) text += `\n\nDirection from the producer: ${d}`;
    return text;
}
