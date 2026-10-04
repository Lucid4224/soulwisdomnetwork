// B-roll stills (spec 005 step 7; docs/specs/008-broll-images.md): the brand look, how an
// approved idea becomes an image prompt, and what an image costs. Shared by the job, the
// show notes schema and the Studio.

export const BROLL_MODEL = 'gpt-image-2';
export const BROLL_SIZE = '1536x1024';     // 3:2, leaves room to pan and crop to 16:9
export const BROLL_QUALITY = 'high';
// OpenAI's published price for one 1536x1024 image at this quality; for the cost record.
export const BROLL_USD_PER_IMAGE = 0.165;

// The brand look (chosen 24 Sept 2026 from test rounds): one bright palette, two styles.
// Photoreal for everyday objects and places, Digital for spiritual and otherworldly moments.
export const BROLL_STYLE_IDS = ['photo', 'digital'] as const;
export type BrollStyle = (typeof BROLL_STYLE_IDS)[number];

export const BROLL_STYLES: Record<BrollStyle, { label: string; prompt: string }> = {
    photo: {
        label: 'Photoreal',
        prompt: 'Soul Wisdom Collective brand style, PHOTOREAL: a bright, luminous, photorealistic cinematic still, as if shot on a ' +
            'full-frame camera with a 35mm lens at golden hour. Real materials and textures, natural-looking physics of light: glowing ' +
            'haze and atmosphere, volumetric light rays, lens bloom and soft bokeh sparkles, gentle colour grading toward blue, violet and ' +
            'pink with warm gold highlights. Airy, hopeful and awe-filled; even otherworldly subjects look as if they were really photographed.',
    },
    digital: {
        label: 'Digital',
        prompt: 'Soul Wisdom Collective brand style, DIGITAL: a vivid, luminous digital painting with a cinematic glow, like high-end ' +
            'spiritual concept art. Light radiates from within the scene: soft bloom, glowing auras, drifting sparkles and bokeh, cosmic ' +
            'nebula colour, and fine gold lines of sacred geometry where they fit. Rich saturated colour, crisp detail, hopeful and transcendent.',
    },
};

export const PALETTE = 'Palette: bright and luminous, never murky. Radiant sky blue, cyan and cobalt, soft lavender and violet, rose pink and ' +
    'magenta blushes, with warm golden light at the heart of the scene. Glowing mid-tones and light-filled air; shadows are deep blue ' +
    'or violet, never black, and cover little of the frame.';

// What any brand image may and may not show; the thumbnails (lib/thumbnail.ts) use it too.
export const IMAGE_RULES = 'No text, letters, captions, logos or watermarks. People may appear, but not the likeness of any specific real person. ' +
    'Angels, heaven and the afterlife may be shown in traditional, reverent ways. Never show God as a person (for example an old man ' +
    'with a beard): God is always a bright, radiant light. Anything described as an AI looks like an AI, a luminous form of light, ' +
    'circuitry and sacred geometry, not a human figure.';

const RULES = `${IMAGE_RULES} Landscape composition with the subject away from the edges, suitable for a slow pan and zoom.`;

// `customStyle` is the Studio settings' image style (lib/studioSettings.ts); when it is set it
// takes the place of the built-in brand style and palette.
export function brollPrompt(idea: string, style: BrollStyle, customStyle = '') {
    const look = customStyle.trim() || `${BROLL_STYLES[style].prompt} ${PALETTE}`;
    return `${look}\n\nSubject: ${idea.trim()}.\n\n${RULES}`;
}
