// Editor Light (spec 015), phase 2: renders the edited episode as an mp4 with ffmpeg.
// Cuts the episode to keepRanges, joins teasers → intro → edited → outro at 1920x1080 30fps,
// lays b-roll over the edited timeline (using kenBurns from media.ts), cleans audio
// (highpass → afftdn/arnndn → acompressor → normalizeLoudness), and writes a JSON report.
// Run: npx tsx agent/src/podcast/editRender.ts --video in.mp4 --edit edit.json --out out.mp4 ...

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { keepRanges, editedTime, type EpisodeEdit } from '../../../lib/edit';
import { kenBurns, normalizeLoudness, probeDuration } from './media';

// ─── helpers ───────────────────────────────────────────────────────────────

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-800)}`));
        });
    });
}

const FILL_1080 = 'scale=iw*sar:ih,setsar=1,scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1';

// ─── types ──────────────────────────────────────────────────────────────────

interface BrollArg { atMs: number; seconds: number; image: string }

interface RenderReport {
    inputSeconds: number;
    outputSeconds: number;
    cuts: number;
    timeSavedSeconds: number;
    renderSeconds: number;
}

// ─── the render ─────────────────────────────────────────────────────────────

export async function renderEdit(opts: {
    video: string;
    edit: EpisodeEdit;
    out: string;
    teasers?: string[];
    intro?: string;
    outro?: string;
    broll?: BrollArg[];
    clean?: 'off' | 'light' | 'strong';
    noiseModel?: string;
}): Promise<RenderReport> {
    const start = Date.now();
    const clean = opts.clean ?? 'light';
    const inSeconds = await probeDuration(opts.video);
    const inMs = Math.round(inSeconds * 1000);
    const ranges = keepRanges(inMs, opts.edit.cuts);
    const fadeSecs = 0.015;

    // Pre-render b-roll clips with kenBurns to temp files.
    const tmpDir = path.join(path.dirname(opts.out), `_broll_${Date.now()}`);
    const brollFiles: string[] = [];
    if (opts.broll) {
        fs.mkdirSync(tmpDir, { recursive: true });
        for (let i = 0; i < opts.broll.length; i++) {
            const b = opts.broll[i];
            const editedAt = editedTime(b.atMs, ranges, true);
            if (editedAt === null) { brollFiles.push(''); continue; }
            const brollOut = path.join(tmpDir, `broll_${i}.mp4`);
            await kenBurns(b.image, brollOut, b.seconds, 'in', 30);
            brollFiles.push(brollOut);
        }
    }

    // Gather all inputs.
    const inputs: string[] = [];
    let idx = 0;
    const teasers = opts.teasers ?? [];
    const teaserIdxs: number[] = [];
    for (const t of teasers) { inputs.push(t); teaserIdxs.push(idx++); }
    const introIdx = opts.intro ? (inputs.push(opts.intro), idx++) : -1;
    const episodeIdx = idx++; inputs.push(opts.video);
    const outroIdx = opts.outro ? (inputs.push(opts.outro), idx++) : -1;
    const brollIdxs: number[] = [];
    for (const bf of brollFiles) { if (bf) { inputs.push(bf); brollIdxs.push(idx++); } else brollIdxs.push(-1); }

    // Build filter graph.
    let filter = '';

    // Teasers.
    const teaserLabels: string[] = [];
    for (let i = 0; i < teaserIdxs.length; i++) {
        filter += `[${teaserIdxs[i]}:v]${FILL_1080},format=yuv420p[tv${i}];`;
        filter += `[${teaserIdxs[i]}:a]aformat=sample_rates=48000:channel_layouts=stereo[ta${i}];`;
        teaserLabels.push(`tv${i}`, `ta${i}`);
    }

    // Intro + outro.
    if (introIdx >= 0) {
        filter += `[${introIdx}:v]${FILL_1080},format=yuv420p[intv];`;
        filter += `[${introIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo[inta];`;
    }
    if (outroIdx >= 0) {
        filter += `[${outroIdx}:v]${FILL_1080},format=yuv420p[outv];`;
        filter += `[${outroIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo[outa];`;
    }

    // Episode segments with audio cleanup.
    const segV: string[] = [];
    const segA: string[] = [];
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const s = (r.startMs / 1000).toFixed(3);
        const e = (r.endMs / 1000).toFixed(3);
        filter += `[${episodeIdx}:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,${FILL_1080},format=yuv420p[sv${i}];`;
        let af = `atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS`;
        if (clean !== 'off') {
            af += ',highpass=f=80';
            if (clean === 'strong' && opts.noiseModel) af += `,arnndn=model=${opts.noiseModel}`;
            else af += ',afftdn=nr=12';
            af += ',acompressor=threshold=-20dB:ratio=2:attack=5:release=50';
        }
        af += ',aformat=sample_rates=48000:channel_layouts=stereo';
        const segDur = (r.endMs - r.startMs) / 1000;
        if (segDur > fadeSecs * 2)
            af += `,afade=t=in:d=${fadeSecs},afade=t=out:st=${(segDur - fadeSecs).toFixed(3)}:d=${fadeSecs}`;
        filter += `[${episodeIdx}:a]${af}[sa${i}];`;
        segV.push(`sv${i}`);
        segA.push(`sa${i}`);
    }

    // Concat episode segments.
    if (segV.length > 0) {
        filter += `${segV.map(l => `[${l}]`).join('')}concat=n=${segV.length}:v=1:a=0[epv];`;
        filter += `${segA.map(l => `[${l}]`).join('')}concat=n=${segA.length}:v=0:a=1[epa];`;
    } else {
        filter += `color=c=black:s=1920x1080:d=0.04,format=yuv420p[epv];`;
        filter += `anullsrc=channel_layout=stereo:sample_rate=48000:d=0.04[epa];`;
    }

    // B-roll overlays.
    let epV = 'epv';
    let bi = 0;
    for (let i = 0; i < (opts.broll ?? []).length; i++) {
        if (brollIdxs[i] < 0) continue;
        const b = opts.broll![i];
        const at = editedTime(b.atMs, ranges, true);
        if (at === null) continue;
        const s0 = (at / 1000).toFixed(3);
        const s1 = (at / 1000 + b.seconds).toFixed(3);
        const br = `br${bi}`;
        const next = `ep${bi + 1}`;
        filter += `[${brollIdxs[i]}:v]format=yuv420p[${br}];`;
        filter += `[${epV}][${br}]overlay=x=0:y=0:enable='between(t,${s0},${s1})':eof_action=pass,format=yuv420p[${next}];`;
        epV = next;
        bi++;
    }

    // Final concat: teasers → intro → episode → outro.
    const allV: string[] = [];
    const allA: string[] = [];
    for (let i = 0; i < teaserLabels.length; i += 2) { allV.push(teaserLabels[i]); allA.push(teaserLabels[i + 1]); }
    if (introIdx >= 0) { allV.push('intv'); allA.push('inta'); }
    allV.push(epV); allA.push('epa');
    if (outroIdx >= 0) { allV.push('outv'); allA.push('outa'); }
    filter += `${allV.map(l => `[${l}]`).join('')}concat=n=${allV.length}:v=1:a=0[outv];`;
    filter += `${allA.map(l => `[${l}]`).join('')}concat=n=${allA.length}:v=0:a=1[outa];`;

    // Run ffmpeg (no loudnorm in filter — normalizeLoudness runs as a separate pass).
    const rawOut = opts.out + '.raw.mp4';
    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
    for (const inp of inputs) args.push('-i', inp);
    args.push('-filter_complex', filter, '-map', '[outv]', '-map', '[outa]');
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30');
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', rawOut);
    await run('ffmpeg', args);

    // Loudness normalization as a separate two-pass (per media.ts normalizeLoudness).
    if (opts.clean !== 'off') {
        await normalizeLoudness(rawOut, opts.out);
        try { fs.unlinkSync(rawOut); } catch {}
    } else {
        fs.renameSync(rawOut, opts.out);
    }

    // Cleanup b-roll temp.
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

    const outSecs = await probeDuration(opts.out);
    const report: RenderReport = {
        inputSeconds: inSeconds,
        outputSeconds: outSecs,
        cuts: opts.edit.cuts.length,
        timeSavedSeconds: Math.max(0, inSeconds - outSecs),
        renderSeconds: (Date.now() - start) / 1000,
    };
    const reportPath = opts.out.replace(/\.\w+$/, '') + '.report.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return report;
}

// ─── command line ────────────────────────────────────────────────────────────

interface ParsedArgs {
    video?: string; editPath?: string; out?: string;
    teasers: string[]; intro?: string; outro?: string;
    broll: BrollArg[]; clean: 'off' | 'light' | 'strong'; noiseModel?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args: ParsedArgs = { teasers: [], broll: [], clean: 'light' };
    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--video': args.video = argv[++i]; break;
            case '--edit': args.editPath = argv[++i]; break;
            case '--out': args.out = argv[++i]; break;
            case '--teaser': args.teasers.push(argv[++i]); break;
            case '--intro': args.intro = argv[++i]; break;
            case '--outro': args.outro = argv[++i]; break;
            case '--broll': args.broll.push(JSON.parse(argv[++i])); break;
            case '--clean': args.clean = argv[++i] as 'off' | 'light' | 'strong'; break;
            case '--noise-model': args.noiseModel = argv[++i]; break;
        }
    }
    return args;
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    if (!args.video || !args.editPath || !args.out) {
        console.error('Usage: editRender.ts --video in.mp4 --edit edit.json --out out.mp4 [--teaser a.mp4] [--intro intro.mp4] [--outro outro.mp4] [--broll json] [--clean off|light|strong]');
        process.exit(1);
    }
    const edit: EpisodeEdit = JSON.parse(fs.readFileSync(args.editPath, 'utf8'));
    renderEdit({
        video: args.video, edit, out: args.out,
        teasers: args.teasers.length ? args.teasers : undefined,
        intro: args.intro, outro: args.outro,
        broll: args.broll.length ? args.broll : undefined,
        clean: args.clean, noiseModel: args.noiseModel,
    }).then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(e => { console.error('Render failed:', e); process.exit(1); });
}
