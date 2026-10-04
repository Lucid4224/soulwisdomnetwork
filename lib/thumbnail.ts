// Thumbnails (spec 005 step 12; docs/specs/011-thumbnails.md): the three kinds, what Claude is
// asked for, and the AI background's prompt. Shared by the job, the server and the Studio; the
// drawing itself is in components/studio/thumbnailCanvas.ts, so it runs in the browser.

import { z } from 'zod';
import { BROLL_STYLE_IDS, BROLL_STYLES, IMAGE_RULES, PALETTE, type BrollStyle } from './broll';

// YouTube's recommended size; the upload limit is 2 MB.
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

export const THUMB_KINDS = ['frame', 'ai', 'template'] as const;
export type ThumbKind = (typeof THUMB_KINDS)[number];
export const THUMB_LABELS: Record<ThumbKind, string> = {
    frame: 'Frame from the episode',
    ai: 'AI image',
    template: 'Brand template',
};

// Up to this many frames are offered to pick from, taken at the strongest quotes.
export const FRAME_CANDIDATES = 8;
export const HOOK_MAX_CHARS = 40;

// Words wrapped in *asterisks* are drawn in gold.
export const HooksSchema = z.object({
    hooks: z.array(z.string()).describe(
        `Five short thumbnail texts, best first: 2 to 5 words and at most ${HOOK_MAX_CHARS} characters each, in title case. ` +
        'They sit on the image beside the YouTube title, so add to it rather than repeat it: the emotional hook or the big ' +
        'question, specific to this episode. No clickbait, no all caps, no emoji. Wrap the one or two most striking words in ' +
        '*asterisks* to show them in gold.'),
    image: z.object({
        idea: z.string().describe('One bold, simple image for the thumbnail background, concretely enough to generate it: a single ' +
            'clear subject that reads at a glance even when small. No text in the image.'),
        style: z.enum(BROLL_STYLE_IDS).describe('"photo" for everyday people, objects and places; "digital" for spiritual, cosmic and otherworldly subjects'),
    }),
});
export type Hooks = z.infer<typeof HooksSchema>;

// `customStyle`: the Studio settings' image style, in place of the built-in brand style when set.
export function thumbnailImagePrompt(idea: string, style: BrollStyle, customStyle = '') {
    const look = customStyle.trim() || `${BROLL_STYLES[style].prompt} ${PALETTE}`;
    return `${look}\n\nSubject: ${idea.trim()}.\n\n` +
        'This is the background of a YouTube thumbnail: one bold, simple subject with a clear focal point and strong contrast, ' +
        'so it reads at a glance even when small. Place the subject in the right half of the frame and keep the left third calm, ' +
        `darker and uncluttered, because the title goes there. ${IMAGE_RULES}`;
}

// "She *Saw* Her Whole Life" -> words, each marked when it is in gold.
export function hookWords(text: string) {
    const words: { text: string; gold: boolean }[] = [];
    let gold = false;
    for (const raw of text.trim().split(/\s+/)) {
        if (!raw) continue;
        const opens = raw.startsWith('*');
        const closes = raw.endsWith('*') && (raw.length > 1 || !opens);
        const word = raw.replace(/\*/g, '');
        if (opens) gold = true;
        if (word) words.push({ text: word, gold });
        if (closes) gold = false;
    }
    return words;
}
