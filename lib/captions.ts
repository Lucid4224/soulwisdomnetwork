// Captions for the finished episode (spec 005 step 13; docs/specs/012-youtube-upload.md), built from
// the final cut's own word timings (final/words.json, made in step 11), so names and spellings
// match what AssemblyAI heard in the edit rather than YouTube's automatic captions.

import type { TimedWord } from './retime';

// Broadcast-style limits: two lines of up to 42 characters, on screen for 1 to 6 seconds.
const LINE_CHARS = 42;
const CUE_CHARS = LINE_CHARS * 2;
const MAX_CUE_MS = 6000;
const MIN_CUE_MS = 1000;
// A pause this long starts a new caption; so does the end of a sentence once there is enough on screen.
const PAUSE_MS = 700;
const SENTENCE_MIN_CHARS = 24;

export interface Cue { startMs: number; endMs: number; lines: string[] }

// Splits a caption's text into at most two lines, as evenly as the words allow.
function twoLines(words: string[]) {
    const text = words.join(' ');
    if (text.length <= LINE_CHARS) return [text];
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' ').length, b = words.slice(i).join(' ').length;
        if (a > LINE_CHARS || b > LINE_CHARS) continue;
        if (Math.abs(a - b) < bestDiff) { best = i; bestDiff = Math.abs(a - b); }
    }
    return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export function buildCues(words: TimedWord[]): Cue[] {
    const cues: Cue[] = [];
    let current: TimedWord[] = [];
    const flush = () => {
        if (!current.length) return;
        cues.push({ startMs: current[0].start, endMs: current[current.length - 1].end, lines: twoLines(current.map(w => w.text)) });
        current = [];
    };
    for (const w of words) {
        const text = w.text.trim();
        if (!text) continue;
        if (current.length) {
            const last = current[current.length - 1];
            const length = current.map(x => x.text).join(' ').length + 1 + text.length;
            const sentenceEnded = /[.?!]["”’)]*$/.test(last.text) && length - text.length > SENTENCE_MIN_CHARS;
            if (length > CUE_CHARS || w.end - current[0].start > MAX_CUE_MS || w.start - last.end > PAUSE_MS || sentenceEnded) flush();
        }
        current.push({ ...w, text });
    }
    flush();
    // Short captions stay up a little longer, but never over the next one.
    for (let i = 0; i < cues.length; i++) {
        const next = cues[i + 1]?.startMs ?? Infinity;
        cues[i].endMs = Math.min(Math.max(cues[i].endMs, cues[i].startMs + MIN_CUE_MS), next);
    }
    return cues;
}

function stamp(ms: number) {
    const t = Math.max(0, Math.round(ms));
    const h = Math.floor(t / 3_600_000), m = Math.floor(t / 60_000) % 60, s = Math.floor(t / 1000) % 60;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

export function toSrt(cues: Cue[]) {
    return cues.map((c, i) => `${i + 1}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${c.lines.join('\n')}\n`).join('\n');
}
