import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    keepRanges, editedTime, editedDuration, suggestCuts,
    applyToChapters, applyToQuotes,
    type KeptRange,
} from './edit';
import type { SpokenWord } from './showNotes';

describe('keepRanges', () => {
    test('empty cuts returns full duration', () => {
        const r = keepRanges(10_000, []);
        assert.equal(r.length, 1);
        assert.equal(r[0].startMs, 0);
        assert.equal(r[0].endMs, 10_000);
    });

    test('single cut in middle', () => {
        const r = keepRanges(10_000, [{ startMs: 3000, endMs: 5000, reason: 'manual' }]);
        assert.equal(r.length, 2);
        assert.equal(r[0].startMs, 0);
        assert.equal(r[0].endMs, 2960);  // 3000 - 40 pad
        assert.equal(r[1].startMs, 5040); // 5000 + 40 pad
        assert.equal(r[1].endMs, 10_000);
    });

    test('overlapping cuts merged', () => {
        const r = keepRanges(10_000, [
            { startMs: 2000, endMs: 4000, reason: 'filler' },
            { startMs: 3500, endMs: 6000, reason: 'pause' },
        ]);
        assert.equal(r.length, 2);
        assert.equal(r[0].endMs, 1960);
        assert.equal(r[1].startMs, 6040);
    });

    test('touching cuts merged (within pad)', () => {
        const r = keepRanges(10_000, [
            { startMs: 2000, endMs: 3000, reason: 'filler' },
            { startMs: 3010, endMs: 5000, reason: 'pause' },
        ]);
        // 3010 - 3000 = 10 < padMs(40), so merged
        assert.equal(r.length, 2);
        assert.equal(r[0].endMs, 1960);
        assert.equal(r[1].startMs, 5040);
    });

    test('tiny fragment dropped', () => {
        const r = keepRanges(10_000, [
            { startMs: 100, endMs: 200, reason: 'filler' },
            { startMs: 250, endMs: 400, reason: 'filler' },
        ]);
        // The gap between 240 and 210 is only 30ms — too short, dropped.
        // Both cuts merge (within pad), so cursor moves to ~440.
        // Fragment before is 0..60 — also too short.
        assert.equal(r.length, 1);
        assert.equal(r[0].startMs, 440);
    });

    test('cut at start', () => {
        const r = keepRanges(10_000, [{ startMs: 0, endMs: 2000, reason: 'pause' }]);
        assert.equal(r.length, 1);
        assert.equal(r[0].startMs, 2040);
    });

    test('cut at end', () => {
        const r = keepRanges(10_000, [{ startMs: 8000, endMs: 10_000, reason: 'pause' }]);
        assert.equal(r.length, 1);
        assert.equal(r[0].endMs, 7960);
    });

    test('zero duration returns empty', () => {
        assert.deepEqual(keepRanges(0, []), []);
    });
});

describe('editedTime', () => {
    const ranges: KeptRange[] = [
        { startMs: 0, endMs: 2000 },
        { startMs: 3000, endMs: 5000 },
    ];

    test('time inside first range', () => {
        assert.equal(editedTime(1000, ranges), 1000);
    });

    test('time inside second range', () => {
        assert.equal(editedTime(4000, ranges), 2000 + (4000 - 3000));
        // = 3000
    });

    test('time in a cut returns null', () => {
        assert.equal(editedTime(2500, ranges), null);
    });

    test('time at cut boundary returns null', () => {
        assert.equal(editedTime(2000, ranges), 2000);  // at end of first range — kept
    });

    test('time at start of range', () => {
        assert.equal(editedTime(3000, ranges), 2000);
    });

    test('roundToNextKept in a cut', () => {
        assert.equal(editedTime(2500, ranges, true), 2000);  // start of next range
    });

    test('time past end returns null', () => {
        assert.equal(editedTime(6000, ranges), null);
    });

    test('empty ranges returns null', () => {
        assert.equal(editedTime(1000, []), null);
    });
});

describe('editedDuration', () => {
    test('multiple ranges', () => {
        const r: KeptRange[] = [
            { startMs: 0, endMs: 2000 },
            { startMs: 3000, endMs: 5000 },
        ];
        assert.equal(editedDuration(r), 4000);
    });

    test('empty', () => {
        assert.equal(editedDuration([]), 0);
    });
});

describe('suggestCuts', () => {
    const baseWords: SpokenWord[] = [
        { text: 'hello', start: 0, end: 500, speaker: 'Host', clip: false },
        { text: 'um', start: 500, end: 700, speaker: 'Host', clip: false },
        { text: 'world', start: 700, end: 1200, speaker: 'Host', clip: false },
    ];

    test('filler words detected', () => {
        const cuts = suggestCuts(baseWords);
        const fillers = cuts.filter(c => c.reason === 'filler');
        assert.equal(fillers.length, 1);
        assert.equal(fillers[0].startMs, 500);
        assert.equal(fillers[0].endMs, 700);
    });

    test('repeated words detected', () => {
        const words: SpokenWord[] = [
            { text: 'the', start: 0, end: 300, speaker: 'Host', clip: false },
            { text: 'the', start: 300, end: 600, speaker: 'Host', clip: false },
            { text: 'point', start: 600, end: 900, speaker: 'Host', clip: false },
        ];
        const cuts = suggestCuts(words);
        const repeats = cuts.filter(c => c.reason === 'repeat');
        assert.equal(repeats.length, 1);
        assert.equal(repeats[0].startMs, 0);
    });

    test('long pause shortened', () => {
        const words: SpokenWord[] = [
            { text: 'first', start: 0, end: 500, speaker: 'Host', clip: false },
            { text: 'second', start: 2000, end: 2500, speaker: 'Host', clip: false },
        ];
        const cuts = suggestCuts(words);
        const pauses = cuts.filter(c => c.reason === 'pause');
        assert.equal(pauses.length, 1);
        // Cut from 500 + 500 = 1000 to 2000
        assert.equal(pauses[0].startMs, 1000);
        assert.equal(pauses[0].endMs, 2000);
    });

    test('case insensitive filler', () => {
        const words: SpokenWord[] = [
            { text: 'Um', start: 0, end: 200, speaker: 'Host', clip: false },
            { text: 'UH', start: 200, end: 400, speaker: 'Host', clip: false },
        ];
        const cuts = suggestCuts(words);
        assert.equal(cuts.filter(c => c.reason === 'filler').length, 2);
    });

    test('punctuation-insensitive filler', () => {
        const words: SpokenWord[] = [
            { text: 'um...', start: 0, end: 200, speaker: 'Host', clip: false },
        ];
        const cuts = suggestCuts(words);
        assert.equal(cuts.filter(c => c.reason === 'filler').length, 1);
    });

    test('empty words returns empty cuts', () => {
        assert.deepEqual(suggestCuts([]), []);
    });

    test('no fillers or pauses returns empty', () => {
        const words: SpokenWord[] = [
            { text: 'hello', start: 0, end: 500, speaker: 'Host', clip: false },
            { text: 'world', start: 600, end: 1100, speaker: 'Host', clip: false },
        ];
        assert.deepEqual(suggestCuts(words), []);
    });

    test('filler-as-gap detected inside a sentence', () => {
        // A 600 ms gap between two words in the middle of a sentence.
        const words: SpokenWord[] = [
            { text: 'the', start: 0, end: 300, speaker: 'Host', clip: false },
            { text: 'meaning', start: 900, end: 1200, speaker: 'Host', clip: false },
        ];
        const cuts = suggestCuts(words);
        const fillers = cuts.filter(c => c.reason === 'filler');
        assert.equal(fillers.length, 1);
        // Cut starts at 300 + 150 = 450, ends at 900.
        assert.equal(fillers[0].startMs, 450);
        assert.equal(fillers[0].endMs, 900);
    });

    test('filler-as-gap not detected after sentence end', () => {
        // A 600 ms gap after a word ending with a period — not a filler, it's a pause.
        const words: SpokenWord[] = [
            { text: 'done.', start: 0, end: 300, speaker: 'Host', clip: false },
            { text: 'Next', start: 900, end: 1200, speaker: 'Host', clip: false },
        ];
        const cuts = suggestCuts(words);
        const fillers = cuts.filter(c => c.reason === 'filler');
        assert.equal(fillers.length, 0);
    });
});

describe('applyToChapters', () => {
    test('chapter in kept range', () => {
        const ranges: KeptRange[] = [{ startMs: 0, endMs: 5000 }];
        const chapters = [{ startMs: 1000, title: 'Intro' }];
        const result = applyToChapters(chapters, ranges);
        assert.equal(result[0].startMs, 1000);
    });

    test('chapter in cut moves to next kept', () => {
        const ranges: KeptRange[] = [
            { startMs: 0, endMs: 2000 },
            { startMs: 4000, endMs: 8000 },
        ];
        const chapters = [{ startMs: 3000, title: 'Middle' }];
        const result = applyToChapters(chapters, ranges);
        assert.equal(result[0].startMs, 2000);  // start of second range in edited time
    });
});

describe('applyToQuotes', () => {
    test('quote times mapped', () => {
        const ranges: KeptRange[] = [
            { startMs: 0, endMs: 2000 },
            { startMs: 3000, endMs: 6000 },
        ];
        const quotes = [{ startMs: 3500, endMs: 4500, text: 'test', speaker: 'Host' }];
        const result = applyToQuotes(quotes, ranges);
        assert.equal(result[0].startMs, 2000 + (3500 - 3000));  // 2500
        assert.equal(result[0].endMs, 2000 + (4500 - 3000));    // 3500
    });
});

describe('empty edit', () => {
    test('no cuts means full duration kept', () => {
        const r = keepRanges(10_000, []);
        assert.equal(editedDuration(r), 10_000);
    });

    test('editedTime returns original for no cuts', () => {
        const r = keepRanges(10_000, []);
        assert.equal(editedTime(5000, r), 5000);
    });
});
