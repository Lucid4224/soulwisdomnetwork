// Part I, text and pictures on screen, translations and retakes: the settings, the overlay checks,
// the ASS captions file, image placement, the translation and retake helpers, the render plan, and a
// real render (ffmpeg) proving captions, a text overlay and an image overlay land where and when they should.
// Run: npx tsx --test agent/src/podcast/onScreen.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCues } from '../../../lib/captions';
import { keepRanges } from '../../../lib/edit';
import {
    assRgba, assText, assTime, buildAss, captionLook, DEFAULT_CAPTION_STYLE, FONT_NAMES, imageOverlayFilter, imagePlacement,
    nameTitles, newText, onScreenProblem, OVERLAYS_MAX, placeOverlays, type ImageOverlay, type TextOverlay,
} from '../../../lib/onScreen';
import { addRetakes, findWords, retakesUserMessage, timeRetakes } from '../../../lib/retakes';
import { DEFAULT_SETTINGS, withDefaults } from '../../../lib/studioSettings';
import {
    applyTranslations, captionsUserMessage, cleanLanguages, cleanMeta, cueBatches, fitUtf8, languageName, wrapLines,
} from '../../../lib/translate';
import type { Episode } from '../../../types/episode';
import { renderEdit } from './editRender';
import { planEditRender } from './editRenderJob';

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
// The brightest and darkest grey level (0-255) in a box of the frame at `seconds`.
function levels(file: string, seconds: number, box: { x: number; y: number; w: number; h: number }) {
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
        '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    return { max: Math.max(...raw), min: Math.min(...raw) };
}
// The colour of a small patch, as [r, g, b].
const patch = (file: string, seconds: number, x: number, y: number) => [...execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
    '-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];

const text = (over: Partial<TextOverlay> = {}): TextOverlay => ({ ...newText('t1', 1000), ...over });
const image = (over: Partial<ImageOverlay> = {}): ImageOverlay => ({
    id: 'i1', type: 'image', atMs: 1000, seconds: 2, path: 'overlays/logo.png', name: 'logo.png', position: 'top-right', widthPct: 20, ...over,
});

test('settings: captions off, the default look and no languages; valid choices are kept', () => {
    assert.equal(DEFAULT_SETTINGS.burnCaptions, false);
    assert.deepEqual(DEFAULT_SETTINGS.captionStyle, { font: 'Outfit SemiBold', size: 'medium', color: '#ffffff', background: 'outline', position: 'bottom' });
    assert.deepEqual(DEFAULT_SETTINGS.captionLanguages, []);
    const look = { font: 'EB Garamond', size: 'large', color: '#f7c65b', background: 'box', position: 'top' };
    const s = withDefaults({ burnCaptions: true, captionStyle: look, captionLanguages: ['es', 'fr'] });
    assert.equal(s.burnCaptions, true);
    assert.deepEqual(s.captionStyle, look);
    assert.deepEqual(s.captionLanguages, ['es', 'fr']);
    assert.deepEqual(withDefaults({ captionStyle: { ...look, color: 'gold' } }).captionStyle, DEFAULT_CAPTION_STYLE);
    assert.deepEqual(withDefaults({ captionLanguages: ['xx'] }).captionLanguages, []);
    assert.ok(FONT_NAMES.includes('Outfit SemiBold') && FONT_NAMES.length === 7);
});

test('overlays: checked before saving; captions follow the edit, else the Studio', () => {
    assert.equal(onScreenProblem({}), null);
    assert.equal(onScreenProblem({ overlays: [text(), image()], captions: { on: true, style: DEFAULT_CAPTION_STYLE } }), null);
    assert.match(onScreenProblem({ overlays: [text({ color: 'red' })] }) ?? '', /^On-screen items: /);
    assert.match(onScreenProblem({ overlays: [image({ path: 'settings/logo.png' })] }) ?? '', /^On-screen items: /);
    assert.match(onScreenProblem({ overlays: [text({ text: '  ' })] }) ?? '', /Type the text/);
    assert.match(onScreenProblem({ overlays: Array.from({ length: OVERLAYS_MAX + 1 }, () => text()) }) ?? '', /^On-screen items: /);
    assert.match(onScreenProblem({ captions: { on: 'yes' } }) ?? '', /^Captions: /);
    const studio = { burnCaptions: true, captionStyle: DEFAULT_CAPTION_STYLE };
    assert.deepEqual(captionLook({}, studio), DEFAULT_CAPTION_STYLE);
    assert.equal(captionLook({ captions: { on: false, style: DEFAULT_CAPTION_STYLE } }, studio), null);
    const own = { ...DEFAULT_CAPTION_STYLE, color: '#ffff00' };
    assert.deepEqual(captionLook({ captions: { on: true, style: own } }, { ...studio, burnCaptions: false }), own);
    assert.equal(captionLook({ captions: null }, { ...studio, burnCaptions: false }), null);
});

test('name titles: one per speaker where they first speak, never twice', () => {
    const words = [{ speaker: 'Ana', start: 400 }, { speaker: 'Ana', start: 900 }, { speaker: 'Ben', start: 3000 }];
    const titles = nameTitles(words, []);
    assert.deepEqual(titles.map(t => [t.text, t.atMs, t.seconds, t.position, t.background]), [['Ana', 400, 5, 'bottom-left', 'box'], ['Ben', 3000, 5, 'bottom-left', 'box']]);
    assert.equal(new Set(titles.map(t => t.id)).size, 2);
    assert.deepEqual(nameTitles(words, titles.slice(0, 1)).map(t => t.text), ['Ben']);
});

test('placing: overlays move with the cuts and end with the video', () => {
    const ranges = keepRanges(10000, [{ startMs: 2000, endMs: 4000, reason: 'manual' }], 0);   // keeps 0-2 s and 4-10 s
    const placed = placeOverlays([
        { atMs: 1000, seconds: 2 }, { atMs: 3000, seconds: 1 }, { atMs: 5000, seconds: 30 }, { atMs: 12000, seconds: 1 },
    ], ranges, 8000);
    assert.deepEqual(placed.map(p => [p.startMs, p.endMs]), [[1000, 3000], [2000, 3000], [3000, 8000]]);
});

test('ASS: colours, times, safe text, styles and events', () => {
    assert.equal(assRgba('#f7c65b'), '&H005BC6F7');
    assert.equal(assRgba('#000000', 0x50), '&H50000000');
    assert.equal(assTime(3_723_456), '1:02:03.46');
    assert.equal(assText('a {b} c\\d\ne'), 'a (b) c/d\\Ne');
    assert.equal(buildAss([], DEFAULT_CAPTION_STYLE, []), null);
    const cues = [{ startMs: 500, endMs: 2500, lines: ['Hello there,', 'friend'] }];
    const ass = buildAss(cues, { font: 'Open Sans', size: 'large', color: '#ffff00', background: 'box', position: 'top' },
        [{ overlay: text({ text: 'Ana Ruiz', subtext: 'Guest', position: 'bottom-left', size: 'medium', background: 'outline' }), startMs: 1000, endMs: 6000 }])!;
    assert.match(ass, /^\[Script Info\]\nScriptType: v4\.00\+\nPlayResX: 1920\nPlayResY: 1080\n/);
    assert.ok(ass.includes('Style: Captions,Open Sans,80,&H0000FFFF,&H0000FFFF,&H50000000,&H60000000,-1,0,0,0,100,100,0,0,3,12,0,8,90,90,70,1'), ass);
    assert.ok(ass.includes('Style: Text1,Outfit SemiBold,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,0,0,0,0,100,100,0,0,1,4,0,1,90,90,80,1'), ass);
    assert.ok(ass.includes('Dialogue: 0,0:00:00.50,0:00:02.50,Captions,,0,0,0,,Hello there,\\Nfriend'));
    assert.ok(ass.includes('Dialogue: 1,0:00:01.00,0:00:06.00,Text1,,0,0,0,,{\\fad(250,250)}Ana Ruiz\\N{\\fs36}Guest'));
    assert.equal(buildAss(cues, null, []), null);
});

test('images: size and place on the frame', () => {
    assert.deepEqual(imagePlacement('top-right', 20), { width: 384, x: 'W-w-60', y: '60' });
    assert.deepEqual(imagePlacement('middle', 100), { width: 1920, x: '(W-w)/2', y: '(H-h)/2' });
    assert.deepEqual(imagePlacement('bottom-left', 15), { width: 288, x: '60', y: 'H-h-60' });
    assert.equal(imageOverlayFilter(4, 'ep1', 'im0', { overlay: image(), startMs: 1000, endMs: 3000 }),
        "[4:v]scale=384:-2,format=rgba[im0_img];[ep1][im0_img]overlay=x=W-w-60:y=60:enable='between(t,1.000,3.000)',format=yuv420p[im0];");
});

test('translation: languages, batches, timing kept, lines wrapped, YouTube limits', () => {
    assert.deepEqual(cleanLanguages(['fr', 'es', 'es', 'xx', 3]), ['es', 'fr']);
    assert.deepEqual(cleanLanguages('es'), []);
    assert.equal(languageName('zh-Hans'), 'Chinese (Simplified)');
    assert.equal(languageName('qq'), 'qq');
    const cues = buildCues([
        { text: 'Hello', start: 0, end: 400 }, { text: 'everyone.', start: 400, end: 900 },
        { text: 'Welcome', start: 3000, end: 3400 }, { text: 'back.', start: 3400, end: 3800 },
    ]);
    assert.equal(cues.length, 2);
    assert.deepEqual(cueBatches(cues, 1), [[{ i: 0, text: 'Hello everyone.' }], [{ i: 1, text: 'Welcome back.' }]]);
    assert.equal(captionsUserMessage([{ i: 0, text: 'Hi' }]), '<captions>\n0\tHi\n</captions>\n\nTranslate every caption.');
    const { cues: es, missing } = applyTranslations(cues, [{ i: 0, text: 'Hola a todos.' }, { i: 7, text: 'x' }]);
    assert.equal(missing, 1);
    assert.deepEqual(es.map(c => [c.startMs, c.endMs, c.lines]), [[cues[0].startMs, cues[0].endMs, ['Hola a todos.']], [cues[1].startMs, cues[1].endMs, ['Welcome back.']]]);
    assert.deepEqual(wrapLines('one two three four five six seven eight nine ten eleven twelve'), ['one two three four five six seven', 'eight nine ten eleven twelve']);
    assert.deepEqual(wrapLines('あ'.repeat(50)), ['あ'.repeat(25), 'あ'.repeat(25)]);
    assert.equal(fitUtf8('ééé', 5), 'éé');
    const meta = cleanMeta({ title: ' <b>' + 'x'.repeat(120) + ' ', description: ' Hi <there> ' });
    assert.equal(meta.title.length, 100);
    assert.equal(meta.description, 'Hi there');
});

test('retakes: found word for word on their line, timed, added once as suggestions', () => {
    const lines = [
        { name: 'Ana', words: [{ text: 'So', start: 0, end: 200 }, { text: 'what', start: 200, end: 400 }, { text: 'I—', start: 400, end: 600 },
            { text: 'So', start: 900, end: 1100 }, { text: 'what', start: 1100, end: 1300 }, { text: 'I', start: 1300, end: 1400 }, { text: 'mean,', start: 1400, end: 1700 }] },
        { name: 'Ben', words: [{ text: 'Right.', start: 2000, end: 2400 }] },
    ];
    assert.equal(retakesUserMessage(lines), '<transcript>\n0\tAna: So what I— So what I mean,\n1\tBen: Right.\n</transcript>\n\nList the retakes.');
    assert.deepEqual(findWords(lines[0].words, 'so what I'), [0, 2]);
    assert.equal(findWords(lines[0].words, 'what mean'), null);
    const { retakes, notFound } = timeRetakes(lines, { retakes: [
        { line: 0, text: 'So what I', why: ' restarted the sentence ' }, { line: 1, text: 'Wrong', why: 'x' }, { line: 9, text: 'So', why: 'x' },
    ] });
    assert.deepEqual(retakes, [{ startMs: 0, endMs: 600, why: 'restarted the sentence' }]);
    assert.equal(notFound, 2);
    const cuts = addRetakes([{ startMs: 5000, endMs: 6000, reason: 'manual' }], retakes);
    assert.deepEqual(cuts, [{ startMs: 5000, endMs: 6000, reason: 'manual' }, { startMs: 0, endMs: 600, reason: 'retake' }]);
    assert.equal(addRetakes(cuts, retakes).length, 2);
});

test('plan: captions from the settings or the edit, text and image overlays split', () => {
    const base = {
        title: 'T', status: 'speakers_confirmed', media: { sourcePath: 'episodes/x/source/a.mp4' },
        review: { reviewedPath: 'episodes/x/transcripts/reviewed.json' },
        edit: { version: 1, cuts: [], overlays: [text(), image()] },
    } as unknown as Episode;
    const off = planEditRender(base);
    assert.equal(off.onScreen.captions, null);
    assert.deepEqual(off.onScreen.texts.map(t => t.id), ['t1']);
    assert.deepEqual(off.onScreen.images.map(i => i.path), ['overlays/logo.png']);
    const on = planEditRender(base, { ...DEFAULT_SETTINGS, burnCaptions: true });
    assert.deepEqual(on.onScreen.captions, DEFAULT_CAPTION_STYLE);
    const noWords = planEditRender({ ...base, review: undefined } as Episode, { ...DEFAULT_SETTINGS, burnCaptions: true });
    assert.equal(noWords.onScreen.captions, null);
    assert.match(noWords.warnings.join(' '), /Captions are on, but the transcript is not accepted/);
    const plain = planEditRender({ ...base, edit: { version: 1, cuts: [] } } as Episode);
    assert.deepEqual(plain.onScreen, { captions: null, texts: [], images: [] });
});

test('a real render: captions, a text overlay and an image overlay, where and when they should be', { timeout: 300_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onscreen-'));
    const video = path.join(dir, 'episode.mp4'), logo = path.join(dir, 'logo.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '8',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=400x200', '-frames:v', '1', logo]);
    const words = [
        { text: 'Welcome', start: 3000, end: 3400 }, { text: 'to', start: 3400, end: 3600 }, { text: 'the', start: 3600, end: 3800 },
        { text: 'gathering.', start: 3800, end: 4600 },
    ];
    const out = path.join(dir, 'out.mp4');
    await renderEdit({
        video, out, clean: 'off', words,
        edit: { version: 1, cuts: [{ startMs: 1000, endMs: 2000, reason: 'manual' }] },   // everything after 2 s plays 1 s earlier
        onScreen: {
            captions: { font: 'Outfit SemiBold', size: 'large', color: '#ffffff', background: 'outline', position: 'bottom' },
            texts: [text({ atMs: 5000, seconds: 2, text: 'HELLO', size: 'huge', color: '#ffffff', background: 'shadow', position: 'top' })],
            images: [{ overlay: image({ atMs: 0, seconds: 1.5 }), file: logo }],
        },
    });
    const bottom = { x: 560, y: 900, w: 800, h: 140 }, top = { x: 660, y: 70, w: 600, h: 140 };
    // The caption is up while "Welcome to the gathering." is spoken: 2.0-3.6 s once the cut is out.
    assert.ok(levels(out, 2.8, bottom).max > 220, `caption shows ${JSON.stringify(levels(out, 2.8, bottom))}`);
    assert.ok(levels(out, 2.8, bottom).min < 40, 'caption has its dark outline');
    assert.ok(levels(out, 1.0, bottom).max < 140, `no caption before ${levels(out, 1.0, bottom).max}`);
    // The text overlay starts at 5 s of the recording, 4 s into the edited video, for 2 s.
    assert.ok(levels(out, 4.8, top).max > 220, `text shows ${levels(out, 4.8, top).max}`);
    assert.ok(levels(out, 6.6, top).max < 140, `text gone ${levels(out, 6.6, top).max}`);
    // The image sits top right, 20% of the width, from the start for 1.5 s.
    const [r, g, b] = patch(out, 0.8, 1920 - 60 - 192, 60 + 38);
    assert.ok(r > 180 && g < 80 && b < 80, `image colour ${[r, g, b]}`);
    const [r2, g2] = patch(out, 2.5, 1920 - 60 - 192, 60 + 38);
    assert.ok(Math.abs(r2 - g2) < 20, `image gone ${[r2, g2]}`);
    fs.rmSync(dir, { recursive: true, force: true });
});
