// Editor Light, phase 2 test: generates a 20s test video, renders it with cuts,
// and checks the output length, stream count, and JSON report.
// Run: npx tsx --test agent/src/podcast/editRender.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { keepRanges, editedDuration, editedTime, type Cut, type EpisodeEdit } from '../../../lib/edit';
import { renderEdit } from './editRender';

function run(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    });
}

function probeStreams(file: string): Promise<{ video: number; audio: number; duration: number; audioRate: number }> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,sample_rate', '-of', 'csv=p=0', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', d => out += d);
        child.on('close', () => {
            const lines = out.trim().split('\n');
            let audioRate = 0;
            const video = lines.filter(l => l.startsWith('video')).length;
            const audioLines = lines.filter(l => l.startsWith('audio'));
            if (audioLines.length > 0) audioRate = parseInt(audioLines[0].split(',')[1] || '0', 10);
            const audio = audioLines.length;
            const duration = parseFloat(lines[lines.length - 1]);
            resolve({ video, audio, duration, audioRate });
        });
        child.on('error', reject);
    });
}

// The average colour of one frame, as [r, g, b].
function frameColour(file: string, seconds: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
            '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
        const chunks: Buffer[] = [];
        child.stdout.on('data', d => chunks.push(d));
        child.on('error', reject);
        child.on('close', () => resolve([...Buffer.concat(chunks)].slice(0, 3)));
    });
}
const isBlue = ([r, g, b]: number[]) => b > 200 && r < 60 && g < 60;

test('render with cuts, teasers, intro, outro, b-roll, and --clean light', async () => {
    const dir = path.join(process.env.TMPDIR || '/tmp', 'edit-render-test');
    fs.mkdirSync(dir, { recursive: true });

    // Generate a 20s test video (testsrc + sine).
    const video = path.join(dir, 'episode.mp4');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=duration=20:size=1920x1080:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-shortest',
        video,
    ]);

    // Generate a 2s teaser.
    const teaser = path.join(dir, 'teaser.mp4');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1920x1080:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-shortest',
        teaser,
    ]);

    // Generate a 2s intro.
    const intro = path.join(dir, 'intro.mp4');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1920x1080:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-shortest',
        intro,
    ]);

    // Generate a 1x1 PNG for b-roll.
    const brollImg = path.join(dir, 'broll.png');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=blue:s=1920x1080:d=0.04',
        '-frames:v', '1', brollImg,
    ]);

    // Define three cuts.
    const cuts: Cut[] = [
        { startMs: 3000, endMs: 5000, reason: 'filler' },
        { startMs: 8000, endMs: 9000, reason: 'pause' },
        { startMs: 12000, endMs: 14000, reason: 'manual' },
    ];
    const edit: EpisodeEdit = { cuts, version: 1 };

    // Compute expected edited duration.
    const ranges = keepRanges(20_000, cuts);
    const expectedEditedMs = editedDuration(ranges);
    const expectedTotal = 2000 + 2000 + expectedEditedMs + 2000; // teaser + intro + edited + outro

    // Write the edit JSON.
    const editPath = path.join(dir, 'edit.json');
    fs.writeFileSync(editPath, JSON.stringify(edit));

    const out = path.join(dir, 'output.mp4');
    await renderEdit({
        video,
        edit,
        out,
        teasers: [teaser],
        intro,
        outro: intro, // same file
        broll: [{ atMs: 6000, seconds: 3, image: brollImg }],
        clean: 'light',
        words: [
            { text: 'before', start: 1000, end: 1400 },
            { text: 'gone', start: 8300, end: 8700 },
            { text: 'after', start: 15000, end: 15400 },
        ],
        chapters: [{ title: 'Middle', startMs: 10_000 }],
    });

    // Check output length.
    const probe = await probeStreams(out);
    const diff = Math.abs(probe.duration - expectedTotal / 1000);
    assert.ok(diff < 0.150, `output duration ${probe.duration}s differs from expected ${expectedTotal / 1000}s by ${diff}s`);

    // Check one video stream at 1920x1080.
    assert.equal(probe.video, 1, 'exactly one video stream');

    // Check 48kHz audio.
    assert.equal(probe.audio, 1, 'exactly one audio stream');
    assert.equal(probe.audioRate, 48000, 'audio is 48 kHz');

    // The b-roll (a plain blue still) shows in the middle of its window, on the edited timeline, and not after it.
    const brollStart = 4 + (editedTime(6000, ranges, true) ?? 0) / 1000; // after the 2 s teaser and 2 s intro
    assert.ok(isBlue(await frameColour(out, brollStart + 1.5)), 'b-roll visible mid-window');
    assert.ok(!isBlue(await frameColour(out, brollStart + 3 + 1.5)), 'b-roll gone after its window');

    // Times and captions come straight from the edit: the cut word is gone and the word after
    // the second cut moved by exactly the time removed before it, plus the 4 s teaser and intro.
    const base = out.replace(/\.\w+$/, '');
    const words = JSON.parse(fs.readFileSync(`${base}.words.json`, 'utf8')) as { text: string; start: number }[];
    assert.deepEqual(words.map(w => w.text), ['before', 'after']);
    const expectedAfter = 4000 + (editedTime(15000, ranges) ?? 0);
    assert.ok(Math.abs(words[1].start - expectedAfter) < 100, `'after' at ${words[1].start} ms, expected ${expectedAfter}`);
    assert.ok(fs.readFileSync(`${base}.srt`, 'utf8').startsWith('1'), 'captions file written');
    const times = JSON.parse(fs.readFileSync(`${base}.chapters.json`, 'utf8'));
    assert.equal(times.chapters[0].startMs, 4000 + (editedTime(10_000, ranges) ?? 0));

    // Check the JSON report exists.
    const reportPath = out.replace(/\.\w+$/, '') + '.report.json';
    assert.ok(fs.existsSync(reportPath), 'JSON report exists');
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.ok(reportData.inputSeconds > 0);
    assert.ok(reportData.outputSeconds > 0);
    assert.equal(reportData.cuts, 3);
});

test('block rendering for long episodes', async () => {
    const dir = path.join(process.env.TMPDIR || '/tmp', 'edit-render-block-test');
    fs.mkdirSync(dir, { recursive: true });

    // Generate a 180 s (3 minute) test video (testsrc + sine).
    const video = path.join(dir, 'episode.mp4');
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=duration=180:size=1920x1080:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=180',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-shortest',
        video,
    ]);

    // 30 cuts spread across the 180 s clip, each 2 s wide, every ~6 s.
    const cuts: Cut[] = [];
    for (let i = 0; i < 30; i++) {
        cuts.push({ startMs: i * 6000, endMs: i * 6000 + 2000, reason: 'filler' });
    }
    const edit: EpisodeEdit = { cuts, version: 1 };
    const ranges = keepRanges(180_000, cuts);
    const expectedEditedMs = editedDuration(ranges);

    const out = path.join(dir, 'output.mp4');
    await renderEdit({
        video,
        edit,
        out,
        clean: 'off',
        blockMinutes: 1,
    });

    // Check output length within 200 ms of editedDuration.
    const probe = await probeStreams(out);
    const diff = Math.abs(probe.duration - expectedEditedMs / 1000);
    assert.ok(diff < 0.200, `output duration ${probe.duration}s differs from expected ${expectedEditedMs / 1000}s by ${diff}s`);

    // Exactly one video stream and one audio stream.
    assert.equal(probe.video, 1, 'exactly one video stream');
    assert.equal(probe.audio, 1, 'exactly one audio stream');
});
