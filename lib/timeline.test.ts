// Part E, the editor workspace: zoom levels, ruler ticks, click positions, speaker turns and
// colours behind the timeline.
// Run: npx tsx --test lib/timeline.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msAt, pct, SPEAKER_COLORS, speakerBlocks, speakerColors, tickLabel, ticks, tickStep, zoomIn, zoomOut, ZOOMS } from './timeline';

test('zoom levels step in and out and stop at the ends', () => {
    assert.deepEqual([...ZOOMS], [1, 2, 4, 8, 16, 32]);
    assert.equal(zoomIn(1), 2);
    assert.equal(zoomIn(32), 32);
    assert.equal(zoomOut(4), 2);
    assert.equal(zoomOut(1), 1);
});

test('ruler: at least 80 pixels between labels', () => {
    assert.equal(tickStep(3_600_000, 1000), 300_000);      // an hour across 1000 px: every 5 minutes
    assert.equal(tickStep(3_600_000, 16_000), 30_000);     // zoomed in 16 times: every 30 seconds
    assert.equal(tickStep(60_000, 1000), 5000);            // a minute: every 5 seconds
    assert.equal(tickStep(10_000_000, 100), 3_600_000);    // never wider than an hour
    assert.equal(tickStep(0, 1000), 3_600_000);
    assert.deepEqual(ticks(60_000, 1000), [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 55000, 60000]);
    assert.deepEqual(ticks(0, 1000), []);
    assert.equal(tickLabel(65_000), '1:05');
    assert.equal(tickLabel(3_725_000), '1:02:05');
});

test('positions: percentages and clicks stay inside the recording', () => {
    assert.equal(pct(30_000, 60_000), 50);
    assert.equal(pct(-5, 60_000), 0);
    assert.equal(pct(90_000, 60_000), 100);
    assert.equal(pct(10, 0), 0);
    assert.equal(msAt(250, 1000, 60_000), 15_000);
    assert.equal(msAt(-20, 1000, 60_000), 0);
    assert.equal(msAt(1200, 1000, 60_000), 60_000);
    assert.equal(msAt(10, 0, 60_000), 0);
});

test('speaker turns and colours', () => {
    const w = (speaker: string, start: number, end: number) => ({ speaker, start, end, text: 'x' });
    const blocks = speakerBlocks([w('Ana', 0, 400), w('Ana', 500, 900), w('Ben', 1000, 1500), w('Ana', 2000, 2600)]);
    assert.deepEqual(blocks, [
        { speaker: 'Ana', startMs: 0, endMs: 900 },
        { speaker: 'Ben', startMs: 1000, endMs: 1500 },
        { speaker: 'Ana', startMs: 2000, endMs: 2600 },
    ]);
    assert.deepEqual(speakerBlocks([]), []);
    assert.deepEqual(speakerColors(blocks), { Ana: SPEAKER_COLORS[0], Ben: SPEAKER_COLORS[1] });
    const many = Array.from({ length: 9 }, (_, i) => ({ speaker: `S${i}`, startMs: i, endMs: i + 1 }));
    assert.equal(speakerColors(many).S8, SPEAKER_COLORS[0]);
});
