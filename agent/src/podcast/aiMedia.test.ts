// Part H, AI video and music: the Sora and ElevenLabs requests, and a real render (ffmpeg) proving
// an AI video clip replaces the still for its moment and the music bed plays under the episode.
// Run: npx tsx --test agent/src/podcast/aiMedia.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    DEFAULT_MUSIC_PROMPT, MUSIC_MODES, musicMix, musicRequest, SORA_MODEL, SORA_SIZE, soraSeconds, soraUsd, videoPrompt,
} from '../../../lib/aiMedia';
import { DEFAULT_SETTINGS, withDefaults } from '../../../lib/studioSettings';
import { renderEdit } from './editRender';

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const probe = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
// The colour of the middle of the frame at `seconds`, as [r, g, b].
const pixel = (file: string, seconds: number) => [...execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-vf', 'crop=8:8:iw/2:ih/2,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
// The loudest sample in dB (-999 for silence).
function loudest(file: string) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
    return !m || m[1] === '-inf' ? -999 : Number(m[1]);
}

test('settings: video b-roll off and no music by default; the options are kept when valid', () => {
    assert.equal(DEFAULT_SETTINGS.brollVideo, false);
    assert.equal(DEFAULT_SETTINGS.music, 'none');
    assert.equal(DEFAULT_SETTINGS.musicPath, null);
    assert.equal(DEFAULT_SETTINGS.musicPrompt, DEFAULT_MUSIC_PROMPT);
    assert.equal(DEFAULT_SETTINGS.musicVolumeDb, -24);
    assert.deepEqual([...MUSIC_MODES], ['none', 'upload', 'generate']);
    const s = withDefaults({ brollVideo: true, music: 'generate', musicVolumeDb: -18 });
    assert.equal(s.brollVideo, true);
    assert.equal(s.music, 'generate');
    assert.equal(s.musicVolumeDb, -18);
    assert.equal(withDefaults({ music: 'loud', musicVolumeDb: 0 }).music, 'none');
    assert.equal(withDefaults({ musicVolumeDb: 0 }).musicVolumeDb, -24);
});

test('Sora: the clip that covers the moment, its price and prompt', () => {
    assert.equal(SORA_MODEL, 'sora-2');
    assert.equal(SORA_SIZE, '1280x720');
    assert.deepEqual([1, 4, 5, 8, 9, 12, 20].map(soraSeconds), [4, 4, 8, 8, 12, 12, 12]);
    assert.equal(soraUsd(8), 0.8);
    const p = videoPrompt('  A sunrise over the sea.  ');
    assert.ok(p.startsWith('A sunrise over the sea.\n\nMotion: one continuous shot'));
    assert.match(p, /No cuts, no text, no sound\.$/);
});

test('ElevenLabs: an instrumental track, length kept to what the API allows', () => {
    const r = musicRequest('Soft strings', 180_000);
    assert.equal(r.url, 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128');
    assert.deepEqual(r.body, { prompt: 'Soft strings', music_length_ms: 180000, model_id: 'music_v1', force_instrumental: true });
    assert.equal(musicRequest('  ', 1000).body.prompt, DEFAULT_MUSIC_PROMPT);
    assert.equal(musicRequest('x', 1000).body.music_length_ms, 3000);
    assert.equal(musicRequest('x', 9_000_000).body.music_length_ms, 600000);
    const mix = musicMix(5, -24);
    assert.match(mix, /\[5:a\]aformat=sample_rates=48000:channel_layouts=stereo,volume=-24dB/);
    assert.match(mix, /sidechaincompress/);
    assert.match(mix, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[epm\];$/);
});

test('a real render: the AI clip covers its moment and the music plays under a silent episode', { timeout: 300_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimedia-'));
    const video = path.join(dir, 'episode.mp4'), still = path.join(dir, 'still.png'), clip = path.join(dir, 'clip.mp4'), music = path.join(dir, 'music.wav');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '6',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=green:s=800x600', '-frames:v', '1', still]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.5:sample_rate=48000', music]);

    const out = path.join(dir, 'out.mp4');
    await renderEdit({
        video, edit: { cuts: [], version: 1 }, out, clean: 'off',
        broll: [{ atMs: 1000, seconds: 3, image: still, video: clip }],
        music: { file: music, volumeDb: -20 },
    });
    assert.ok(Math.abs(probe(out) - 6) < 0.3, `length ${probe(out)}`);
    const [r, g, b] = pixel(out, 2.5);                 // inside the b-roll, past the 2 s clip: looped, red
    assert.ok(r > 150 && g < 90 && b < 90, `b-roll colour ${[r, g, b]}`);
    const [r2, , b2] = pixel(out, 5.5);                // after the b-roll: the blue episode
    assert.ok(b2 > 150 && r2 < 90, `episode colour ${[r2, b2]}`);
    assert.ok(loudest(out) > -60, `music level ${loudest(out)}`);

    const plain = path.join(dir, 'plain.mp4');
    await renderEdit({ video, edit: { cuts: [], version: 1 }, out: plain, clean: 'off' });
    assert.ok(loudest(plain) < -80, `silent without music ${loudest(plain)}`);
    fs.rmSync(dir, { recursive: true, force: true });
});
