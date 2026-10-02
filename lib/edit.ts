// Editor Light (spec 015): the edit model shared by the transcript editor and the render job.
// Cuts, kept ranges, time mapping, and suggestions for filler words, repeats, and pauses.

import type { SpokenWord } from './showNotes';

export interface Cut {
    startMs: number;
    endMs: number;
    reason: 'filler' | 'pause' | 'repeat' | 'manual';
}

export interface EpisodeEdit {
    cuts: Cut[];
    version: number;
}

export interface KeptRange {
    startMs: number;
    endMs: number;
}

// A kept piece shorter than this is dropped — it would be a flash of audio between cuts.
const MIN_KEEP_MS = 150;

// Sort cuts by start; merge overlapping or touching (within padMs) into single spans.
function mergeCuts(cuts: Cut[], padMs: number): Cut[] {
    if (!cuts.length) return [];
    const sorted = [...cuts].sort((a, b) => a.startMs - b.startMs);
    const merged: Cut[] = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        // If the next cut starts before the previous ends (plus pad), merge them.
        if (sorted[i].startMs <= prev.endMs + padMs) {
            prev.endMs = Math.max(prev.endMs, sorted[i].endMs);
        } else {
            merged.push({ ...sorted[i] });
        }
    }
    return merged;
}

// Returns the ranges to keep after applying cuts to a duration. Each cut is padded by
// padMs on both sides so words at the edge are not clipped. Kept pieces shorter than
// MIN_KEEP_MS are dropped. Cuts are merged before subtracting.
export function keepRanges(durationMs: number, cuts: Cut[], padMs = 40): KeptRange[] {
    if (durationMs <= 0) return [];
    const merged = mergeCuts(cuts, padMs);
    const ranges: KeptRange[] = [];
    let cursor = 0;
    for (const cut of merged) {
        const start = Math.max(0, cut.startMs - padMs);
        const end = Math.min(durationMs, cut.endMs + padMs);
        if (start > cursor) {
            if (start - cursor >= MIN_KEEP_MS) {
                ranges.push({ startMs: cursor, endMs: start });
            }
        }
        cursor = Math.max(cursor, end);
    }
    if (cursor < durationMs) {
        if (durationMs - cursor >= MIN_KEEP_MS) {
            ranges.push({ startMs: cursor, endMs: durationMs });
        }
    }
    return ranges;
}

// Where a moment of the original lands in the edited episode, or null if it was cut.
// If `roundToNextKept` is true and the moment is in a cut, returns the start of the
// next kept range instead of null.
export function editedTime(originalMs: number, ranges: KeptRange[], roundToNextKept = false): number | null {
    let offset = 0;
    for (const r of ranges) {
        if (originalMs < r.startMs) {
            // It's in the gap before this range — it was cut.
            return roundToNextKept ? offset : null;
        }
        if (originalMs <= r.endMs) {
            // It's inside this kept range.
            return offset + (originalMs - r.startMs);
        }
        offset += r.endMs - r.startMs;
    }
    // Past the last kept range — either cut or past the end.
    return roundToNextKept ? offset : null;
}

// Total duration of the edited episode from the kept ranges.
export function editedDuration(ranges: KeptRange[]): number {
    return ranges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
}

const FILLER_WORDS = new Set(['um', 'uh', 'erm', 'uhm', 'hmm']);
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, '');

export interface SuggestOptions {
    maxPauseMs?: number;
    keepPauseMs?: number;
}

// Suggests cuts for filler words, repeated words, and long pauses.
export function suggestCuts(words: SpokenWord[], options?: SuggestOptions): Cut[] {
    const maxPauseMs = options?.maxPauseMs ?? 1200;
    const keepPauseMs = options?.keepPauseMs ?? 500;
    const cuts: Cut[] = [];

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const norm = normalize(w.text);

        // Filler words
        if (FILLER_WORDS.has(norm)) {
            cuts.push({ startMs: w.start, endMs: w.end, reason: 'filler' });
            continue;
        }

        // Immediate repeats: same word twice in a row, keep the last one
        if (i > 0 && normalize(words[i - 1].text) === norm && norm.length > 0) {
            cuts.push({ startMs: words[i - 1].start, endMs: words[i - 1].end, reason: 'repeat' });
        }
    }

    // Pauses: a gap between consecutive words longer than maxPauseMs, shortened to keepPauseMs.
    for (let i = 1; i < words.length; i++) {
        const gap = words[i].start - words[i - 1].end;
        if (gap > maxPauseMs) {
            // Cut from the end of the pause to keepPauseMs before the next word.
            const cutStart = words[i - 1].end + keepPauseMs;
            const cutEnd = words[i].start;
            if (cutEnd > cutStart) {
                cuts.push({ startMs: cutStart, endMs: cutEnd, reason: 'pause' });
            }
        }
    }

    // Filler-as-gap: AssemblyAI leaves out "um" and "uh" by default, so fillers
    // often show up as a gap between two words inside a sentence. Inside a sentence
    // (previous word not ending in . ? !), a gap of 350–1200 ms becomes a 'filler'
    // cut leaving 150 ms of air.
    const FILLER_GAP_MIN = 350;
    const FILLER_GAP_MAX = 1200;
    const FILLER_KEEP_MS = 150;
    const endsSentence = (s: string) => /[.?!]$/.test(s.trim());
    for (let i = 1; i < words.length; i++) {
        const prev = words[i - 1];
        const gap = words[i].start - prev.end;
        if (gap >= FILLER_GAP_MIN && gap <= FILLER_GAP_MAX && !endsSentence(prev.text)) {
            cuts.push({
                startMs: prev.end + FILLER_KEEP_MS,
                endMs: words[i].start,
                reason: 'filler',
            });
        }
    }

    return cuts;
}

// Moves chapter start times onto the edited timeline. A chapter whose start was cut
// moves to the start of the next kept range.
export function applyToChapters(
    chapters: { startMs: number; title: string }[],
    ranges: KeptRange[],
): { startMs: number; title: string }[] {
    return chapters.map(ch => {
        const t = editedTime(ch.startMs, ranges, true);
        return { ...ch, startMs: t ?? 0 };
    });
}

// Moves quote times onto the edited timeline.
export function applyToQuotes(
    quotes: { startMs: number; endMs: number; text: string; speaker: string }[],
    ranges: KeptRange[],
): { startMs: number; endMs: number; text: string; speaker: string }[] {
    return quotes.map(q => {
        const start = editedTime(q.startMs, ranges, true);
        const end = editedTime(q.endMs, ranges, true);
        return { ...q, startMs: start ?? 0, endMs: end ?? (start ?? 0) };
    });
}
