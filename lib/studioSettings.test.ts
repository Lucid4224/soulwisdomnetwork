// Studio settings: the defaults must give exactly what the Studio always did, so Tom's flow
// is unchanged, and other settings must reach the prompts, colours and description.
// Run: npx tsx --test lib/studioSettings.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    assColor, DEFAULT_SETTINGS, gradientExpr, notesSystemPrompt, shortsSystemPrompt, StudioSettingsSchema,
    thumbnailsSystemPrompt, withDefaults,
} from './studioSettings';

// The prompts exactly as the Studio sent them before settings existed.
const LEGACY_NOTES = "You write show notes for the Soul Wisdom Collective podcast, hosted by Daniel Endy and Tom Wood. The show explores near-death experiences, consciousness and the meaning of life with warmth and curiosity, for listeners who are spiritually open but not dogmatic.\n\nWrite in plain, warm, specific language. Avoid hype, clickbait and clichés (\"delve\", \"journey\", \"unlock\"). Never claim as fact what a speaker offered as belief or experience; attribute it (\"Daniel describes…\").\n\nTimestamps: every paragraph of the transcript starts with its time in milliseconds, e.g. [65000ms 1:05]. Use those numbers for startMs. Chapters and b-roll must start at a paragraph's time; quotes at the paragraph they come from.\n\nQuotes and teaser clips must be copied exactly from the transcript, with the speaker name exactly as the transcript gives it. Lines marked \"(clip played during the episode)\" are recordings of guests played during the show; they are part of the story, so quote them and use them in the teaser like anyone else. Every guest, whether in the room or in a recording, should have at least one or two quotes.\n\nQuotes are raw material for shorts: give up to twenty, from a single striking sentence to a passage of up to two minutes that stands on its own. Producers find it easier to delete than to add, so err towards more.\n\nThe YouTube description is written to be found and clicked: front-load the hook and keywords in the first two lines, because only those show before \"more\". The site link (https://soulwisdomcollective.com), chapters, subscribe line and hashtags are added automatically, so do not write them yourself.";
const LEGACY_SHORTS = "You pick moments from the Soul Wisdom Collective podcast for YouTube Shorts. The podcast explores near-death experiences, consciousness and the meaning of life with warmth and curiosity. A good Short grabs attention in its first two seconds, makes sense to someone who has never seen the episode, and ends on a complete thought or a line that lands. Never state as fact what a guest offered as belief or experience.";
const LEGACY_THUMBS = "You write the text for YouTube thumbnails for the Soul Wisdom Collective podcast, which explores near-death experiences, consciousness and the meaning of life with warmth and curiosity. The text is a few large words on the image, read in a second on a phone. Never state as fact what a guest offered as belief or experience.";

test('defaults: prompts are word for word what the Studio always sent', () => {
    assert.equal(notesSystemPrompt(DEFAULT_SETTINGS), LEGACY_NOTES);
    assert.equal(shortsSystemPrompt(DEFAULT_SETTINGS), LEGACY_SHORTS);
    assert.equal(thumbnailsSystemPrompt(DEFAULT_SETTINGS), LEGACY_THUMBS);
});

test('defaults: colours give the brand values the renders always used', () => {
    assert.equal(assColor(DEFAULT_SETTINGS.colors.accent), '&H5BC6F7&');
    assert.equal(assColor(DEFAULT_SETTINGS.colors.background), '&H2E0A14&');
    assert.equal(gradientExpr(DEFAULT_SETTINGS.colors.background, DEFAULT_SETTINGS.colors.backgroundBottom),
        "r='20+22*Y/H':g='10+11*Y/H':b='46+36*Y/H'");
});

test('nothing saved, or junk saved, falls back to the defaults', () => {
    assert.deepEqual(withDefaults(undefined), DEFAULT_SETTINGS);
    assert.deepEqual(withDefaults({ format: 'opera', colors: { accent: 'gold' }, hosts: 'x' }), DEFAULT_SETTINGS);
    assert.ok(StudioSettingsSchema.safeParse(DEFAULT_SETTINGS).success);
});

test('a meeting: no hosts, meeting wording, extra instructions, no site link', () => {
    const s = withDefaults({
        showName: 'Acme Weekly', about: 'covers what the team decided this week', audience: '', hosts: [],
        format: 'meeting', extraInstructions: 'List action items with owners.', siteUrl: '', subscribeLine: '',
    });
    const notes = notesSystemPrompt(s);
    assert.match(notes, /^You write show notes for the Acme Weekly meeting\. The meeting covers what the team decided this week\./);
    assert.match(notes, /This is a recorded meeting, not a show\./);
    assert.match(notes, /\("The speaker describes…"\)/);
    assert.match(notes, /Chapters and hashtags are added automatically/);
    assert.doesNotMatch(notes, /Soul Wisdom|Daniel|guest/);
    assert.match(notes, /Also follow these instructions from the producer:\nList action items with owners\.$/);
    assert.match(shortsSystemPrompt(s), /Acme Weekly meeting for YouTube Shorts.*never seen the meeting.*what a speaker offered/);
    assert.match(thumbnailsSystemPrompt(s), /for the Acme Weekly meeting, which covers what the team decided this week\./);
});

test('custom colours turn into ASS and gradient values', () => {
    assert.equal(assColor('#ff8000'), '&H0080FF&');
    assert.equal(gradientExpr('#ffffff', '#000000'), "r='255-255*Y/H':g='255-255*Y/H':b='255-255*Y/H'");
});
