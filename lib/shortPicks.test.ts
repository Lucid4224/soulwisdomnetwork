// Part B, smarter Shorts picking: the timed transcript Claude reads, clean ends for its picks,
// ranking without overlaps, the speaker shown, and adding or swapping a pick in as a short.
// Run: npx tsx --test lib/shortPicks.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
    DIRECTION_MAX, isTaken, overlapping, PICK_ASK, PICK_COUNT, pickInstructions, pickingTranscript, rankPicks, ShortPicksSchema,
    ShortSuggestionSchema, snapPick, speakerFor, suggestionToShort, swapIn, type ShortSuggestion,
} from './shortPicks';
import type { ShortEdit } from './shorts';

const w = (text: string, start: number, end: number) => ({ text, start, end });

// 60 words, one every half second, sentences ending at words 9, 29 and 49.
const SIXTY = Array.from({ length: 60 }, (_, i) => w(`w${i}${[9, 29, 49].includes(i) ? '.' : ''}`, i * 500, i * 500 + 400));

test('limits', () => {
    assert.equal(PICK_COUNT, 10);
    assert.equal(PICK_ASK, 15);
    assert.equal(DIRECTION_MAX, 1000);
});

test('pickingTranscript: a new line after a sentence, a pause of over 1.5 s, or 40 words', () => {
    const words = [w('Hello', 0, 300), w('there.', 400, 700), w('This', 800, 1100), w('  ', 1150, 1160), w('is', 1200, 1500),
        w('long', 3500, 3800), w('after', 3900, 4200), w('pause', 4300, 4600)];
    assert.equal(pickingTranscript(words), '[0ms 0:00] Hello there.\n[800ms 0:00] This is\n[3500ms 0:03] long after pause');
    const many = Array.from({ length: 45 }, (_, i) => w(`x${i}`, 60_000 + i * 300, 60_000 + i * 300 + 200));
    const lines = pickingTranscript(many).split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0].split(' ').length, 42);           // the time takes two
    assert.ok(lines[1].startsWith('[72000ms 1:12] x40 '));
    assert.equal(pickingTranscript([]), '');
});

test('snapPick: clean word ends, run on to finish the sentence, 5 s to 3 min', () => {
    assert.deepEqual(snapPick(SIXTY, 5000, 14000), { startMs: 4900, endMs: 15000 });   // runs on to "w29."
    assert.deepEqual(snapPick(SIXTY, 5000, 10000), { startMs: 4900, endMs: 10000 });   // no sentence end within 8 words
    assert.equal(snapPick(SIXTY, 5000, 6000), null);                                    // too short
    assert.equal(snapPick(SIXTY, 40000, 50000), null);                                  // past the end
    const long = Array.from({ length: 200 }, (_, i) => w(`y${i}`, i * 1000, i * 1000 + 800));
    assert.equal(snapPick(long, 0, 199_000), null);                                     // over three minutes
});

test('overlapping: more than half of the shorter one', () => {
    assert.equal(overlapping({ startMs: 0, endMs: 10000 }, { startMs: 5000, endMs: 20000 }), false);
    assert.equal(overlapping({ startMs: 0, endMs: 10000 }, { startMs: 4000, endMs: 20000 }), true);
    assert.equal(overlapping({ startMs: 0, endMs: 10000 }, { startMs: 10000, endMs: 20000 }), false);
});

test('rankPicks: best first, scores kept to 1-10, no overlaps, at most the count', () => {
    const p = (startMs: number, endMs: number, score: number, hook = 'Hook') => ({ startMs, endMs, score, speaker: ' Ana ', hook, reason: '  Lands   well. ' });
    const ranked = rankPicks([p(0, 30000, 7), p(10000, 40000, 9), p(50000, 70000, 7), p(100000, 120000, 12, 'Big   hook'),
        p(130000, 150000, 0), p(200000, 220000, 7)]);
    assert.deepEqual(ranked.map(r => [r.startMs, r.score]), [[100000, 10], [10000, 9], [50000, 7], [200000, 7], [130000, 1]]);
    assert.equal(ranked[0].hook, 'Big hook');
    assert.equal(ranked[0].reason, 'Lands well.');
    assert.equal(ranked[0].speaker, 'Ana');
    assert.deepEqual(rankPicks([p(0, 30000, 7), p(50000, 70000, 8), p(100000, 120000, 9)], 2).map(r => r.startMs), [100000, 50000]);
});

test('speakerFor: the key quote overlapping most, else Claude\'s name, else "Speaker"', () => {
    const quotes = [{ speaker: 'Ana', startMs: 0, endMs: 10000 }, { speaker: 'Ben', startMs: 8000, endMs: 30000 }];
    assert.equal(speakerFor(quotes, 9000, 20000, 'Cara'), 'Ben');
    assert.equal(speakerFor(quotes, 40000, 50000, ' Cara '), 'Cara');
    assert.equal(speakerFor([], 0, 1000, '  '), 'Speaker');
});

test('adding and swapping a pick in as a short', () => {
    const s: ShortSuggestion = { id: 'sug1', startMs: 60000, endMs: 90000, speaker: 'Ben', score: 8, hook: 'So here is', reason: 'Clear.' };
    assert.deepEqual(suggestionToShort(s, 'new1'),
        { id: 'new1', quoteIndex: null, speaker: 'Ben', startMs: 60000, endMs: 90000, headline: '', title: '', synthetic: false });
    const items: ShortEdit[] = [
        { id: 'a1b2', quoteIndex: 3, speaker: 'Ana', startMs: 0, endMs: 20000, headline: 'H', title: 'T', synthetic: true },
        { id: 'c3d4', quoteIndex: null, speaker: 'Ana', startMs: 70000, endMs: 85000, headline: 'H2', title: 'T2', synthetic: false },
    ];
    const swapped = swapIn(items, 'a1b2', s);
    assert.deepEqual(swapped[0], { id: 'a1b2', quoteIndex: null, speaker: 'Ben', startMs: 60000, endMs: 90000, headline: '', title: '', synthetic: true });
    assert.deepEqual(swapped[1], items[1]);
    assert.equal(isTaken(s, items), true);          // c3d4 sits inside it
    assert.equal(isTaken(s, [items[0]]), false);
});

test('the request and the shapes', () => {
    const plain = pickInstructions(PICK_ASK, '');
    assert.match(plain, /up to 15 moments/);
    assert.match(plain, /score from 1 to 10/);
    assert.doesNotMatch(plain, /Direction/);
    assert.ok(pickInstructions(15, '  Favour decisions. ').endsWith('\n\nDirection from the producer: Favour decisions.'));
    const json = z.toJSONSchema(ShortPicksSchema) as unknown as { properties: { picks: { items: { required: string[] } } } };
    assert.deepEqual([...json.properties.picks.items.required].sort(), ['endMs', 'hook', 'reason', 'score', 'speaker', 'startMs']);
    const ok = { id: 'abcd', startMs: 0, endMs: 1000, speaker: 'A', score: 10, hook: 'h', reason: 'r' };
    assert.equal(ShortSuggestionSchema.safeParse(ok).success, true);
    assert.equal(ShortSuggestionSchema.safeParse({ ...ok, score: 11 }).success, false);
});
