import { spawn } from 'child_process';
import { PermanentError } from './errors';

function run(cmd: string, args: string[]): Promise<string> {
    return runWithLog(cmd, args).then(r => r.stdout);
}

// Also returns the end of stderr, where ffmpeg's filters print their reports.
function runWithLog(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            // ffmpeg failing on a file is bad input, not a network blip.
            else reject(new PermanentError(`${cmd} exited with ${code}: ${stderr.split('\n').slice(-5).join(' ').trim()}`));
        });
    });
}

export async function probeDuration(file: string): Promise<number> {
    const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const seconds = parseFloat(out.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new PermanentError(`Could not read duration of ${file}`);
    return seconds;
}

// 720p (never upscaled) H.264 preview for the review page and later AI passes.
export function makeProxy(input: string, output: string) {
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
        '-vf', "scale=-2:'min(720,ih)'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output,
    ]);
}

// Mono speech-quality audio: what gets transcribed and what the review page plays.
export function makeAudio(input: string, output: string) {
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
        '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        output,
    ]);
}

// Width and height as displayed (non-square pixels applied).
export async function videoSize(file: string) {
    const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,sample_aspect_ratio', '-of', 'csv=p=0', file]);
    const [w, h, sar] = out.trim().split(',');
    const [sn, sd] = (sar && sar.includes(':') ? sar.split(':').map(Number) : [1, 1]);
    const ratio = sn > 0 && sd > 0 ? sn / sd : 1;
    const width = Math.round(Number(w) * ratio), height = Number(h);
    if (!width || !height) throw new PermanentError(`Could not read the frame size of ${file}`);
    return { width, height };
}

// True when a frame is 16:9 to within half a percent: it fits a 1920x1080 frame with no bars.
export const isWidescreen = ({ width, height }: { width: number; height: number }) => Math.abs(width / height / (16 / 9) - 1) < 0.005;

// Fills a 1920x1080 frame without distortion: square the pixels, scale evenly until both
// sides cover the frame, then trim the overflow equally from the edges.
const FILL_1080 = 'scale=iw*sar:ih,setsar=1,scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1';

// The whole episode, filled to 1920x1080 (for recordings that are not 16:9). Audio untouched.
export function fillFrame(input: string, output: string) {
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', input,
        '-vf', FILL_1080,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        output,
    ]);
}

// libass over the picture, with the fonts in `fontsDir`. Paths are quoted for the filter graph.
function assFilter(ass: string, fontsDir: string) {
    const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    return `ass=filename='${escape(ass)}':fontsdir='${escape(fontsDir)}'`;
}

// A still PNG with a transparent background (the generic "In this episode" banner). libass
// keeps the alpha of what it draws on, so `ass` is drawn on black for the colour and `matte`
// (the same drawing all in white) gives the transparency.
export function assStill(ass: string, matte: string, fontsDir: string, output: string, width = 1920, height = 1080) {
    const black = `color=c=black:s=${width}x${height}:d=1`;
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', black, '-f', 'lavfi', '-i', black,
        '-filter_complex',
        `[0:v]format=rgb24,${assFilter(ass, fontsDir)}[c];[1:v]format=rgb24,${assFilter(matte, fontsDir)},format=gray[m];` +
        '[c][m]alphamerge,unpremultiply=inplace=1,format=rgba[out]',
        '-map', '[out]', '-frames:v', '1',
        output,
    ]);
}

// One clip from the original at full quality, re-encoded so it starts exactly on time
// (a stream copy can only cut on keyframes). `fill` crops it like fillFrame; `burn` draws an
// ASS file over it (the "In this episode" tag).
export function cutClip(input: string, output: string, startSeconds: number, durationSeconds: number, fill = false,
    burn?: { ass: string; fontsDir: string }) {
    const filters = [...(fill ? [FILL_1080] : []), ...(burn ? [assFilter(burn.ass, burn.fontsDir)] : [])];
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', startSeconds.toFixed(3), '-i', input, '-t', durationSeconds.toFixed(3),
        ...(filters.length ? ['-vf', filters.join(',')] : []),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        output,
    ]);
}

// One still, filled to 1280x720, for a thumbnail. `input` may be a URL: seeking before -i
// reads only the part of the file around that moment.
export function grabFrame(input: string, output: string, seconds: number) {
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', seconds.toFixed(3), '-i', input, '-frames:v', '1',
        '-vf', 'scale=iw*sar:ih,setsar=1,scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720',
        '-q:v', '2',
        output,
    ]);
}

// Loudness for the finished episode: -14 LUFS integrated with peaks under -1 dBTP, what
// YouTube and Spotify play at, so nothing is turned down or sounds quiet beside other shows.
export const LOUDNESS = { integrated: -14, truePeak: -1, range: 11 };

interface LoudnormReport { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string; output_i: string; output_tp: string }

function loudnormReport(stderr: string): LoudnormReport {
    const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
    try {
        return JSON.parse(json) as LoudnormReport;
    } catch {
        throw new PermanentError(`Could not read the loudness measurement: ${stderr.slice(-300)}`);
    }
}

// Two passes of ffmpeg's loudnorm: measure, then correct in one linear gain change (no
// pumping). The picture is copied untouched. Returns the loudness before and after, in LUFS.
export async function normalizeLoudness(input: string, output: string) {
    const target = `I=${LOUDNESS.integrated}:TP=${LOUDNESS.truePeak}:LRA=${LOUDNESS.range}`;
    const measured = loudnormReport((await runWithLog('ffmpeg', [
        '-hide_banner', '-nostats', '-i', input, '-vn', '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-',
    ])).stderr);
    const done = loudnormReport((await runWithLog('ffmpeg', [
        '-y', '-hide_banner', '-nostats', '-i', input,
        '-af', `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
            `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
            `:offset=${measured.target_offset}:linear=true:print_format=json`,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-movflags', '+faststart',
        output,
    ])).stderr);
    return { beforeLufs: Number(measured.input_i), afterLufs: Number(done.output_i), truePeak: Number(done.output_tp) };
}

// A short's still backdrop (docs/specs/013-shorts.md): the brand's deep violet, the logo at the
// top and a thin gold rule above and below where the video goes.
export function shortBackground(logo: string, output: string, l: { width: number; height: number; logoSize: number; logoTop: number; videoTop: number; videoHeight: number }) {
    const rule = (y: number) => `drawbox=x=0:y=${y}:w=iw:h=4:color=0xf7c65b@0.85:t=fill`;
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        // #140a2e at the top to #2a1552 at the bottom.
        '-f', 'lavfi', '-i', `color=c=black:s=${l.width}x${l.height}:d=1,format=rgb24,geq=r='20+22*Y/H':g='10+11*Y/H':b='46+36*Y/H'`,
        '-i', logo,
        '-filter_complex',
        `[1:v]scale=${l.logoSize}:${l.logoSize}:flags=lanczos[logo];` +
        `[0:v][logo]overlay=(W-w)/2:${l.logoTop},${rule(l.videoTop - 4)},${rule(l.videoTop + l.videoHeight)}`,
        '-frames:v', '1',
        output,
    ]);
}

// One vertical short: the final cut from `startSeconds`, its sides trimmed to `aspect` (width
// over height), scaled to the frame's width and placed on the backdrop at `videoTop`, with the
// headline, speaker and captions burned in from an ASS file. `input` may be a URL.
export function renderShort(input: string, output: string, o: {
    startSeconds: number; durationSeconds: number; aspect: number; background: string; ass: string; fontsDir: string;
    width: number; videoTop: number;
}) {
    const fadeOut = Math.max(0, o.durationSeconds - 0.25).toFixed(3);
    return run('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-loop', '1', '-framerate', '30', '-i', o.background,
        '-ss', o.startSeconds.toFixed(3), '-t', o.durationSeconds.toFixed(3), '-i', input,
        '-filter_complex',
        // A short rarely starts exactly on a frame, so the first frame after the seek comes a few
        // milliseconds in; without restarting its clock at zero, the first frame of the short
        // (the still the Studio and YouTube show) would have an empty space where the video goes.
        `[1:v]setpts=PTS-STARTPTS,scale=iw*sar:ih,setsar=1,crop='min(iw,trunc(ih*${o.aspect.toFixed(6)}/2)*2)':ih,scale=${o.width}:-2:flags=lanczos,fps=30[v];` +
        `[0:v][v]overlay=0:${o.videoTop}:shortest=1,${assFilter(o.ass, o.fontsDir)},format=yuv420p[out];` +
        `[1:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st=${fadeOut}:d=0.25[a]`,
        '-map', '[out]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-t', o.durationSeconds.toFixed(3),
        '-movflags', '+faststart',
        output,
    ]);
}
