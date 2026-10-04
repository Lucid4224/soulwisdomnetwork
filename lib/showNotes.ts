// Show notes for one episode (spec 005 step 5, Checkpoint B; docs/specs/007-show-notes.md).
// One schema for three jobs: what Claude must return, what the server accepts when a
// producer saves edits, and what the Checkpoint B page edits.

import { z } from 'zod';
import { BROLL_STYLE_IDS } from './broll';
import type { DescriptionLinks, StudioSettings } from './studioSettings';

const ms = z.number().int().describe('Milliseconds from the start of the episode');

export const SITE_URL = 'https://soulwisdomcollective.com';

// Always under the description on YouTube, whatever Claude or a producer writes above it.
export const DESCRIPTION_FOOTER = '🔔 Subscribe and turn on notifications so you never miss a conversation.';

const clip = z.object({
    text: z.string().describe('The exact words of the clip, copied from the transcript; it may stop mid-sentence'),
    speaker: z.string().describe('The speaker name exactly as it appears in the transcript'),
    startMs: ms,
    endMs: ms,
});

// What Claude returns. Every field is required: structured outputs are strict.
export const ShowNotesSchema = z.object({
    titles: z.array(z.string()).describe('Five YouTube title options, best first, under 70 characters, curiosity-led and specific, no clickbait or all caps.'),
    chosenTitle: z.number().int().describe('Index into titles of the one to use; 0 unless a person picks another'),
    description: z.string().describe(
        'YouTube description, 150-300 words, plain text. The first two lines (about 150 characters) show above "more": ' +
        'open with a hook that names the episode\'s big question and main keywords, then say who is in it. Short paragraphs, ' +
        'natural keywords (near-death experience, NDE, meaning of life...), and end with one question inviting comments. ' +
        'Do not add chapters, links, hashtags or a subscribe line: those are appended automatically.'),
    hashtags: z.array(z.string()).describe('Exactly three hashtags for the end of the description, e.g. "#NearDeathExperience"'),
    summary: z.string().describe('Two or three short paragraphs for the website episode page.'),
    chapters: z.array(z.object({
        startMs: ms,
        title: z.string().describe('Two to six words'),
    })).describe('YouTube chapters in order. The first starts at 0. Five to twelve, each at least a minute long.'),
    quotes: z.array(clip.extend({
        text: z.string().describe('Copied word for word from the transcript; a sentence up to a passage of two minutes (about 300 words)'),
    })).describe(
        'Up to twenty quotable moments for shorts and social posts, in episode order. Aim for twenty; ' +
        'fewer only if there are not that many good ones. Every guest gets at least one or two, including ' +
        'guests heard in recordings played during the episode. Each should stand on its own without context.'),
    teaserClips: z.array(clip).describe(
        'The "In this episode" cold open: three or four short clips from the episode played in order under an ' +
        '"In this episode" title, 20-40 seconds in total. Pick striking lines that make people want to watch; ' +
        'at least one should end on an unanswered question or cut off just before the answer (for example ' +
        '"I think the meaning of life is..."). Never give away the conclusion.'),
    tags: z.array(z.string()).describe('10-15 YouTube tags, lower case'),
    themes: z.array(z.string()).describe('Three to five broad themes, e.g. "purpose", "life review"'),
    topics: z.array(z.string()).describe('Specific people, books, studies, places and ideas discussed'),
    broll: z.array(z.object({
        startMs: ms,
        durationSeconds: z.number().int().describe('3 to 15'),
        idea: z.string().describe('What the image shows, concretely enough to generate it'),
        why: z.string().describe('What is being said at that moment that the image supports'),
        style: z.enum(BROLL_STYLE_IDS).describe(
            '"photo" (photorealistic) for everyday objects, people and places; "digital" (luminous digital painting) for ' +
            'spiritual, cosmic or otherworldly moments such as angels, heaven or light beyond death'),
    })).describe('Six still-image b-roll ideas (spec 005 section 3, option A). Angels, heaven and the afterlife may be shown in traditional ways where they fit; God is always a bright light, never a person such as an old man.'),
});

// What is stored and edited. Notes drafted before teaser clips and hashtags existed still load.
// An action item from a meeting: what to do, who does it, and when, as said in the transcript.
const actionItem = z.object({
    task: z.string().describe('What is to be done, as said in the meeting'),
    owner: z.string().describe('Who does it, the name as the transcript gives it; empty if nobody was named'),
    due: z.string().describe('When, as said (e.g. "Friday"); empty if no date was given'),
});
export type ActionItem = z.infer<typeof actionItem>;

// Builds the notes schema for the kind of recording and the description choices. When the
// format is 'podcast' with no extra descriptions, returns ShowNotesSchema itself, so Tom's
// request is unchanged; other formats replace the podcast's examples with neutral wording;
// meetings add decisions and action items; extra choices add descriptionOptions.
export function notesSchemaFor(s: StudioSettings) {
    if (s.format === 'podcast' && s.descriptionChoices <= 1) return ShowNotesSchema;
    let schema = ShowNotesSchema as z.ZodObject<z.ZodRawShape>;
    if (s.format !== 'podcast') {
        schema = schema.extend({
            description: z.string().describe(
                'YouTube description, 150-300 words, plain text. The first two lines (about 150 characters) show above "more": ' +
                'open with a hook that names the main subject and keywords, then say who is in it. Short paragraphs, ' +
                'natural keywords, and end with one question inviting comments. ' +
                'Do not add chapters, links, hashtags or a subscribe line: those are appended automatically.'),
            hashtags: z.array(z.string()).describe('Exactly three hashtags for the end of the description, e.g. "#Leadership"'),
            quotes: z.array(clip.extend({
                text: z.string().describe('Copied word for word from the transcript; a sentence up to a passage of two minutes (about 300 words)'),
            })).describe(
                'Up to twenty quotable moments for shorts and social posts, in order. ' +
                'Every speaker who says something worth keeping gets at least one. Each should stand on its own without context.'),
            teaserClips: z.array(clip).describe(
                'The "In this episode" cold open: three or four short clips from the recording played in order under an ' +
                '"In this episode" title, 20-40 seconds in total. Pick striking lines that make people want to watch; ' +
                'at least one should end on an unanswered question or cut off just before the answer (for example ' +
                '"The one thing we changed was..."). Never give away the conclusion.'),
            themes: z.array(z.string()).describe('Three to five broad themes'),
            broll: z.array(ShowNotesSchema.shape.broll.element.extend({ style: z.enum(BROLL_STYLE_IDS).describe(
                '"photo" (photorealistic) for most ideas; "digital" (luminous digital painting) for abstract ideas') })
            ).describe('Six still-image b-roll ideas that illustrate what is being said.'),
        });
    }
    if (s.descriptionChoices > 1) {
        schema = schema.extend({
            descriptionOptions: z.array(z.string()).describe(`${s.descriptionChoices - 1} more YouTube descriptions, ` +
                'each following the same rules as "description" but taking a clearly different angle or hook, so the ' +
                'producer can choose.'),
        });
    }
    if (s.format === 'meeting') {
        schema = schema.extend({
            decisions: z.array(z.string()).describe('Every decision made in the meeting, one short sentence each, in order'),
            actionItems: z.array(actionItem).describe('Every task someone agreed to do, with who and when as said'),
        });
    }
    return schema;
}

// What is stored and edited. Notes drafted before teaser clips and hashtags existed still load.
export const StoredShowNotesSchema = ShowNotesSchema.extend({
    // Quotes had no end time before they could be long; -1 means "work it out from the transcript".
    // New fields added by Part A: extra descriptions, meeting decisions and action items.
    descriptionOptions: z.array(z.string()).default([]),
    decisions: z.array(z.string()).default([]),
    actionItems: z.array(actionItem).default([]),
    quotes: z.array(clip.extend({ endMs: ms.default(-1) })),
    hashtags: z.array(z.string()).default([]),
    teaserClips: z.array(clip).default([]),
    // B-roll ideas drafted before styles existed are photoreal until someone picks.
    broll: z.array(ShowNotesSchema.shape.broll.element.extend({ style: z.enum(BROLL_STYLE_IDS).default('photo') })),
});

export type ShowNotes = z.infer<typeof StoredShowNotesSchema>;
export type TeaserClip = ShowNotes['teaserClips'][number];

// Swaps descriptionOptions[index] into description and the old description into its place.
export function chooseDescription(notes: ShowNotes, index: number): ShowNotes {
    const options = notes.descriptionOptions ?? [];
    if (index < 0 || index >= options.length) throw new Error(`No description option at index ${index}`);
    const old = notes.description;
    const next = [...options];
    next[index] = old;
    return { ...notes, description: options[index], descriptionOptions: next };
}

// What a redraft replaces: everything, only the description, or only the titles.
export type RedraftScope = 'all' | 'description' | 'titles';

// Merges a fresh draft into the current notes, replacing only the chosen part. 'description'
// takes the description and its options; 'titles' takes the titles and resets chosenTitle; 'all'
// takes everything.
export function mergeRedraft(current: ShowNotes, fresh: ShowNotes, only: RedraftScope): ShowNotes {
    if (only === 'all') return fresh;
    if (only === 'description') return { ...current, description: fresh.description, descriptionOptions: fresh.descriptionOptions ?? [] };
    return { ...current, titles: fresh.titles, chosenTitle: 0 };
}

// Turns a redraft request into the direction line appended to the prompt. Empty when there
// is no request or the instruction is blank; otherwise names the part to focus on.
export function redraftDirection(r: { instruction: string; only: RedraftScope } | null | undefined): string {
    if (!r || !r.instruction.trim()) return '';
    const lines = [`The producer asked for a new draft with this direction:\n${r.instruction.trim()}`];
    if (r.only === 'description') lines.push('This draft is for the YouTube description: put the most care there.');
    if (r.only === 'titles') lines.push('This draft is for the titles: put the most care there.');
    return lines.join('\n');
}

export function parseShowNotes(input: unknown): ShowNotes {
    const notes = StoredShowNotesSchema.parse(input);
    const long = (s: string, max: number, what: string) => {
        if (s.length > max) throw new Error(`${what} is too long`);
    };
    long(notes.description, 5000, 'Description');
    long(notes.summary, 5000, 'Summary');
    for (const [list, max, what] of [
        [notes.titles, 10, 'titles'], [notes.chapters, 40, 'chapters'], [notes.quotes, 40, 'quotes'],
        [notes.tags, 40, 'tags'], [notes.themes, 20, 'themes'], [notes.topics, 60, 'topics'], [notes.broll, 30, 'b-roll ideas'], [notes.teaserClips, 10, 'teaser clips'], [notes.hashtags, 15, 'hashtags'],
    ] as const) {
        if (list.length > max) throw new Error(`Too many ${what}`);
    }
    const clean = (list: string[]) => list.map(t => t.trim()).filter(Boolean);
    notes.tags = clean(notes.tags);
    notes.themes = clean(notes.themes);
    notes.topics = clean(notes.topics);
    if (notes.chosenTitle < 0 || notes.chosenTitle >= notes.titles.length) notes.chosenTitle = 0;
    // Bounds live here rather than in the schema: structured outputs support few keywords.
    for (const t of [...notes.chapters, ...notes.quotes, ...notes.broll, ...notes.teaserClips]) t.startMs = Math.max(0, t.startMs);
    for (const c of [...notes.teaserClips, ...notes.quotes]) c.endMs = Math.max(c.startMs, c.endMs);
    notes.hashtags = clean(notes.hashtags).map(h => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, ''));
    for (const b of notes.broll) b.durationSeconds = Math.min(15, Math.max(3, b.durationSeconds));
    return notes;
}

// One spoken word of the accepted transcript, with who said it.
export interface SpokenWord { text: string; start: number; end: number; speaker: string; clip: boolean }

const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, '');
const tokens = (s: string) => s.replace(/(\.\.\.|…)\s*$/, '').split(/\s+/).map(token).filter(Boolean);

type Found = { startMs: number; endMs: number; speaker: string };

function find(want: string[], spoken: SpokenWord[], have: string[], nearMs: number) {
    let best: { i: number; found: Found } | null = null;
    for (let i = 0; i + want.length <= have.length; i++) {
        if (want.every((t, k) => have[i + k] === t)) {
            const found = { startMs: spoken[i].start, endMs: spoken[i + want.length - 1].end, speaker: spoken[i].speaker };
            if (!best || Math.abs(found.startMs - nearMs) < Math.abs(best.found.startMs - nearMs)) best = { i, found };
        }
    }
    return best;
}

const EDGE = 6;               // words matched at each end of a long passage
const LONGEST_MS = 3 * 60_000;

// Finds `text` word for word in the transcript and returns its exact times and speaker, or
// null if it was not said. A long passage that differs somewhere in the middle (a word
// Claude tidied up) is still found by its first and last words, and `text` is then the
// transcript's own wording.
export function locate(text: string, words: SpokenWord[], nearMs = 0): (Found & { text?: string }) | null {
    const want = tokens(text);
    if (!want.length) return null;
    const have = words.map(w => token(w.text));
    const exact = find(want, words, have, nearMs);
    if (exact) return exact.found;
    if (want.length < EDGE * 3) return null;
    const head = find(want.slice(0, EDGE), words, have, nearMs);
    if (!head) return null;
    const rest = words.slice(head.i);
    const tail = find(want.slice(-EDGE), rest, have.slice(head.i), head.found.startMs);
    if (!tail) return null;
    const last = head.i + tail.i + EDGE - 1;
    const span = words.slice(head.i, last + 1);
    if (span[span.length - 1].end - span[0].start > LONGEST_MS) return null;
    return { ...head.found, endMs: span[span.length - 1].end, text: span.map(w => w.text).join(' ') };
}

// Puts quotes and teaser clips on the exact words and speaker from the transcript. Returns
// the texts that could not be found word for word, for the page to flag.
export function anchorToTranscript(notes: ShowNotes, words: SpokenWord[]) {
    const unverified: string[] = [];
    for (const item of [...notes.quotes, ...notes.teaserClips]) {
        const found = locate(item.text, words, item.startMs);
        if (!found) {
            unverified.push(item.text);
            item.endMs = Math.max(item.startMs, item.endMs);
            continue;
        }
        item.startMs = found.startMs;
        item.endMs = found.endMs;
        item.speaker = found.speaker;
        if (found.text) item.text = found.text;
    }
    return unverified;
}

// Quotes saved before they had end times get one from the transcript.
export function fillMissingEnds(notes: ShowNotes, words: SpokenWord[]) {
    for (const q of notes.quotes) {
        if (q.endMs > q.startMs) continue;
        const found = locate(q.text, words, q.startMs);
        q.endMs = found ? found.endMs : q.startMs;
    }
    return notes;
}

export function mmss(ms: number) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// "0:00 Intro" lines as YouTube expects them in the description.
export function chapterList(notes: ShowNotes) {
    return notes.chapters.map(c => `${mmss(c.startMs)} ${c.title}`).join('\n');
}

// The whole description as pasted into YouTube. The site link sits straight after the text,
// as high as it can go, and is always there whatever the text says. `links` comes from the
// Studio settings (lib/studioSettings.ts); without it, the Soul Wisdom Collective lines.
export function youtubeDescription(notes: ShowNotes, links?: DescriptionLinks) {
    const siteLine = links ? (links.siteUrl ? `${links.siteLinkText} ${links.siteUrl}`.trim() : '')
        : `🌐 Full episodes, transcripts and the Soul Wisdom community: ${SITE_URL}`;
    return [
        notes.description.trim(),
        siteLine,
        notes.chapters.length ? `Chapters\n${chapterList(notes)}` : '',
        links ? links.subscribeLine : DESCRIPTION_FOOTER,
        notes.hashtags.join(' '),
    ].filter(Boolean).join('\n\n');
}

// The notes as saving would store them, so a tidy-up (a trimmed tag, a default filled in) does
// not count as a change. Notes that would not save stay as they are and so compare as changed.
function canonical(notes: ShowNotes): string {
    try {
        return JSON.stringify(parseShowNotes(structuredClone(notes)));
    } catch {
        return JSON.stringify(notes);
    }
}

// Whether two versions of the notes say the same thing: an edit typed and then undone is no change.
export function sameNotes(a: ShowNotes, b: ShowNotes) {
    return canonical(a) === canonical(b);
}

// What changed from one version of the notes to another, one entry per part, for the producer to
// decide whether a later step needs making again.
export function notesChanges(before: ShowNotes, after: ShowNotes): { part: string; detail: string }[] {
    const [b, a] = [before, after].map(n => JSON.parse(canonical(n)) as ShowNotes);
    const changes: { part: string; detail: string }[] = [];
    const title = (n: ShowNotes) => n.titles[n.chosenTitle] ?? '';
    if (title(b) !== title(a)) changes.push({ part: 'Title', detail: `“${title(b)}” → “${title(a)}”` });
    else if (JSON.stringify(b.titles) !== JSON.stringify(a.titles)) changes.push({ part: 'Other title options', detail: 'edited' });
    const parts: [keyof ShowNotes, string][] = [
        ['teaserClips', '“In this episode” clips'], ['description', 'Description'], ['hashtags', 'Hashtags'], ['summary', 'Summary'],
        ['chapters', 'Chapters'], ['quotes', 'Key quotes'], ['broll', 'B-roll ideas'], ['tags', 'Tags'], ['themes', 'Themes'], ['topics', 'Topics'],
    ];
    for (const [key, part] of parts) {
        const [x, y] = [b[key], a[key]];
        if (JSON.stringify(x) === JSON.stringify(y)) continue;
        if (!Array.isArray(x) || !Array.isArray(y)) {
            changes.push({ part, detail: 'edited' });
        } else if (x.length !== y.length) {
            changes.push({ part, detail: `${x.length} → ${y.length}` });
        } else {
            const edited = x.filter((item, i) => JSON.stringify(item) !== JSON.stringify(y[i])).length;
            changes.push({ part, detail: `${edited} edited` });
        }
    }
    return changes;
}
