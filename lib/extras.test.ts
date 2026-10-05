// Part D: transcript downloads (Word, plain text, captions) and the writing extras (social posts
// and the follow-up email) Claude writes from the approved show notes.
// Run: npx tsx --test lib/extras.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
    cleanExtras, EXTRAS_DIRECTION_MAX, ExtrasSchema, extrasSystemPrompt, extrasUserMessage, mailtoLink, X_MAX,
} from './extras';
import { StoredShowNotesSchema, type ShowNotes, type SpokenWord } from './showNotes';
import { DEFAULT_SETTINGS, withDefaults } from './studioSettings';
import { downloadName, srtTime, transcriptDocx, transcriptParagraphs, transcriptSrt, transcriptText } from './transcriptExport';

const w = (text: string, start: number, end: number, speaker = 'Ana'): SpokenWord => ({ text, start, end, speaker, clip: false });
const WORDS = [w('Hello', 0, 400), w('there.', 500, 900), w(' ', 950, 960), w('Welcome', 1000, 1400), w('Hi', 2000, 2300, 'Ben'), w('Ana.', 2400, 2800, 'Ben'),
    w('Thanks', 70_000, 70_400)];

const base = {
    titles: ['First title', 'Second title'], chosenTitle: 1,
    description: 'The description.', hashtags: ['#a'], summary: 'The summary.',
    chapters: [{ startMs: 0, title: 'Start' }, { startMs: 61000, title: 'Budget' }],
    quotes: [{ text: 'we ship friday', speaker: 'Sam', startMs: 5000, endMs: 7000 }],
    teaserClips: [], tags: ['t'], themes: ['x'], topics: ['y'],
    broll: [{ startMs: 1000, durationSeconds: 5, idea: 'idea', why: 'why', style: 'photo' }],
};
const notes = (over: Partial<ShowNotes> = {}): ShowNotes => ({ ...StoredShowNotesSchema.parse(base), ...over });

test('limits', () => {
    assert.equal(EXTRAS_DIRECTION_MAX, 1000);
    assert.equal(X_MAX, 280);
});

test('paragraphs and plain text: one paragraph per speaker turn', () => {
    assert.deepEqual(transcriptParagraphs(WORDS), [
        { speaker: 'Ana', startMs: 0, text: 'Hello there. Welcome' },
        { speaker: 'Ben', startMs: 2000, text: 'Hi Ana.' },
        { speaker: 'Ana', startMs: 70000, text: 'Thanks' },
    ]);
    assert.equal(transcriptText('My Meeting', WORDS),
        'My Meeting\n\n[0:00] Ana: Hello there. Welcome\n\n[0:02] Ben: Hi Ana.\n\n[1:10] Ana: Thanks\n');
});

test('captions: SRT times and cues that break at sentences, speakers, 84 characters and 6 seconds', () => {
    assert.equal(srtTime(0), '00:00:00,000');
    assert.equal(srtTime(3_723_045), '01:02:03,045');
    assert.equal(transcriptSrt(WORDS),
        '1\n00:00:00,000 --> 00:00:00,900\nHello there.\n\n' +
        '2\n00:00:01,000 --> 00:00:01,400\nWelcome\n\n' +
        '3\n00:00:02,000 --> 00:00:02,800\nHi Ana.\n\n' +
        '4\n00:01:10,000 --> 00:01:10,400\nThanks\n');
    const long = Array.from({ length: 30 }, (_, i) => w(`word${i}`, i * 300, i * 300 + 250));
    const cues = transcriptSrt(long).split('\n\n');
    assert.ok(cues.every(c => c.split('\n')[2].length <= 84));
    assert.equal(cues.length, 3);
    const slow = Array.from({ length: 5 }, (_, i) => w(`s${i}`, i * 2000, i * 2000 + 500));
    assert.equal(transcriptSrt(slow).split('\n\n').length, 2);       // a cue never runs past 6 seconds
});

test('Word download: a valid file with the title and every turn', () => {
    const bytes = transcriptDocx('R&D <plan>', WORDS);
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString('hex'), '504b0304');
    const text = Buffer.from(bytes).toString('latin1');
    assert.match(text, /word\/document\.xml/);
    assert.match(text, /R&amp;D &lt;plan&gt;/);
    assert.match(text, /\[0:02\] Ben: Hi Ana\./);
});

test('file names are safe', () => {
    assert.equal(downloadName('Team sync: Q3 / plans!', 'srt'), 'Team-sync-Q3-plans.srt');
    assert.equal(downloadName('???', 'txt'), 'transcript.txt');
});

test('what Claude is asked: the notes, the link, decisions and action items, and the direction', () => {
    const plain = extrasUserMessage(notes(), 'https://youtu.be/x', '');
    assert.match(plain, /^Title: Second title/);
    assert.match(plain, /Chapters:\n0:00 Start\n1:01 Budget/);
    assert.match(plain, /"we ship friday" \(Sam\)/);
    assert.match(plain, /Link to share: https:\/\/youtu\.be\/x/);
    assert.match(plain, /short thank-you note/);
    assert.doesNotMatch(plain, /Decisions|Direction/);
    const meeting = extrasUserMessage(notes({ decisions: ['Ship Friday'], actionItems: [{ task: 'Write the post', owner: 'Ben', due: 'Monday' }] }), '', ' Keep it short. ');
    assert.match(meeting, /Decisions:\n- Ship Friday/);
    assert.match(meeting, /Action items:\n- Write the post \(owner: Ben\) \(due: Monday\)/);
    assert.doesNotMatch(meeting, /Link to share|thank-you/);
    assert.ok(meeting.endsWith('\n\nDirection from the producer: Keep it short.'));
});

test('instructions follow the settings', () => {
    const tom = extrasSystemPrompt(DEFAULT_SETTINGS);
    assert.match(tom, /^You write social posts and follow-up emails for Soul Wisdom Collective\. It explores near-death/);
    const mine = extrasSystemPrompt(withDefaults({ showName: 'Team Hub', about: '', extraInstructions: 'Use British spelling.' }));
    assert.match(mine, /^You write social posts and follow-up emails for Team Hub\. Write in plain/);
    assert.ok(mine.endsWith('Also follow these instructions from the producer:\nUse British spelling.'));
});

test('cleaning: trimmed, X kept under 280 characters at a word', () => {
    const long = `${'word '.repeat(70)}end`;
    const c = cleanExtras({ linkedin: ' L ', instagram: ' I ', x: long, followupSubject: ' Our   meeting ', followupBody: ' Body ' });
    assert.equal(c.linkedin, 'L');
    assert.equal(c.followupSubject, 'Our meeting');
    assert.ok(c.x.length <= 280);
    assert.ok(c.x.endsWith('word…'));
    assert.equal(cleanExtras({ ...c, x: ' short ' }).x, 'short');
    assert.equal(mailtoLink('Hi & bye', 'Line 1\nLine 2'), 'mailto:?subject=Hi%20%26%20bye&body=Line%201%0ALine%202');
    const json = z.toJSONSchema(ExtrasSchema) as unknown as { required: string[] };
    assert.deepEqual([...json.required].sort(), ['followupBody', 'followupSubject', 'instagram', 'linkedin', 'x']);
});
