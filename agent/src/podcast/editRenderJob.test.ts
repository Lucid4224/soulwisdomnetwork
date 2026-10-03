// Editor Light render job: proves the plan and the whole job on stand-in data. Storage,
// Firestore and Drive are fakes backed by a temp folder; the render is real (ffmpeg), on a
// 20 s test clip with a 2 s teaser, a 3 s intro used again as the outro, and one b-roll still.
// Run: npx tsx --test agent/src/podcast/editRenderJob.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Episode } from '../../../types/episode';
import { renderEdit } from './editRender';
import { planEditRender, runEditRender, type EditRenderDeps } from './editRenderJob';
import { probeDuration } from './media';

const ID = 'testEpisode123';

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

// An episode as Firestore would hold it once the package is built and the notes approved.
function episode(over: Partial<Episode> = {}): Episode {
    return {
        title: 'Test: Episode / One',
        status: 'speakers_confirmed',
        media: { sourcePath: `episodes/${ID}/source/original.mp4` },
        review: { reviewedPath: `episodes/${ID}/transcripts/reviewed.json` },
        edit: { version: 7, cuts: [{ startMs: 2000, endMs: 6000, reason: 'manual' }] },
        package: {
            status: 'ready',
            clipPaths: [`episodes/${ID}/package/clip-1.mp4`],
            introPath: `episodes/${ID}/package/intro.mp4`,
            episodePath: null,
        },
        broll: { status: 'ready', only: null, images: {
            '0': { index: 0, idea: 'sea', startMs: 12000, durationSeconds: 2, path: `episodes/${ID}/broll/0.png` } as never,
        } },
        notes: { status: 'approved', approved: {
            chapters: [{ startMs: 0, title: 'Start' }, { startMs: 10000, title: 'Middle' }],
            quotes: [
                { text: 'kept', speaker: 'Host', startMs: 7000, endMs: 9000 },
                { text: 'no end', speaker: 'Host', startMs: 8000, endMs: -1 },
            ],
        } as never },
        ...over,
    } as Episode;
}

test('plan: needs a saved edit', () => {
    assert.throws(() => planEditRender(episode({ edit: undefined })), /Save an edit/);
});

test('plan: needs the source video', () => {
    assert.throws(() => planEditRender(episode({ media: {}, package: undefined })), /original video/);
});

test('plan: uses the filled 1080p copy when the package made one', () => {
    const e = episode();
    e.package!.episodePath = `episodes/${ID}/package/episode-1080p.mp4`;
    assert.equal(planEditRender(e).video, `episodes/${ID}/package/episode-1080p.mp4`);
    assert.equal(planEditRender(episode()).video, `episodes/${ID}/source/original.mp4`);
});

test('plan: teasers and intro come only from a ready package, with a warning otherwise', () => {
    const ready = planEditRender(episode());
    assert.deepEqual(ready.teasers, [`episodes/${ID}/package/clip-1.mp4`]);
    assert.equal(ready.intro, `episodes/${ID}/package/intro.mp4`);
    assert.equal(ready.warnings.length, 0);
    const e = episode();
    e.package!.status = 'building';
    const notReady = planEditRender(e);
    assert.deepEqual(notReady.teasers, []);
    assert.equal(notReady.intro, null);
    assert.match(notReady.warnings.join(' '), /edit package/);
});

test('plan: b-roll in idea order, quotes without an end dropped, notes warning', () => {
    const e = episode();
    e.broll!.images = {
        '2': { index: 2, startMs: 9000, durationSeconds: 3, path: 'b/2.png' } as never,
        '0': { index: 0, startMs: 1000, durationSeconds: 4, path: 'b/0.png' } as never,
    };
    const plan = planEditRender(e);
    assert.deepEqual(plan.broll, [
        { atMs: 1000, seconds: 4, image: 'b/0.png' },
        { atMs: 9000, seconds: 3, image: 'b/2.png' },
    ]);
    assert.deepEqual(plan.quotes.map(q => q.text), ['kept']);
    const draft = planEditRender(episode({ notes: { status: 'ready' } as never }));
    assert.deepEqual(draft.chapters, []);
    assert.match(draft.warnings.join(' '), /show notes/);
});

test('job: renders on stand-in data and saves everything', { timeout: 600_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-render-job-'));
    const store = path.join(dir, 'storage');
    const put = (p: string) => { const f = path.join(store, p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
    const e = episode();
    await clip(put(e.media!.sourcePath!), 20, 440);
    await clip(put(e.package!.clipPaths![0]), 2, 660);
    await clip(put(e.package!.introPath!), 3, 880);
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=800x600', '-frames:v', '1', put(`episodes/${ID}/broll/0.png`)]);
    fs.writeFileSync(put(e.review!.reviewedPath!), JSON.stringify({ lines: [
        { words: [{ text: 'hello', start: 500, end: 900 }, { text: 'gone', start: 3000, end: 3500 }] },
        { words: [{ text: 'after', start: 7000, end: 7400 }] },
    ] }));

    const downloads: string[] = [];
    const uploads: Record<string, string> = {};
    const updates: Record<string, unknown>[] = [];
    let driveName = '';
    const deps: EditRenderDeps = {
        getEpisode: async () => e,
        download: async (p, dest) => { downloads.push(p); fs.copyFileSync(path.join(store, p), dest); },
        upload: async (local, p, type) => { uploads[p] = type; fs.copyFileSync(local, put(p)); },
        saveToDrive: async (_local, name) => { driveName = name; return { fileId: 'drive-file-1', folderId: 'folder-04' }; },
        update: async fields => { updates.push(fields); },
        render: renderEdit,
        now: () => 'NOW',
    };
    const result = await runEditRender(ID, deps, path.join(dir, 'work'));

    // Status moves in order and ends ready, with the edit version it was made from.
    const statuses = updates.map(u => u['editRender.status']).filter(Boolean);
    assert.deepEqual(statuses, ['downloading', 'rendering', 'saving', 'ready']);
    const last = updates[updates.length - 1];
    assert.equal(last['editRender.error'], null);
    assert.equal(last['editRender.editVersion'], 7);
    assert.equal(last['editRender.driveUrl'], 'https://drive.google.com/file/d/drive-file-1/view');
    assert.equal(last['editRender.folderUrl'], 'https://drive.google.com/drive/folders/folder-04');

    // Every input downloaded exactly once; the intro serves as the outro without a second download.
    assert.deepEqual([...downloads].sort(), [
        e.broll!.images!['0'].path, e.package!.introPath!, e.package!.clipPaths![0],
        e.media!.sourcePath!, e.review!.reviewedPath!,
    ].sort());

    // The video and its words, captions and chapters are saved under editRender/.
    const prefix = `episodes/${ID}/editRender`;
    assert.deepEqual(uploads, {
        [`${prefix}/episode.mp4`]: 'video/mp4',
        [`${prefix}/episode.words.json`]: 'application/json',
        [`${prefix}/episode.srt`]: 'application/x-subrip',
        [`${prefix}/episode.chapters.json`]: 'application/json',
    });
    assert.equal(driveName, 'Test- Episode - One (Editor Light).mp4');

    // Length: teaser 2 + intro 3 + edited (20 - 4 cut) + outro 3 = 24 s.
    const seconds = await probeDuration(path.join(store, `${prefix}/episode.mp4`));
    assert.ok(Math.abs(seconds - 24) < 0.5, `rendered ${seconds}s, expected 24s`);
    assert.ok(Math.abs(result.durationSeconds - 24) < 0.5);
    assert.equal(result.cuts, 1);

    // Times moved onto the rendered video: the cut word is gone, the rest shift by the
    // 4 s cut plus its 40 ms padding on each side (keepRanges), and by the 5 s of teaser
    // and intro in front.
    const words = JSON.parse(fs.readFileSync(path.join(store, `${prefix}/episode.words.json`), 'utf8')) as { text: string; start: number }[];
    assert.deepEqual(words.map(w => w.text), ['hello', 'after']);
    assert.ok(Math.abs(words[1].start - (7000 - 4080 + 5000)) <= 50, `after at ${words[1].start}`);
    const chapters = JSON.parse(fs.readFileSync(path.join(store, `${prefix}/episode.chapters.json`), 'utf8')) as { chapters: { title: string; startMs: number }[] };
    const middle = chapters.chapters.find(c => c.title === 'Middle');
    assert.ok(middle && Math.abs(middle.startMs - (10000 - 4080 + 5000)) <= 50, `Middle at ${middle?.startMs}`);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('job: a failed render never reports ready', async () => {
    const updates: Record<string, unknown>[] = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-render-fail-'));
    const deps: EditRenderDeps = {
        getEpisode: async () => episode({ package: undefined, review: {}, broll: undefined }),
        download: async (_p, dest) => { fs.writeFileSync(dest, ''); },
        upload: async () => { throw new Error('should not upload'); },
        saveToDrive: async () => { throw new Error('should not save'); },
        update: async fields => { updates.push(fields); },
        render: async () => { throw new Error('ffmpeg exited 1'); },
        now: () => 'NOW',
    };
    await assert.rejects(runEditRender(ID, deps, dir), /ffmpeg exited 1/);
    assert.ok(!updates.some(u => u['editRender.status'] === 'ready'));
    fs.rmSync(dir, { recursive: true, force: true });
});
