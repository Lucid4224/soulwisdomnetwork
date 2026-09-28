// Spec 005 step 11: moves times from the original recording onto the finished episode.
// Filler words, false starts and cuts in Descript make the final video shorter than the
// original, and the cold open and intro push everything later, so the show notes' chapter and
// quote times drift. Both recordings are transcribed word by word; runs of words that appear
// exactly once in each are paired, the pairs that keep their order are kept, and any other
// time is placed in proportion between the nearest pairs. docs/specs/010-final-cut.md

export interface TimedWord { text: string; start: number; end: number }

// Word runs this long, found exactly once in each transcript, pair the two up. The cold open
// repeats lines from later in the episode, so its runs appear twice in the final cut and
// never pair.
const RUN = 4;

// YouTube only shows chapters that start at 0:00, number at least three and last 10 seconds each.
export const MIN_CHAPTER_MS = 10_000;

const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, '');

function tokens(words: TimedWord[]) {
    const out: { t: string; start: number }[] = [];
    for (const w of words) {
        const t = token(w.text);
        if (t) out.push({ t, start: w.start });
    }
    return out;
}

function uniqueRuns(list: { t: string }[]) {
    const seen = new Map<string, number>();     // run -> index, or -1 once seen twice
    for (let i = 0; i + RUN <= list.length; i++) {
        const key = list.slice(i, i + RUN).map(x => x.t).join(' ');
        seen.set(key, seen.has(key) ? -1 : i);
    }
    return seen;
}

// Longest chain of pairs increasing in both transcripts (patience sorting).
function longestChain(pairs: { a: number; b: number }[]) {
    const tails: number[] = [];                 // index into pairs of the chain end, per length
    const prev = new Array<number>(pairs.length).fill(-1);
    for (let k = 0; k < pairs.length; k++) {
        let lo = 0, hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pairs[tails[mid]].a < pairs[k].a) lo = mid + 1;
            else hi = mid;
        }
        if (lo > 0) prev[k] = tails[lo - 1];
        tails[lo] = k;
    }
    const chain: { a: number; b: number }[] = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) chain.push(pairs[k]);
    return chain.reverse();
}

export interface TimeMap {
    // Where a moment of the original falls in the final cut, in milliseconds.
    at(originalMs: number): number;
    anchors: number;
    // Share of the original's words that were paired: low means the two do not match well.
    coverage: number;
}

export function timeMap(original: TimedWord[], final: TimedWord[], finalDurationMs: number): TimeMap {
    const a = tokens(original), b = tokens(final);
    const inA = uniqueRuns(a), inB = uniqueRuns(b);
    const pairs: { a: number; b: number }[] = [];
    for (const [key, j] of inB) {
        const i = inA.get(key);
        if (j >= 0 && i !== undefined && i >= 0) pairs.push({ a: i, b: j });
    }
    pairs.sort((x, y) => x.b - y.b);
    const chain = longestChain(pairs);
    // One anchor per paired word, in order; overlapping runs repeat words, so dedupe.
    const anchors: { o: number; f: number }[] = [];
    const used = new Set<number>();
    for (const p of chain) {
        for (let k = 0; k < RUN; k++) {
            if (used.has(p.a + k)) continue;
            used.add(p.a + k);
            const o = a[p.a + k].start, f = b[p.b + k].start;
            const last = anchors[anchors.length - 1];
            if (!last || (o > last.o && f >= last.f)) anchors.push({ o, f });
        }
    }
    const clamp = (ms: number) => Math.round(Math.min(Math.max(0, ms), finalDurationMs));

    function at(ms: number) {
        if (!anchors.length) return clamp(ms);
        if (ms <= anchors[0].o) return clamp(anchors[0].f - (anchors[0].o - ms));
        const end = anchors[anchors.length - 1];
        if (ms >= end.o) return clamp(end.f + (ms - end.o));
        let lo = 0, hi = anchors.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (anchors[mid].o <= ms) lo = mid;
            else hi = mid;
        }
        const x = anchors[lo], y = anchors[hi];
        return clamp(x.f + (ms - x.o) * (y.f - x.f) / (y.o - x.o));
    }

    return { at, anchors: anchors.length, coverage: a.length ? used.size / a.length : 0 };
}

export interface RetimedChapter { title: string; originalMs: number; startMs: number }
export interface RetimedQuote { text: string; speaker: string; originalMs: number; startMs: number; endMs: number }

// Chapters on the final cut. The first always starts at 0:00, so the cold open and intro
// belong to it; one that would start within 10 seconds of the one before is dropped.
export function retimeChapters(chapters: { title: string; startMs: number }[], map: TimeMap) {
    const out: RetimedChapter[] = [];
    const warnings: string[] = [];
    for (const [i, c] of chapters.entries()) {
        const startMs = i === 0 ? 0 : map.at(c.startMs);
        const prev = out[out.length - 1];
        if (prev && startMs - prev.startMs < MIN_CHAPTER_MS) {
            warnings.push(`Chapter "${c.title}" would start within 10 seconds of "${prev.title}" in the final cut, so it was left out.`);
            continue;
        }
        out.push({ title: c.title, originalMs: c.startMs, startMs });
    }
    if (out.length < 3) warnings.push('YouTube needs at least three chapters to show them.');
    return { chapters: out, warnings };
}

export function retimeQuotes(quotes: { text: string; speaker: string; startMs: number; endMs: number }[], map: TimeMap): RetimedQuote[] {
    return quotes.map(q => {
        const startMs = map.at(q.startMs);
        return { text: q.text, speaker: q.speaker, originalMs: q.startMs, startMs, endMs: Math.max(startMs, map.at(q.endMs)) };
    });
}
