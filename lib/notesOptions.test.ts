// Part A, the writing upgrade: the notes format follows the kind of recording, description
// choices, meeting decisions and action items with a Word download, and redrafting with the
// producer's direction. The defaults must stay exactly what the Studio always sent.
// Run: npx tsx --test lib/notesOptions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { z } from 'zod';
import { meetingDocx } from './meetingDoc';
import {
    chooseDescription, mergeRedraft, notesSchemaFor, redraftDirection, ShowNotesSchema, StoredShowNotesSchema, type ShowNotes,
} from './showNotes';
import { DEFAULT_SETTINGS, withDefaults } from './studioSettings';

const json = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema));
const PODCAST_WORDS = /near-death|NearDeath|meaning of life|angels|God is always/i;

// Notes as they were stored before Part A: no description options, decisions or action items.
const legacy = {
    titles: ['First title', 'Second title'], chosenTitle: 1,
    description: 'The description.', hashtags: ['#a'], summary: 'The summary.',
    chapters: [{ startMs: 0, title: 'Start' }, { startMs: 61000, title: 'Budget' }],
    quotes: [{ text: 'we ship friday', speaker: 'Sam', startMs: 5000, endMs: 7000 }],
    teaserClips: [], tags: ['t'], themes: ['x'], topics: ['y'],
    broll: [{ startMs: 1000, durationSeconds: 5, idea: 'idea', why: 'why', style: 'photo' }],
};
const notes = (over: Partial<ShowNotes> = {}): ShowNotes => ({ ...StoredShowNotesSchema.parse(legacy), ...over });

test('settings: description choices default to 1 and stay between 1 and 5', () => {
    assert.equal(DEFAULT_SETTINGS.descriptionChoices, 1);
    assert.equal(withDefaults({ descriptionChoices: 3 }).descriptionChoices, 3);
    assert.equal(withDefaults({ descriptionChoices: 9 }).descriptionChoices, 1);
    assert.equal(withDefaults({ descriptionChoices: 'three' }).descriptionChoices, 1);
});

test('defaults: the notes format is exactly the one the Studio always sent', () => {
    assert.equal(notesSchemaFor(DEFAULT_SETTINGS), ShowNotesSchema);
});

test('a meeting: decisions and action items with owners, no podcast examples', () => {
    const j = json(notesSchemaFor(withDefaults({ format: 'meeting' })));
    assert.match(j, /"decisions"/);
    assert.match(j, /"actionItems"/);
    assert.match(j, /"owner"/);
    assert.match(j, /"due"/);
    assert.doesNotMatch(j, PODCAST_WORDS);
    assert.doesNotMatch(j, /"descriptionOptions"/);
});

test('a talk: no podcast examples and no meeting fields', () => {
    const j = json(notesSchemaFor(withDefaults({ format: 'talk' })));
    assert.doesNotMatch(j, PODCAST_WORDS);
    assert.doesNotMatch(j, /"decisions"|"actionItems"/);
});

test('description choices: extra descriptions are asked for, the podcast wording stays', () => {
    const j = json(notesSchemaFor(withDefaults({ descriptionChoices: 3 })));
    assert.match(j, /"descriptionOptions"/);
    assert.match(j, /near-death/);
    assert.doesNotMatch(j, /"decisions"/);
});

test('stored notes from before Part A still load, with empty new parts', () => {
    const n = StoredShowNotesSchema.parse(legacy);
    assert.deepEqual(n.descriptionOptions, []);
    assert.deepEqual(n.decisions, []);
    assert.deepEqual(n.actionItems, []);
    const full = StoredShowNotesSchema.parse({ ...legacy, decisions: ['Ship Friday'], actionItems: [{ task: 'Write release notes', owner: 'Sam', due: 'Thursday' }] });
    assert.deepEqual(full.actionItems, [{ task: 'Write release notes', owner: 'Sam', due: 'Thursday' }]);
});

test('choosing another description swaps it with the current one', () => {
    const n = chooseDescription(notes({ description: 'A', descriptionOptions: ['B', 'C'] }), 1);
    assert.equal(n.description, 'C');
    assert.deepEqual(n.descriptionOptions, ['B', 'A']);
    assert.throws(() => chooseDescription(notes({ descriptionOptions: ['B'] }), 3));
});

test('redraft: only the chosen part is replaced', () => {
    const current = notes({ description: 'old desc', descriptionOptions: ['old opt'], titles: ['Old A', 'Old B'], chosenTitle: 1, summary: 'kept' });
    const fresh = notes({ description: 'new desc', descriptionOptions: ['new opt'], titles: ['New A', 'New B', 'New C'], chosenTitle: 0, summary: 'new summary' });

    const d = mergeRedraft(current, fresh, 'description');
    assert.equal(d.description, 'new desc');
    assert.deepEqual(d.descriptionOptions, ['new opt']);
    assert.deepEqual(d.titles, ['Old A', 'Old B']);
    assert.equal(d.chosenTitle, 1);
    assert.equal(d.summary, 'kept');

    const t = mergeRedraft(current, fresh, 'titles');
    assert.deepEqual(t.titles, ['New A', 'New B', 'New C']);
    assert.equal(t.chosenTitle, 0);
    assert.equal(t.description, 'old desc');
    assert.equal(t.summary, 'kept');

    assert.deepEqual(mergeRedraft(current, fresh, 'all'), fresh);
});

test('redraft direction: nothing without a request, the producer\'s words with one', () => {
    assert.equal(redraftDirection(null), '');
    assert.equal(redraftDirection(undefined), '');
    assert.equal(redraftDirection({ instruction: '   ', only: 'all' }), '');
    const d = redraftDirection({ instruction: 'Make it shorter and warmer.', only: 'description' });
    assert.match(d, /Make it shorter and warmer\./);
    assert.match(d, /description/i);
    assert.match(redraftDirection({ instruction: 'Punchier.', only: 'titles' }), /title/i);
});

// Reads a stored-entry ZIP: name -> bytes, checking each CRC with Node's own.
function unzip(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = new Map<string, Uint8Array>();
    let at = 0;
    while (view.getUint32(at, true) === 0x04034b50) {
        const crc = view.getUint32(at + 14, true);
        const size = view.getUint32(at + 18, true);
        const nameLen = view.getUint16(at + 26, true);
        const extraLen = view.getUint16(at + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
        const data = bytes.subarray(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + size);
        assert.equal(zlibCrc32(data) >>> 0, crc, `CRC of ${name}`);
        files.set(name, data);
        at += 30 + nameLen + extraLen + size;
    }
    const end = bytes.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50, 'end of the ZIP');
    assert.equal(view.getUint16(end + 10, true), files.size, 'entry count');
    return files;
}

test('meeting notes download: a Word document with every part, text made safe', () => {
    const bytes = meetingDocx({
        title: 'Team meeting: October', date: '2026-10-03', summary: 'We agreed the plan.\n\nThen we split the work.',
        decisions: ['Ship on Friday', 'R&D <plan> approved'],
        actionItems: [{ task: 'Write release notes', owner: 'Sam', due: 'Thursday' }, { task: 'Book the room', owner: '', due: '' }],
        chapters: [{ startMs: 0, title: 'Start' }, { startMs: 61000, title: 'Budget' }],
    });
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 2)), 'PK');
    const files = unzip(bytes);
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) assert.ok(files.has(name), `has ${name}`);
    const doc = new TextDecoder().decode(files.get('word/document.xml'));
    assert.match(doc, /^<\?xml/);
    assert.match(doc, /Team meeting: October/);
    assert.match(doc, /2026-10-03/);
    assert.match(doc, /Then we split the work\./);
    assert.match(doc, /Ship on Friday/);
    assert.match(doc, /R&amp;D &lt;plan&gt; approved/);
    assert.doesNotMatch(doc, /R&D <plan>/);
    assert.match(doc, /Write release notes/);
    assert.match(doc, /Sam/);
    assert.match(doc, /Thursday/);
    assert.match(doc, /Book the room/);
    assert.match(doc, /1:01/);
    assert.match(doc, /Budget/);
    assert.match(new TextDecoder().decode(files.get('[Content_Types].xml')), /wordprocessingml\.document\.main\+xml/);
});
