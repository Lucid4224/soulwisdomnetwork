// Part I: what Editor Light burns onto the picture. Captions in a chosen font, size, colour,
// background and position; text overlays such as a speaker's name title; and image overlays such
// as a logo. The editor stores them on the edit, the edit route checks them, and the renderer
// turns them into one ASS subtitle file plus ffmpeg overlay filters, all on the edited timeline.

import { z } from 'zod';
import type { Cue } from './captions';
import { editedTime, type KeptRange } from './edit';

// The render's frame; every size and margin below is in its pixels.
export const FRAME = { width: 1920, height: 1080 } as const;

// Fonts the render has: the Outfit pair ships in agent/assets/fonts, the rest are installed on the
// render runner (.github/workflows/podcast_edit_render.yml). `bold` asks the font for its bold weight.
export const FONTS = [
    { name: 'Outfit SemiBold', label: 'Outfit (the Shorts font)', bold: false, css: '"Outfit", system-ui, sans-serif' },
    { name: 'Outfit Black', label: 'Outfit Black (heavy)', bold: false, css: '"Outfit", system-ui, sans-serif' },
    { name: 'Open Sans', label: 'Open Sans', bold: true, css: '"Open Sans", system-ui, sans-serif' },
    { name: 'Roboto', label: 'Roboto', bold: true, css: 'Roboto, system-ui, sans-serif' },
    { name: 'Lato', label: 'Lato', bold: true, css: 'Lato, system-ui, sans-serif' },
    { name: 'EB Garamond', label: 'EB Garamond (classic serif)', bold: false, css: '"EB Garamond", Georgia, serif' },
    { name: 'DejaVu Serif', label: 'DejaVu Serif', bold: false, css: '"DejaVu Serif", Georgia, serif' },
] as const;
export type FontName = typeof FONTS[number]['name'];
export const FONT_NAMES = FONTS.map(f => f.name) as [FontName, ...FontName[]];

// Text heights in pixels on the 1080p frame.
export const TEXT_SIZES = { small: 44, medium: 60, large: 80, huge: 110 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const SIZE_NAMES = Object.keys(TEXT_SIZES) as [TextSize, ...TextSize[]];

// outline: a dark edge round each letter; box: a dark band behind the text; shadow: a soft drop shadow only.
export const BACKGROUNDS = ['outline', 'box', 'shadow'] as const;
export type Background = typeof BACKGROUNDS[number];

export const POSITIONS = ['top-left', 'top', 'top-right', 'middle-left', 'middle', 'middle-right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type Position = typeof POSITIONS[number];
export const CAPTION_POSITIONS = ['bottom', 'middle', 'top'] as const;

export const POSITION_LABELS: Record<Position, string> = {
    'top-left': 'Top left', top: 'Top', 'top-right': 'Top right',
    'middle-left': 'Middle left', middle: 'Middle', 'middle-right': 'Middle right',
    'bottom-left': 'Bottom left', bottom: 'Bottom', 'bottom-right': 'Bottom right',
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #ffffff');

export const CaptionStyleSchema = z.object({
    font: z.enum(FONT_NAMES),
    size: z.enum(SIZE_NAMES),
    color: hex,
    background: z.enum(BACKGROUNDS),
    position: z.enum(CAPTION_POSITIONS),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { font: 'Outfit SemiBold', size: 'medium', color: '#ffffff', background: 'outline', position: 'bottom' };

// The captions on one video: on or off, in a look of its own (the edit), or the Studio's (the settings).
export const CaptionChoiceSchema = z.object({ on: z.boolean(), style: CaptionStyleSchema });
export type CaptionChoice = z.infer<typeof CaptionChoiceSchema>;

const id = z.string().regex(/^[\w-]{1,40}$/);
const atMs = z.number().int().min(0).max(24 * 3600_000);      // where it starts, in the original recording
const seconds = z.number().min(0.5).max(24 * 3600);           // how long it stays up, in the edited video

export const TextOverlaySchema = z.object({
    id, type: z.literal('text'), atMs, seconds,
    text: z.string().trim().min(1, 'Type the text').max(200),
    subtext: z.string().trim().max(200),                         // a smaller second line, such as a role
    font: z.enum(FONT_NAMES),
    size: z.enum(SIZE_NAMES),
    color: hex,
    background: z.enum(BACKGROUNDS),
    position: z.enum(POSITIONS),
});
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

export const ImageOverlaySchema = z.object({
    id, type: z.literal('image'), atMs, seconds,
    path: z.string().regex(/^overlays\/[\w.\- ]+$/).max(300),  // Cloud Storage, from the upload route
    name: z.string().trim().max(150),                            // the file's name, to show in the editor
    position: z.enum(POSITIONS),
    widthPct: z.number().int().min(5).max(100),                  // share of the frame's width
});
export type ImageOverlay = z.infer<typeof ImageOverlaySchema>;

export const OverlaySchema = z.discriminatedUnion('type', [TextOverlaySchema, ImageOverlaySchema]);
export type Overlay = z.infer<typeof OverlaySchema>;
export const OVERLAYS_MAX = 100;
export const OverlaysSchema = z.array(OverlaySchema).max(OVERLAYS_MAX);

// Checks the on-screen parts of an edit before it is saved; returns the first problem, or null.
export function onScreenProblem(edit: { overlays?: unknown; captions?: unknown }): string | null {
    if (edit.overlays !== undefined) {
        const r = OverlaysSchema.safeParse(edit.overlays);
        if (!r.success) return `On-screen items: ${r.error.issues[0]?.message ?? 'not valid'}`;
    }
    if (edit.captions !== undefined && edit.captions !== null) {
        const r = CaptionChoiceSchema.safeParse(edit.captions);
        if (!r.success) return `Captions: ${r.error.issues[0]?.message ?? 'not valid'}`;
    }
    return null;
}

// The captions this render burns in: the edit's own choice when it has one, otherwise the Studio's; null for none.
export function captionLook(edit: { captions?: CaptionChoice | null }, settings: { burnCaptions: boolean; captionStyle: CaptionStyle }): CaptionStyle | null {
    const choice = edit.captions ?? { on: settings.burnCaptions, style: settings.captionStyle };
    return choice.on ? choice.style : null;
}

// A new text overlay with the Studio's caption look, `seconds` long from `atMs`.
export function newText(overlayId: string, atMs: number, look: CaptionStyle = DEFAULT_CAPTION_STYLE, seconds = 5): TextOverlay {
    return {
        id: overlayId, type: 'text', atMs: Math.max(0, Math.round(atMs)), seconds, text: 'Your text', subtext: '',
        font: look.font, size: 'large', color: look.color, background: 'box', position: 'middle',
    };
}

// A name title for each speaker where they first speak: name in the lower left on a dark band, five seconds.
// Speakers that already have a title (same text) are left out, so pressing it twice adds nothing.
export function nameTitles(words: { speaker: string; start: number }[], existing: Overlay[], look: CaptionStyle = DEFAULT_CAPTION_STYLE): TextOverlay[] {
    const have = new Set(existing.filter((o): o is TextOverlay => o.type === 'text').map(o => o.text));
    const first = new Map<string, number>();
    for (const w of words) if (w.speaker && !first.has(w.speaker)) first.set(w.speaker, w.start);
    return [...first].filter(([speaker]) => !have.has(speaker)).map(([speaker, start], i) => ({
        id: `title-${Math.round(start)}-${i}`, type: 'text', atMs: Math.max(0, Math.round(start)), seconds: 5,
        text: speaker, subtext: '', font: look.font, size: 'medium', color: '#ffffff', background: 'box', position: 'bottom-left',
    }));
}

export interface Placed<T> { overlay: T; startMs: number; endMs: number }

// Moves overlays onto the edited timeline: each starts where its moment lands (the next kept moment
// when it was cut) and stays `seconds`, ending with the video at the latest. Ones that start after the end are left out.
export function placeOverlays<T extends { atMs: number; seconds: number }>(overlays: T[], ranges: KeptRange[], editedMs: number): Placed<T>[] {
    const out: Placed<T>[] = [];
    for (const overlay of overlays) {
        const startMs = editedTime(overlay.atMs, ranges, true);
        if (startMs === null || startMs >= editedMs) continue;
        out.push({ overlay, startMs, endMs: Math.min(editedMs, startMs + Math.round(overlay.seconds * 1000)) });
    }
    return out;
}

// ─── ASS subtitles (captions and text overlays) ─────────────────────────────

// An ASS colour, &HAABBGGRR, where alpha 0 is solid and 255 is clear.
export function assRgba(color: string, alpha = 0): string {
    const n = parseInt(color.slice(1), 16);
    const parts = [alpha, n & 255, (n >> 8) & 255, (n >> 16) & 255];
    return '&H' + parts.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// An ASS time, H:MM:SS.cc.
export function assTime(ms: number): string {
    const cs = Math.max(0, Math.round(ms / 10));
    const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// ASS alignment numbers (numpad layout: 1 bottom left … 9 top right).
const ALIGN: Record<Position, number> = {
    'bottom-left': 1, bottom: 2, 'bottom-right': 3, 'middle-left': 4, middle: 5, 'middle-right': 6, 'top-left': 7, top: 8, 'top-right': 9,
};

// Text made safe for an ASS line: braces would start style codes and a backslash an escape.
export function assText(text: string): string {
    return text.replace(/\\/g, '/').replace(/[{}]/g, m => (m === '{' ? '(' : ')')).replace(/\r?\n/g, '\\N');
}

// One ASS style line for a look: font, height, colour, the background, and where it sits.
function styleLine(name: string, look: { font: FontName; size: TextSize; color: string; background: Background }, position: Position, marginV: number): string {
    const size = TEXT_SIZES[look.size];
    const bold = FONTS.find(f => f.name === look.font)?.bold ? -1 : 0;
    const box = look.background === 'box';
    const outline = box ? Math.round(size * 0.15) : look.background === 'outline' ? Math.max(2, Math.round(size * 0.07)) : 0;
    const shadow = look.background === 'shadow' ? Math.max(2, Math.round(size * 0.06)) : 0;
    // A box is drawn in the outline colour, a little see-through; an outline is solid black.
    const outlineColour = box ? assRgba('#000000', 0x50) : assRgba('#000000');
    return `Style: ${name},${look.font},${size},${assRgba(look.color)},${assRgba(look.color)},${outlineColour},${assRgba('#000000', 0x60)},` +
        `${bold},0,0,0,100,100,0,0,${box ? 3 : 1},${outline},${shadow},${ALIGN[position]},90,90,${marginV},1`;
}

// The whole ASS file: captions (when a look is given) and every placed text overlay, timed on the
// edited video. Null when there is nothing to show.
export function buildAss(cues: Cue[], captions: CaptionStyle | null, texts: Placed<TextOverlay>[]): string | null {
    const showCaptions = !!captions && cues.length > 0;
    if (!showCaptions && texts.length === 0) return null;
    const styles: string[] = [];
    const events: string[] = [];
    if (showCaptions) {
        styles.push(styleLine('Captions', captions, captions.position, 70));
        for (const c of cues) events.push(`Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Captions,,0,0,0,,${c.lines.map(assText).join('\\N')}`);
    }
    texts.forEach((t, i) => {
        const o = t.overlay;
        styles.push(styleLine(`Text${i + 1}`, o, o.position, 80));
        const second = o.subtext ? `\\N{\\fs${Math.round(TEXT_SIZES[o.size] * 0.6)}}${assText(o.subtext)}` : '';
        events.push(`Dialogue: 1,${assTime(t.startMs)},${assTime(t.endMs)},Text${i + 1},,0,0,0,,{\\fad(250,250)}${assText(o.text)}${second}`);
    });
    return [
        '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${FRAME.width}`, `PlayResY: ${FRAME.height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        ...styles, '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...events, '',
    ].join('\n');
}

// ─── Image overlays (ffmpeg) ────────────────────────────────────────────────

// Where an image sits: its width in pixels (even, for the encoder) and ffmpeg overlay x and y
// expressions (W, H the frame; w, h the image), 60 pixels in from the edges unless it fills the width.
export function imagePlacement(position: Position, widthPct: number): { width: number; x: string; y: string } {
    const width = Math.max(2, Math.round(FRAME.width * widthPct / 100 / 2) * 2);
    const m = widthPct >= 100 ? 0 : 60;
    const x = position.endsWith('left') ? `${m}` : position.endsWith('right') ? `W-w-${m}` : '(W-w)/2';
    const y = position.startsWith('top') ? `${m}` : position.startsWith('bottom') ? `H-h-${m}` : '(H-h)/2';
    return { width, x, y };
}

// The filter text that lays one image (ffmpeg input `inputIdx`) over `inLabel` while it is up, giving `outLabel`.
export function imageOverlayFilter(inputIdx: number, inLabel: string, outLabel: string, placed: Placed<ImageOverlay>): string {
    const { width, x, y } = imagePlacement(placed.overlay.position, placed.overlay.widthPct);
    const s = (placed.startMs / 1000).toFixed(3), e = (placed.endMs / 1000).toFixed(3);
    return `[${inputIdx}:v]scale=${width}:-2,format=rgba[${outLabel}_img];` +
        `[${inLabel}][${outLabel}_img]overlay=x=${x}:y=${y}:enable='between(t,${s},${e})',format=yuv420p[${outLabel}];`;
}
