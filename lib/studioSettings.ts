// Studio settings: every choice that was fixed to the Soul Wisdom Collective podcast, as an
// option kept in Firestore (settings/studio). With no settings saved, every value is the one
// the Studio always used, so Tom's flow is unchanged; another user sets their own show name,
// branding, speakers, kind of recording and writing, intro, and where the finished video
// comes from. Shared by the Studio pages, the server routes and the GitHub Actions jobs.

import { z } from 'zod';
import { DEFAULT_MUSIC_PROMPT, MUSIC_MODES } from './aiMedia';

export const SETTINGS_DOC = { collection: 'settings', id: 'studio' } as const;

// The kind of recording, which shapes how Claude writes the notes, Shorts and thumbnails.
export const FORMATS = ['podcast', 'meeting', 'talk', 'other'] as const;
export type VideoFormat = typeof FORMATS[number];

export const FORMAT_LABELS: Record<VideoFormat, string> = {
    podcast: 'Interview podcast',
    meeting: 'Recorded meeting',
    talk: 'Talk or presentation',
    other: 'Something else (describe it in the extra instructions)',
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #140a2e');
const url = z.string().trim().max(200).refine(s => s === '' || /^https?:\/\/\S+$/.test(s), 'Use a full web address starting with https://');

export const StudioSettingsSchema = z.object({
    showName: z.string().trim().min(1, 'Give the show or channel a name').max(80),
    about: z.string().trim().max(300),            // finishes "The show …"
    audience: z.string().trim().max(200),         // finishes "… for …"
    hosts: z.array(z.string().trim().min(1).max(60)).max(10),
    format: z.enum(FORMATS),
    extraInstructions: z.string().trim().max(3000),
    descriptionChoices: z.number().int().min(1).max(5),  // YouTube descriptions Claude writes to choose from
    studioUrl: url,                               // where this Studio runs, for links in emails
    siteUrl: url,                                 // the website named in descriptions; empty leaves it out
    siteLinkText: z.string().trim().max(120),
    subscribeLine: z.string().trim().max(200),
    colors: z.object({ background: hex, backgroundBottom: hex, accent: hex }),
    logoPath: z.string().max(300).nullable(),     // Cloud Storage; null uses the site's logo
    imageStyle: z.string().trim().max(1500),      // AI image look; empty keeps the built-in Soul Wisdom styles
    brollVideo: z.boolean(),                      // also make each b-roll moment as an AI video clip (OpenAI Sora)
    music: z.enum(MUSIC_MODES),                   // background music: none, an uploaded track, or composed by ElevenLabs
    musicPath: z.string().max(300).nullable(),    // Cloud Storage, when music is 'upload'
    musicPrompt: z.string().trim().max(500),      // what ElevenLabs composes, when music is 'generate'
    musicVolumeDb: z.number().int().min(-40).max(-6),   // how far under the voice the music sits
    intro: z.enum(['show', 'custom', 'none']),    // the show's intro (also the outro), your own, or none
    introPath: z.string().max(300).nullable(),    // Cloud Storage, when intro is 'custom'
    teasers: z.boolean(),                         // "In this episode" clips before the intro
    finalSource: z.enum(['descript', 'editorLight']),
    useDrive: z.boolean(),                        // recordings also come in through Google Drive
    githubRepo: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/repository'),
});

export type StudioSettings = z.infer<typeof StudioSettingsSchema>;

// What the Studio always did: the Soul Wisdom Collective podcast.
export const DEFAULT_SETTINGS: StudioSettings = {
    showName: 'Soul Wisdom Collective',
    about: 'explores near-death experiences, consciousness and the meaning of life with warmth and curiosity',
    audience: 'listeners who are spiritually open but not dogmatic',
    hosts: ['Daniel Endy', 'Tom Wood'],
    format: 'podcast',
    extraInstructions: '',
    descriptionChoices: 1,
    studioUrl: 'https://soulwisdomcollective.com',
    siteUrl: 'https://soulwisdomcollective.com',
    siteLinkText: '🌐 Full episodes, transcripts and the Soul Wisdom community:',
    subscribeLine: '🔔 Subscribe and turn on notifications so you never miss a conversation.',
    colors: { background: '#140a2e', backgroundBottom: '#2a1552', accent: '#f7c65b' },
    logoPath: null,
    imageStyle: '',
    brollVideo: false,
    music: 'none',
    musicPath: null,
    musicPrompt: DEFAULT_MUSIC_PROMPT,
    musicVolumeDb: -24,
    intro: 'show',
    introPath: null,
    teasers: true,
    finalSource: 'descript',
    useDrive: true,
    githubRepo: 'masterytv/soulwisdomnetwork',
};

// Whatever is saved, filled out with the defaults; anything that no longer fits is ignored, so
// a bad saved value can never stop a job.
export function withDefaults(saved: unknown): StudioSettings {
    const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
    const merged = {
        ...DEFAULT_SETTINGS, ...s,
        colors: { ...DEFAULT_SETTINGS.colors, ...((s.colors && typeof s.colors === 'object') ? s.colors : {}) },
    };
    const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof StudioSettings)[]) {
        const field = StudioSettingsSchema.shape[key].safeParse(merged[key]);
        if (field.success) out[key] = field.data;
        else if (key === 'colors') {
            const c = merged.colors as Record<string, unknown>;
            out.colors = Object.fromEntries((['background', 'backgroundBottom', 'accent'] as const).map(k =>
                [k, hex.safeParse(c[k]).success ? c[k] : DEFAULT_SETTINGS.colors[k]]));
        }
    }
    return out as StudioSettings;
}

// ─── Words that change with the kind of recording ───────────────────────────

function words(s: StudioSettings) {
    return {
        podcast: { noun: 'podcast', subject: 'show', episode: 'episode', speaker: 'guest' },
        meeting: { noun: 'meeting', subject: 'meeting', episode: 'meeting', speaker: 'speaker' },
        talk: { noun: 'talk', subject: 'talk', episode: 'talk', speaker: 'speaker' },
        other: { noun: 'video', subject: 'video', episode: 'video', speaker: 'speaker' },
    }[s.format];
}

const extra = (s: StudioSettings) =>
    s.extraInstructions ? `\n\nAlso follow these instructions from the producer:\n${s.extraInstructions}` : '';

function list(items: string[]) {
    return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const FORMAT_GUIDE: Partial<Record<VideoFormat, string>> = {
    meeting: 'This is a recorded meeting, not a show. Chapters follow the topics and agenda items as they come up. ' +
        'The description summarises what was discussed, decided and agreed, for people who were not there. ' +
        'Quotes and teaser clips favour clear decisions, insights and explanations that make sense on their own.',
    talk: 'This is a talk or presentation. Chapters follow its sections. The description says what viewers will learn. ' +
        'Quotes and teaser clips favour the clearest, most memorable lines.',
};

// The show notes request's instructions (agent/src/podcast/notesDraft.ts). With the default
// settings this is word for word the prompt the Studio always sent (lib/studioSettings.test.ts).
export function notesSystemPrompt(s: StudioSettings): string {
    const w = words(s);
    const hosted = s.hosts.length ? `, hosted by ${s.hosts.join(' and ')}` : '';
    const about = s.about ? ` The ${w.subject} ${s.about}${s.audience ? `, for ${s.audience}` : ''}.` : '';
    const someone = s.hosts[0]?.split(' ')[0] ?? 'The speaker';
    const people = s.format === 'podcast'
        ? 'Lines marked "(clip played during the episode)" are recordings of guests played during the ' +
          'show; they are part of the story, so quote them and use them in the teaser like anyone else. Every guest, ' +
          'whether in the room or in a recording, should have at least one or two quotes.'
        : 'Every speaker who says something worth keeping should have at least one quote.';
    const added = list([
        ...(s.siteUrl ? [`the site link (${s.siteUrl})`] : []), 'chapters', ...(s.subscribeLine ? ['subscribe line'] : []), 'hashtags',
    ]);
    return [
        `You write show notes for the ${s.showName} ${w.noun}${hosted}.${about}`,
        ...(FORMAT_GUIDE[s.format] ? [FORMAT_GUIDE[s.format]] : []),
        'Write in plain, warm, specific language. Avoid hype, clickbait and clichés ("delve", "journey", "unlock"). ' +
            `Never claim as fact what a speaker offered as belief or experience; attribute it ("${someone} describes…").`,
        'Timestamps: every paragraph of the transcript starts with its time in milliseconds, e.g. [65000ms 1:05]. ' +
            'Use those numbers for startMs. Chapters and b-roll must start at a paragraph\'s time; quotes at the paragraph they come from.',
        'Quotes and teaser clips must be copied exactly from the transcript, with the speaker name exactly as the ' +
            `transcript gives it. ${people}`,
        'Quotes are raw material for shorts: give up to twenty, from a single striking sentence to a passage of up to two ' +
            'minutes that stands on its own. Producers find it easier to delete than to add, so err towards more.',
        'The YouTube description is written to be found and clicked: front-load the hook and keywords in the first two lines, ' +
            `because only those show before "more". ${added.charAt(0).toUpperCase()}${added.slice(1)} are added ` +
            'automatically, so do not write them yourself.',
    ].join('\n\n') + extra(s);
}

// The Shorts headline and title request (agent/src/podcast/shorts.ts).
export function shortsSystemPrompt(s: StudioSettings): string {
    const w = words(s);
    return `You pick moments from the ${s.showName} ${w.noun} for YouTube Shorts.` +
        (s.about ? ` The ${w.noun} ${s.about}.` : '') +
        ' A good Short grabs attention in its first two seconds, makes sense to someone who has never seen the ' +
        `${w.episode}, and ends on a complete thought or a line that lands. ` +
        `Never state as fact what a ${w.speaker} offered as belief or experience.` + extra(s);
}

// The thumbnail text request (agent/src/podcast/thumbnails.ts).
export function thumbnailsSystemPrompt(s: StudioSettings): string {
    const w = words(s);
    return `You write the text for YouTube thumbnails for the ${s.showName} ${w.noun}` +
        (s.about ? `, which ${s.about}` : '') +
        '. The text is a few large words on the image, read in a second on a phone. ' +
        `Never state as fact what a ${w.speaker} offered as belief or experience.` + extra(s);
}

// ─── Branding ───────────────────────────────────────────────────────────────

function rgb(color: string): [number, number, number] {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ASS subtitle colours are &HBBGGRR&.
export function assColor(color: string): string {
    const [r, g, b] = rgb(color);
    return `&H${[b, g, r].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}&`;
}

// ffmpeg geq expressions for a top-to-bottom gradient between the two background colours.
export function gradientExpr(top: string, bottom: string): string {
    const a = rgb(top), b = rgb(bottom);
    const part = (i: number) => {
        const d = b[i] - a[i];
        return `${a[i]}${d >= 0 ? '+' : '-'}${Math.abs(d)}*Y/H`;
    };
    return `r='${part(0)}':g='${part(1)}':b='${part(2)}'`;
}

// A colour part way to white, for glows on a custom background.
export function lighten(color: string, amount: number): string {
    return '#' + rgb(color).map(v => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0')).join('');
}

// The YouTube description's link and subscribe lines (lib/showNotes.ts youtubeDescription).
export type DescriptionLinks = Pick<StudioSettings, 'siteUrl' | 'siteLinkText' | 'subscribeLine'>;
