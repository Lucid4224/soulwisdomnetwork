// The "In this episode" tag (docs/specs/009-edit-package.md): a lower-third in the lower left of
// each teaser clip, so viewers know these are moments from the conversation to come. Gold
// "IN THIS EPISODE" in Outfit Black over the brand violet, a gold rule on its left, and the
// clip's speaker in white underneath. Drawn as an ASS file that ffmpeg burns in with libass
// (media.ts cutClip); without a speaker it is the generic banner, a transparent PNG
// (media.ts assStill) for placing over clips by hand in Descript.

import { GOLD, INK, safe, time, WHITE } from './shortsRender';

const WIDTH = 1920;
const HEIGHT = 1080;
const VIOLET = '&H52152A&';     // #2a1552, the backdrop of the shorts and thumbnails
const LEFT = 80;                // the box's left edge
const BOTTOM = 990;             // and its bottom, clear of YouTube's progress bar
const PAD = 40;                 // text inset from the gold rule
const RULE = 8;

// Wide enough for "IN THIS EPISODE"; Outfit SemiBold at 38 px is about 16 px a character, so
// the box grows for long names.
const boxWidth = (speaker: string) => Math.min(WIDTH - 2 * LEFT, Math.max(460, RULE + 2 * PAD + speaker.length * 16));

export function teaserAss({ speaker = '', durationMs, matte = false }: { speaker?: string; durationMs: number; matte?: boolean }) {
    // The matte (for the transparent PNG) is the same drawing all in white.
    const c = (colour: string) => (matte ? WHITE : colour);
    const name = safe(speaker);
    const top = BOTTOM - (name ? 150 : 96);
    const right = LEFT + boxWidth(name);
    const rect = (x1: number, y1: number, x2: number, y2: number) => `{\\pos(0,0)\\p1}m ${x1} ${y1} l ${x2} ${y1} l ${x2} ${y2} l ${x1} ${y2}{\\p0}`;
    const end = time(durationMs);
    const line = (layer: number, style: string, text: string) => `Dialogue: ${layer},0:00:00.00,${end},${style},,0,0,0,,${text}`;
    return [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${WIDTH}`,
        `PlayResY: ${HEIGHT}`,
        'WrapStyle: 2',
        'ScaledBorderAndShadow: yes',
        'YCbCr Matrix: TV.709',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        // Drawings take the style's colour; the box is slightly see-through.
        `Style: Box,Outfit SemiBold,20,&H30${c(VIOLET).slice(2)},${WHITE},${INK},&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
        `Style: Rule,Outfit SemiBold,20,${c(GOLD)},${GOLD},${INK},&H00000000&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
        `Style: Tag,Outfit Black,44,${c(GOLD)},${GOLD},${INK},&H00000000&,0,0,0,0,100,100,6,0,1,0,0,7,0,0,0,1`,
        `Style: Speaker,Outfit SemiBold,38,${WHITE},${WHITE},${INK},&H00000000&,0,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1`,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        line(0, 'Box', rect(LEFT, top, right, BOTTOM)),
        line(1, 'Rule', rect(LEFT, top, LEFT + RULE, BOTTOM)),
        line(2, 'Tag', `{\\pos(${LEFT + RULE + PAD - 8},${top + 26})}IN THIS EPISODE`),
        ...(name ? [line(2, 'Speaker', `{\\pos(${LEFT + RULE + PAD - 8},${top + 86})}${name}`)] : []),
        '',
    ].join('\n');
}
