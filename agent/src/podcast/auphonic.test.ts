// Editor Light, Card 5 test: auphonicCutsToEdit converts Auphonic cut regions to Cut[].
// Run: npx tsx --test agent/src/podcast/auphonic.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auphonicCutsToEdit, type AuphonicRegion } from './auphonic';

test('auphonicCutsToEdit converts regions to Cut[]', () => {
    // A small sample shaped like Auphonic's documented cut data:
    // filler at 1.5–2.1s, silence at 10.24–10.48s, cough at 15.0–15.3s.
    const regions: AuphonicRegion[] = [
        { start: 1.5, end: 2.1, type: 'filler' },
        { start: 10.24, end: 10.48, type: 'silence' },
        { start: 15.0, end: 15.3, type: 'cough' },
    ];

    const cuts = auphonicCutsToEdit(regions);

    assert.equal(cuts.length, 3);

    // Filler → 'filler' reason, times in ms.
    assert.equal(cuts[0].startMs, 1500);
    assert.equal(cuts[0].endMs, 2100);
    assert.equal(cuts[0].reason, 'filler');

    // Silence → 'pause' reason.
    assert.equal(cuts[1].startMs, 10240);
    assert.equal(cuts[1].endMs, 10480);
    assert.equal(cuts[1].reason, 'pause');

    // Cough → 'filler' reason (coughs are fillers in the edit model).
    assert.equal(cuts[2].startMs, 15000);
    assert.equal(cuts[2].endMs, 15300);
    assert.equal(cuts[2].reason, 'filler');
});

test('auphonicCutsToEdit handles empty input', () => {
    assert.deepEqual(auphonicCutsToEdit([]), []);
});
