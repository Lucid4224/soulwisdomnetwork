// Why: the timeline below the editor turns the transcript's words and cuts into a
// zoomable ruler, coloured speaker turns, and click-to-jump positions.

import { mmss } from './showNotes';

export const ZOOMS = [1, 2, 4, 8, 16, 32] as const;
export type Zoom = (typeof ZOOMS)[number];

// The next zoom level up, staying at 32 at the top.
export function zoomIn(z: number): number {
    const i = ZOOMS.indexOf(z as Zoom);
    if (i < 0) return ZOOMS[0];
    return ZOOMS[Math.min(ZOOMS.length - 1, i + 1)];
}

// The next zoom level down, staying at 1 at the bottom.
export function zoomOut(z: number): number {
    const i = ZOOMS.indexOf(z as Zoom);
    if (i < 0) return ZOOMS[0];
    return ZOOMS[Math.max(0, i - 1)];
}

// The ms between ruler ticks: the first step whose width in pixels is at least 80,
// or the last (an hour) when none fits or the inputs are non-positive.
export function tickStep(totalMs: number, widthPx: number): number {
    const STEPS = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000];
    if (totalMs <= 0 || widthPx <= 0) return 3600000;
    for (const step of STEPS) {
        if (step * widthPx / totalMs >= 80) return step;
    }
    return 3600000;
}

// 0, step, 2*step, ... while each is <= totalMs.
export function ticks(totalMs: number, widthPx: number): number[] {
    if (totalMs <= 0) return [];
    const step = tickStep(totalMs, widthPx);
    const out: number[] = [0];
    let t = step;
    while (t <= totalMs) { out.push(t); t += step; }
    return out;
}

// ms as a percentage of totalMs, kept to 0..100; 0 when totalMs is non-positive.
export function pct(ms: number, totalMs: number): number {
    if (totalMs <= 0) return 0;
    const v = ms / totalMs * 100;
    return Math.max(0, Math.min(100, v));
}

// The ms at a click x in a widthPx-wide track over totalMs, clamped to 0..totalMs.
export function msAt(x: number, widthPx: number, totalMs: number): number {
    if (widthPx <= 0) return 0;
    const v = Math.round(x / widthPx * totalMs);
    return Math.max(0, Math.min(totalMs, v));
}

export interface SpeakerBlock { speaker: string; startMs: number; endMs: number }

// Consecutive words of one speaker make one block, from the first word's start
// to the last word's end.
export function speakerBlocks(words: { speaker: string; start: number; end: number }[]): SpeakerBlock[] {
    const blocks: SpeakerBlock[] = [];
    for (const w of words) {
        const last = blocks[blocks.length - 1];
        if (last && last.speaker === w.speaker) {
            last.endMs = w.end;
        } else {
            blocks.push({ speaker: w.speaker, startMs: w.start, endMs: w.end });
        }
    }
    return blocks;
}

export const SPEAKER_COLORS = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fb7185', '#facc15', '#2dd4bf'] as const;

// A colour per speaker, in the order they first appear; the 9th reuses the 1st.
export function speakerColors(blocks: SpeakerBlock[]): Record<string, string> {
    const speakers: string[] = [];
    for (const b of blocks) if (!speakers.includes(b.speaker)) speakers.push(b.speaker);
    const out: Record<string, string> = {};
    for (let i = 0; i < speakers.length; i++) {
        out[speakers[i]] = SPEAKER_COLORS[i % SPEAKER_COLORS.length];
    }
    return out;
}

// mm:ss for the ruler labels.
export function tickLabel(ms: number): string {
    return mmss(ms);
}
