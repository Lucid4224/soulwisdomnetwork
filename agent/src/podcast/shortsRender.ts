// Draws one short (docs/specs/013-shorts.md): the burned-in text as an ASS subtitle file, which
// ffmpeg renders with libass over the backdrop and video (media.ts renderShort). Headline at the
// top with its *marked* words in gold, the speaker's name under the video, and captions a few
// words at a time with the word being spoken in gold. Type: Outfit, the site's heading font.

import * as path from 'path';
import { captionChunks, SHORT_HEIGHT, SHORT_WIDTH, shortLayout, type ShortAspect } from '../../../lib/shorts';
import type { TimedWord } from '../../../lib/retime';
import { hookWords } from '../../../lib/thumbnail';

export const FONTS_DIR = path.resolve('agent/assets/fonts');
export const LOGO = path.resolve('public/logo.png');

// ASS colours are &HBBGGRR.
const GOLD = '&H5BC6F7&';
const WHITE = '&HFFFFFF&';
const INK = '&H2E0A14&';

// Braces and backslashes start ASS override codes.
const safe = (s: string) => s.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

function time(ms: number) {
    const cs = Math.max(0, Math.round(ms / 10));
    const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// `words` are the final cut's words inside the short, times in the final cut; `startMs` is where the short begins.
export function shortAss(o: { headline: string; speaker: string; words: TimedWord[]; startMs: number; durationMs: number; aspect: ShortAspect }) {
    const l = shortLayout(o.aspect);
    const events: string[] = [];
    const add = (style: string, from: number, to: number, text: string) =>
        events.push(`Dialogue: 0,${time(from)},${time(to)},${style},,0,0,0,,${text}`);

    const headline = hookWords(o.headline).map(w => `{\\c${w.gold ? GOLD : WHITE}}${safe(w.text)}`).join(' ');
    if (headline) add('Headline', 0, o.durationMs, `{\\an5\\pos(${SHORT_WIDTH / 2},${l.headline.centerY})}${headline}`);
    if (o.speaker) add('Speaker', 0, o.durationMs, `{\\an8\\pos(${SHORT_WIDTH / 2},${l.speakerTop})}${safe(o.speaker).toUpperCase()}`);

    const shifted = o.words.map(w => ({ text: safe(w.text), start: w.start - o.startMs, end: w.end - o.startMs })).filter(w => w.text);
    for (const chunk of captionChunks(shifted)) {
        chunk.words.forEach((w, i) => {
            const from = i === 0 ? chunk.startMs : w.start;
            const to = i + 1 < chunk.words.length ? chunk.words[i + 1].start : chunk.endMs;
            if (to <= from) return;
            const text = chunk.words.map((x, j) => `{\\c${j === i ? GOLD : WHITE}}${x.text}`).join(' ');
            add('Caption', Math.max(0, from), Math.min(o.durationMs, to), `{\\an8\\pos(${SHORT_WIDTH / 2},${l.captionsTop})}${text}`);
        });
    }

    return [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${SHORT_WIDTH}`,
        `PlayResY: ${SHORT_HEIGHT}`,
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        'YCbCr Matrix: TV.709',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        `Style: Headline,Outfit Black,88,${WHITE},${WHITE},${INK},&H64000000&,0,0,0,0,100,100,0,0,1,4,3,5,${l.headline.marginX},${l.headline.marginX},0,1`,
        `Style: Speaker,Outfit SemiBold,36,${GOLD},${GOLD},${INK},&H00000000&,0,0,0,0,100,100,6,0,1,0,0,8,60,60,0,1`,
        `Style: Caption,Outfit Black,78,${WHITE},${WHITE},${INK},&H64000000&,0,0,0,0,100,100,0,0,1,6,3,8,${l.captionsMarginX},${l.captionsMarginX},0,1`,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...events,
        '',
    ].join('\n');
}
