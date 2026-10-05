// Parts F and G: the playback speeds, the Studio home page's sections, and where each episode's
// "Continue" button leads.
// Run: npx tsx --test lib/studioUi.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continueTarget, episodeGroups, SPEEDS } from './studioUi';
import type { EpisodeSummary } from '../types/studio';

const none = { notesApproved: false, finalReady: false, published: false, shortsScheduled: false };
const ep = (id: string, status: string, over: Partial<EpisodeSummary> = {}): EpisodeSummary => ({
    id, title: id, status: status as EpisodeSummary['status'], stage: 'ready' as EpisodeSummary['stage'], recordedAt: null, durationSeconds: null,
    costUsd: 0, error: null, docUrl: null, createdAt: null, updatedAt: null, stuck: false, stepErrors: [], finished: null, youtubeUrl: null,
    progress: none, notesStatus: null, ...over,
});

test('speeds', () => {
    assert.deepEqual([...SPEEDS], [0.75, 1, 1.25, 1.5, 2]);
});

test('home page sections', () => {
    const g = episodeGroups([
        ep('a', 'ingesting'), ep('b', 'transcribing'), ep('c', 'failed'),
        ep('d', 'awaiting_speaker_review', { updatedAt: 100 }), ep('e', 'speakers_confirmed', { updatedAt: 300 }), ep('f', 'speakers_confirmed'),
        ep('g', 'speakers_confirmed', { finished: { by: 'x', at: 5 } }), ep('h', 'speakers_confirmed', { finished: { by: 'x', at: 9 } }),
    ]);
    assert.deepEqual(g.processing.map(e => e.id), ['a', 'b']);
    assert.deepEqual(g.failed.map(e => e.id), ['c']);
    assert.deepEqual(g.active.map(e => e.id), ['e', 'd', 'f']);
    assert.deepEqual(g.finished.map(e => e.id), ['h', 'g']);
});

test('Continue leads to the step the episode is on', () => {
    assert.deepEqual(continueTarget(ep('ep1', 'awaiting_speaker_review'), 'descript'), { label: 'Continue: Speakers', href: '/admin/podcast/ep1' });
    assert.deepEqual(continueTarget(ep('ep1', 'speakers_confirmed'), 'descript'), { label: 'Continue: Show notes', href: '/admin/podcast/ep1/notes#notes' });
    assert.deepEqual(continueTarget(ep('ep1', 'speakers_confirmed', { progress: { ...none, notesApproved: true } }), 'editorLight'),
        { label: 'Continue: Edit', href: '/admin/podcast/ep1/notes#final' });
    assert.deepEqual(continueTarget(ep('ep1', 'speakers_confirmed', { progress: { ...none, notesApproved: true } }), 'descript'),
        { label: 'Continue: Edit', href: '/admin/podcast/ep1/notes#package' });
    assert.deepEqual(continueTarget(ep('ep1', 'speakers_confirmed', { progress: { notesApproved: true, finalReady: true, published: true, shortsScheduled: false } }), null),
        { label: 'Continue: Shorts', href: '/admin/podcast/ep1/notes#shorts' });
    assert.deepEqual(continueTarget(ep('ep1', 'speakers_confirmed', { progress: { notesApproved: true, finalReady: true, published: true, shortsScheduled: true } }), null),
        { label: 'Open', href: '/admin/podcast/ep1/notes' });
});
