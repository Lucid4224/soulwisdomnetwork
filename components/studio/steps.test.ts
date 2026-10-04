// Part C, the guided flow: the steps follow who makes the final cut (Descript stays exactly as
// it was), and the journey across the Studio pages says what is done and what comes next.
// Run: npx tsx --test components/studio/steps.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    flowFor, journey, journeyHref, JOURNEY, labelIn, nextStep, stageIn, STAGES, STEPS, type StepState,
} from './steps';

const done = (yes: boolean): StepState => ({ done: yes, failed: false, working: false, summary: '', link: null, key: 'k' });

test('Descript, or nothing set: exactly the steps and stages the Studio always had', () => {
    assert.equal(flowFor('descript').steps, STEPS);
    assert.equal(flowFor('descript').stages, STAGES);
    assert.equal(flowFor(undefined).steps, STEPS);
    assert.equal(flowFor(null).stages, STAGES);
    assert.deepEqual(STEPS.map(([id]) => id), ['notes', 'broll', 'package', 'descript', 'final', 'thumbnail', 'youtube', 'shorts']);
});

test('Editor Light: no edit package or Descript; the edit and render are the final cut', () => {
    const flow = flowFor('editorLight');
    assert.deepEqual(flow.steps.map(([id]) => id), ['notes', 'broll', 'final', 'thumbnail', 'youtube', 'shorts']);
    assert.deepEqual(flow.stages.map(s => s.id), ['notes', 'broll', 'final', 'thumbnail', 'shorts']);
    assert.equal(labelIn(flow, 'final'), 'Edit and render the final cut');
    assert.equal(stageIn(flow, 'final')?.title, 'Edit and final cut');
    assert.equal(stageIn(flow, 'package'), undefined);
    assert.deepEqual(flow.stages.filter(s => s.checkpoint).map(s => [s.id, s.checkpoint]), [['notes', 'B'], ['thumbnail', 'D'], ['shorts', 'E']]);
    assert.ok(!JSON.stringify(flow).includes('Descript'));
});

test('the next step skips what Editor Light does not use', () => {
    const states = { notes: done(true), broll: done(true) };
    assert.equal(nextStep(flowFor('editorLight'), states), 'final');
    assert.equal(nextStep(flowFor('descript'), states), 'package');
    assert.equal(nextStep(flowFor('editorLight'), { ...states, final: done(true), thumbnail: done(true), youtube: done(true), shorts: done(true) }), undefined);
    assert.equal(labelIn(flowFor('descript'), 'descript'), 'Send to Descript');
});

test('journey: done, the first not done is current, the rest wait', () => {
    assert.deepEqual(JOURNEY, ['Upload', 'Speakers', 'Show notes', 'Edit', 'Publish', 'Shorts']);
    const none = { accepted: false, notesApproved: false, finalReady: false, published: false, shortsScheduled: false };
    assert.deepEqual(journey(none).map(j => j.status), ['done', 'current', 'waiting', 'waiting', 'waiting', 'waiting']);
    assert.deepEqual(journey({ ...none, accepted: true, notesApproved: true }).map(j => j.status),
        ['done', 'done', 'done', 'current', 'waiting', 'waiting']);
    assert.deepEqual(journey({ accepted: true, notesApproved: true, finalReady: true, published: true, shortsScheduled: true }).map(j => j.status),
        ['done', 'done', 'done', 'done', 'done', 'done']);
    assert.equal(journey(none)[3].label, 'Edit');
});

test('journey links: each part opens where it is worked on', () => {
    assert.equal(journeyHref('ep1234567890', 0, 'descript'), '/admin/podcast');
    assert.equal(journeyHref('ep1234567890', 1, 'descript'), '/admin/podcast/ep1234567890');
    assert.equal(journeyHref('ep1234567890', 2, 'descript'), '/admin/podcast/ep1234567890/notes#notes');
    assert.equal(journeyHref('ep1234567890', 3, 'descript'), '/admin/podcast/ep1234567890/notes#package');
    assert.equal(journeyHref('ep1234567890', 3, 'editorLight'), '/admin/podcast/ep1234567890/notes#final');
    assert.equal(journeyHref('ep1234567890', 3, undefined), '/admin/podcast/ep1234567890/notes#package');
    assert.equal(journeyHref('ep1234567890', 4, 'editorLight'), '/admin/podcast/ep1234567890/notes#thumbnail');
    assert.equal(journeyHref('ep1234567890', 5, 'editorLight'), '/admin/podcast/ep1234567890/notes#shorts');
});
