// The Studio settings' options for the Editor Light render (lib/studioSettings.ts), proven on
// stand-in data with real ffmpeg renders: no intro, your own intro, teaser clips cut from the
// recording when there is no edit package, no Drive, and the render becoming the final cut that
// thumbnails, Shorts and YouTube use. Also: the YouTube description lines and the final cut
// check, with the defaults giving exactly what the Studio always did.
// Run: npx tsx --test agent/src/podcast/editRenderOptions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { finalIsCurrent } from '../../../lib/finalCut';
import { youtubeDescription, type ShowNotes } from '../../../lib/showNotes';
import { DEFAULT_SETTINGS, withDefaults, type StudioSettings } from '../../../lib/studioSettings';
import type { Episode } from '../../../types/episode';
import { renderEdit } from './editRender';
import { runEditRender, type EditRenderDeps } from './editRenderJob';
import { cutClip, probeDuration } from './media';

const ID = 'testEpisode456';
// A 4 s cut removes 4.08 s: keepRanges pads every cut by 40 ms on each side.
const EDITED = 20 - 4.08;

function ffmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    });
}
const clip = (out: string, seconds: number, freq: number) => ffmpeg([
    '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out,
]);

// An uploaded recording with approved notes and a saved edit, and no edit package (no Descript).
function episode(): Episode {
    return {
        title: 'Team meeting: October',
        status: 'speakers_confirmed',
        source: 'upload',
        media: { sourcePath: `episodes/${ID}/source/zoom.mp4` },
        review: { reviewedPath: `episodes/${ID}/transcripts/reviewed.json` },
        edit: { version: 3, cuts: [{ startMs: 2000, endMs: 6000, reason: 'manual' }] },
        notes: { status: 'approved', approvedVersion: 5, approved: {
            chapters: [{ startMs: 0, title: 'Start' }, { startMs: 10000, title: 'Budget' }],
            quotes: [{ text: 'we ship friday', speaker: 'Sam', startMs: 7000, endMs: 9000 }],
            teaserClips: [{ text: 'hello', speaker: 'Sam', startMs: 12000, endMs: 13100 }],
        } as never },
    } as unknown as Episode;
}

async function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-render-options-'));
    const store = path.join(dir, 'storage');
    const put = (p: string) => { const f = path.join(store, p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
    const e = episode();
    await clip(put(e.media!.sourcePath!), 20, 440);
    await clip(put('settings/intro-1.mp4'), 3, 880);
    await clip(path.join(dir, 'show-intro.mp4'), 2, 990);
    fs.writeFileSync(put(e.review!.reviewedPath!), JSON.stringify({ lines: [
        { words: [{ text: 'hello', start: 500, end: 900 }, { text: 'gone', start: 3000, end: 3500 }] },
        { words: [{ text: 'after', start: 7000, end: 7400 }] },
    ] }));
    return { dir, store, put, e };
}

async function run(settings: StudioSettings, withCutter = true) {
    const { dir, store, put, e } = await setup();
    const downloads: string[] = [];
    const uploads: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const deps: EditRenderDeps = {
        getEpisode: async () => e,
        download: async (p, dest) => { downloads.push(p); fs.copyFileSync(path.join(store, p), dest); },
        upload: async (local, p) => { uploads.push(p); fs.copyFileSync(local, put(p)); },
        saveToDrive: async () => null,                         // no Drive set up
        update: async fields => { updates.push(fields); },
        render: renderEdit,
        now: () => 'NOW',
        settings,
        showIntro: path.join(dir, 'show-intro.mp4'),
        ...(withCutter ? { cutClip: async (i: string, o: string, s: number, d: number) => { await cutClip(i, o, s, d, true); } } : {}),
    };
    const result = await runEditRender(ID, deps, path.join(dir, 'work'));
    const seconds = await probeDuration(path.join(store, `episodes/${ID}/editRender/episode.mp4`));
    return { dir, store, e, result, seconds, downloads, uploads, updates, last: updates[updates.length - 1] };
}

test('no intro and no teasers: only the edited recording', { timeout: 600_000 }, async () => {
    const r = await run(withDefaults({ intro: 'none', teasers: false }));
    assert.ok(Math.abs(r.seconds - EDITED) < 0.5, `rendered ${r.seconds}s, expected ${EDITED}s`);
    assert.equal(r.result.driveUrl, null);
    assert.equal(r.result.driveFileId, null);
    assert.equal(r.result.warnings.length, 0);
    assert.ok(!('final' in r.last), 'with Descript as the final cut, the render leaves the final cut alone');
    fs.rmSync(r.dir, { recursive: true, force: true });
});

test('your own intro plays at the start and end', { timeout: 600_000 }, async () => {
    const r = await run(withDefaults({ intro: 'custom', introPath: 'settings/intro-1.mp4', teasers: false }));
    assert.ok(Math.abs(r.seconds - (3 + EDITED + 3)) < 0.5, `rendered ${r.seconds}s`);
    assert.equal(r.downloads.filter(p => p === 'settings/intro-1.mp4').length, 1);
    fs.rmSync(r.dir, { recursive: true, force: true });
});

test('no edit package: teaser cut from the recording, the show intro from the site files', { timeout: 600_000 }, async () => {
    const r = await run(DEFAULT_SETTINGS);
    // Teaser 12.0 s to 13.1 s with 0.3 s before and 0.6 s after = 2.0 s; show intro 2 s, twice.
    assert.ok(Math.abs(r.seconds - (2.0 + 2 + EDITED + 2)) < 0.5, `rendered ${r.seconds}s`);
    assert.match(r.result.warnings.join(' '), /edit package is not built/);
    fs.rmSync(r.dir, { recursive: true, force: true });
});

test('Editor Light as the final cut: the final record is written for thumbnails, Shorts and YouTube', { timeout: 600_000 }, async () => {
    const r = await run(withDefaults({ finalSource: 'editorLight', intro: 'none', teasers: false }));
    const final = r.last.final as NonNullable<Episode['final']>;
    assert.equal(final.status, 'ready');
    assert.equal(final.source, 'editorLight');
    assert.equal(final.editVersion, 3);
    assert.equal(final.notesVersion, 5);
    assert.equal(final.videoPath, `episodes/${ID}/editRender/episode.mp4`);
    assert.equal(final.wordsPath, `episodes/${ID}/editRender/final-words.json`);
    assert.ok(!('driveUrl' in final), 'no Drive link without Drive');
    // The words file is { words } with text, start and end, as Descript's final cut keeps it.
    const saved = JSON.parse(fs.readFileSync(path.join(r.store, final.wordsPath!), 'utf8')) as { words: { text: string; start: number }[] };
    assert.deepEqual(saved.words.map(w => w.text), ['hello', 'after']);
    assert.ok(Math.abs(saved.words[1].start - (7000 - 4080)) <= 50);
    // Chapters and quotes keep their original time and gain the time in the rendered video.
    assert.deepEqual(final.chapters!.map(c => [c.title, c.originalMs]), [['Start', 0], ['Budget', 10000]]);
    assert.ok(Math.abs(final.chapters![1].startMs - (10000 - 4080)) <= 50);
    assert.equal(final.quotes![0].originalMs, 7000);
    assert.ok(Math.abs(final.quotes![0].startMs - (7000 - 4080)) <= 50);
    // It counts as current until the edit or the notes change.
    const after = { ...r.e, final } as Episode;
    assert.equal(finalIsCurrent(after), true);
    assert.equal(finalIsCurrent({ ...after, edit: { ...after.edit!, version: 4 } } as Episode), false);
    assert.equal(finalIsCurrent({ ...after, notes: { ...after.notes!, approvedVersion: 6 } } as Episode), false);
    fs.rmSync(r.dir, { recursive: true, force: true });
});

test('Descript final cut: current exactly as before (same project and notes)', () => {
    const base = { notes: { status: 'approved', approvedVersion: 2 }, descript: { status: 'ready', projectId: 'p1' } } as unknown as Episode;
    assert.equal(finalIsCurrent({ ...base, final: { status: 'ready', projectId: 'p1', notesVersion: 2 } } as Episode), true);
    assert.equal(finalIsCurrent({ ...base, final: { status: 'ready', projectId: 'p0', notesVersion: 2 } } as Episode), false);
    assert.equal(finalIsCurrent({ ...base, final: { status: 'ready', projectId: 'p1', notesVersion: 1 } } as Episode), false);
    assert.equal(finalIsCurrent({ ...base, final: { status: 'publishing', projectId: 'p1', notesVersion: 2 } } as Episode), false);
});

test('YouTube description: defaults unchanged, own lines when set, none when empty', () => {
    const notes = { description: 'About this one.', chapters: [{ startMs: 0, title: 'Start' }], hashtags: ['#a'] } as unknown as ShowNotes;
    assert.equal(youtubeDescription(notes, DEFAULT_SETTINGS), youtubeDescription(notes));
    const own = youtubeDescription(notes, withDefaults({ siteUrl: 'https://acme.test', siteLinkText: 'More:', subscribeLine: 'Follow us.' }));
    assert.match(own, /About this one\.\n\nMore: https:\/\/acme\.test\n\nChapters\n0:00 Start\n\nFollow us\.\n\n#a$/);
    const bare = youtubeDescription(notes, withDefaults({ siteUrl: '', subscribeLine: '' }));
    assert.equal(bare, 'About this one.\n\nChapters\n0:00 Start\n\n#a');
});
