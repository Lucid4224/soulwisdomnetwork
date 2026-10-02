// Editor Light (spec 015), phase 2: renders the edited episode as an mp4 with ffmpeg.
// Cuts the episode to keepRanges, joins teasers → intro → edited → outro at 1920x1080 30fps,
// lays b-roll over the edited timeline (using kenBurns from media.ts), cleans audio
// (highpass → afftdn/arnndn → acompressor → normalizeLoudness), and writes a JSON report.
// Run: npx tsx agent/src/podcast/editRender.ts --video in.mp4 --edit edit.json --out out.mp4 ...

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { keepRanges, editedDuration, editedTime, editedWords, applyToChapters, applyToQuotes, type EpisodeEdit } from '../../../lib/edit';
import { buildCues, toSrt } from '../../../lib/captions';
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

// Per-range audio filter chain (same cleanup and fades for blocks and single-pass).
function audioFilter(clean: string, noiseModel: string | undefined, segDur: number, fadeSecs: number): string {
    let af = `atrim=duration=${segDur.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (clean !== 'off' && clean !== 'auphonic') {
        af += ',highpass=f=80';
        if (clean === 'strong' && noiseModel) af += `,arnndn=model=${noiseModel}`;
        else af += ',afftdn=nr=12';
        af += ',acompressor=threshold=-20dB:ratio=2:attack=5:release=50';
    }
    af += ',aformat=sample_rates=48000:channel_layouts=stereo';
    if (segDur > fadeSecs * 2)
        af += `,afade=t=in:d=${fadeSecs},afade=t=out:st=${(segDur - fadeSecs).toFixed(3)}:d=${fadeSecs}`;
    return af;
}

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
    clean?: 'off' | 'light' | 'strong' | 'auphonic';
    detect?: 'auphonic';
    noiseModel?: string;
    blockMinutes?: number;
    words?: { text: string; start: number; end: number }[];
    chapters?: { title: string; startMs: number }[];
    quotes?: { text: string; speaker: string; startMs: number; endMs: number }[];
}): Promise<RenderReport> {
    const start = Date.now();
    const clean = opts.clean ?? 'light';
    const blockMinutes = opts.blockMinutes ?? 15;
    const inSeconds = await probeDuration(opts.video);
    const inMs = Math.round(inSeconds * 1000);
    let ranges = keepRanges(inMs, opts.edit.cuts);
    let editedMs = editedDuration(ranges);
    const fadeSecs = 0.015;

    // Auphonic, run once when it detects cuts, cleans the voice, or both.
    let cleanedAudio: string | null = null;
    if (opts.detect === 'auphonic' || clean === 'auphonic') {
        const { auphonicProcess, auphonicCutsToEdit } = await import('./auphonic');
        const result = await auphonicProcess(opts.video, {
            detectOnly: true,
            fillerCutting: true,
            silenceCutting: true,
            coughCutting: true,
            noiseReduction: clean === 'auphonic',
        });
        if (clean === 'auphonic') cleanedAudio = result.cleanedAudio;
        if (opts.detect === 'auphonic') {
            ranges = keepRanges(inMs, [...opts.edit.cuts, ...auphonicCutsToEdit(result.regions)]);
            editedMs = editedDuration(ranges);
        }
    }

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

    // ── Block rendering ──────────────────────────────────────────────────────
    // Use blocks whenever there is more than one kept range. Each range gets its
    // own seeked input; blocks are .mkv with pcm_s16le audio, joined with the
    // concat demuxer. The joined file feeds the teasers/intro/b-roll/outro/loudness.
    const useBlocks = ranges.length > 1;
    let episodeVideoForAssembly = opts.video;
    let blockDir = '';

    if (useBlocks) {
        blockDir = path.join(path.dirname(opts.out), `_blocks_${Date.now()}`);
        fs.mkdirSync(blockDir, { recursive: true });

        // Group ranges into blocks: accumulate source duration until blockMinutes.
        type Block = { ranges: typeof ranges };
        const blocks: Block[] = [];
        let curBlock: Block = { ranges: [] };
        let blockMs = 0;
        for (const r of ranges) {
            const rDur = r.endMs - r.startMs;
            if (blockMs + rDur > blockMinutes * 60 * 1000 && curBlock.ranges.length > 0) {
                blocks.push(curBlock);
                curBlock = { ranges: [] };
                blockMs = 0;
            }
            curBlock.ranges.push(r);
            blockMs += rDur;
        }
        if (curBlock.ranges.length > 0) blocks.push(curBlock);

        // Render each block: each range gets its own seeked input.
        const blockFiles: string[] = [];
        for (let bi = 0; bi < blocks.length; bi++) {
            const block = blocks[bi];
            const blockFile = path.join(blockDir, `block_${bi}.mkv`);

            const blockArgs: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
            let bFilter = '';
            const bSegV: string[] = [];
            const bSegA: string[] = [];
            for (let i = 0; i < block.ranges.length; i++) {
                const r = block.ranges[i];
                const segDur = (r.endMs - r.startMs) / 1000;
                const seekStart = (r.startMs / 1000).toFixed(3);
                const seekLen = (segDur + 1).toFixed(3);
                // Video input: seeked from the original video.
                blockArgs.push('-ss', seekStart, '-t', seekLen, '-i', opts.video);
                // Audio input: seeked from cleaned audio (when present) or the original video.
                if (cleanedAudio) {
                    blockArgs.push('-ss', seekStart, '-t', seekLen, '-i', cleanedAudio);
                }
                const vIdx = i * (cleanedAudio ? 2 : 1);
                const aIdx = cleanedAudio ? vIdx + 1 : vIdx;
                bFilter += `[${vIdx}:v]trim=duration=${segDur.toFixed(3)},setpts=PTS-STARTPTS,${FILL_1080},format=yuv420p[bsv${i}];`;
                bFilter += `[${aIdx}:a]${audioFilter(clean, opts.noiseModel, segDur, fadeSecs)}[bsa${i}];`;
                bSegV.push(`bsv${i}`);
                bSegA.push(`bsa${i}`);
            }

            // Concat this block's segments (video and audio interleaved: v0,a0,v1,a1,...).
            const interleaved: string[] = [];
            for (let i = 0; i < bSegV.length; i++) { interleaved.push(bSegV[i]); interleaved.push(bSegA[i]); }
            bFilter += `${interleaved.map(l => `[${l}]`).join('')}concat=n=${bSegV.length}:v=1:a=1[bov][boa];`;

            blockArgs.push('-filter_complex', bFilter, '-map', '[bov]', '-map', '[boa]');
            blockArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30');
            blockArgs.push('-c:a', 'pcm_s16le', '-ar', '48000', blockFile);
            await run('ffmpeg', blockArgs);
            blockFiles.push(blockFile);
        }

        // Join the blocks with the concat demuxer.
        const concatList = path.join(blockDir, 'concat.txt');
        fs.writeFileSync(concatList, blockFiles.map(f => `file '${f}'`).join('\n') + '\n');
        const joinedFile = path.join(blockDir, 'joined.mkv');
        await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'concat', '-safe', '0', '-i', concatList,
            '-c', 'copy', joinedFile]);

        episodeVideoForAssembly = joinedFile;
        for (const bf of blockFiles) { try { fs.unlinkSync(bf); } catch {} }
    }

    // ── Assembly pass: teasers, intro, episode, b-roll, outro, loudness ──────
    // When blocks are used, the episode sound comes from the joined file — do not
    // add the cleaned audio as a separate input here.
    try {
        const inputs: string[] = [];
        let idx = 0;
        const teasers = opts.teasers ?? [];
        const teaserIdxs: number[] = [];
        for (const t of teasers) { inputs.push(t); teaserIdxs.push(idx++); }
        const introIdx = opts.intro ? (inputs.push(opts.intro), idx++) : -1;
        const episodeIdx = idx++; inputs.push(episodeVideoForAssembly);
        const outroIdx = opts.outro ? (inputs.push(opts.outro), idx++) : -1;
        const episodeAudioIdx = (!useBlocks && cleanedAudio) ? (inputs.push(cleanedAudio), idx++) : episodeIdx;
        const brollIdxs: number[] = [];
        for (const bf of brollFiles) { if (bf) { inputs.push(bf); brollIdxs.push(idx++); } else brollIdxs.push(-1); }

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

        // Episode segments.
        const segV: string[] = [];
        const segA: string[] = [];
        if (useBlocks) {
            filter += `[${episodeIdx}:v]${FILL_1080},format=yuv420p[sv0];`;
            filter += `[${episodeIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo[sa0];`;
            segV.push('sv0');
            segA.push('sa0');
        } else {
            for (let i = 0; i < ranges.length; i++) {
                const r = ranges[i];
                const segDur = (r.endMs - r.startMs) / 1000;
                filter += `[${episodeIdx}:v]trim=duration=${segDur.toFixed(3)},setpts=PTS-STARTPTS,${FILL_1080},format=yuv420p[sv${i}];`;
                filter += `[${episodeAudioIdx}:a]${audioFilter(clean, opts.noiseModel, segDur, fadeSecs)}[sa${i}];`;
                segV.push(`sv${i}`);
                segA.push(`sa${i}`);
            }
        }

        // Concat episode segments (video and audio interleaved: v0,a0,v1,a1,...).
        if (segV.length > 0) {
            if (useBlocks) {
                filter += `[sv0][sa0]concat=n=1:v=1:a=1[epv][epa];`;
            } else {
                const interleave: string[] = [];
                for (let i = 0; i < segV.length; i++) { interleave.push(segV[i]); interleave.push(segA[i]); }
                filter += `${interleave.map(l => `[${l}]`).join('')}concat=n=${segV.length}:v=1:a=1[epv][epa];`;
            }
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
            const startSec = at / 1000;
            const endSec = startSec + b.seconds;
            const fadeDur = 0.5;
            const br = `br${bi}`;
            const next = `ep${bi + 1}`;
            filter += `[${brollIdxs[i]}:v]setpts=PTS-STARTPTS+${startSec}/TB,format=yuv420p,fade=t=in:st=${startSec.toFixed(3)}:d=${fadeDur}:alpha=1,fade=t=out:st=${(endSec - fadeDur).toFixed(3)}:d=${fadeDur}:alpha=1[${br}];`;
            filter += `[${epV}][${br}]overlay=x=0:y=0:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})':eof_action=pass,format=yuv420p[${next}];`;
            epV = next;
            bi++;
        }

        // Final concat: teasers → intro → episode → outro (video and audio interleaved).
        const allV: string[] = [];
        const allA: string[] = [];
        for (let i = 0; i < teaserLabels.length; i += 2) { allV.push(teaserLabels[i]); allA.push(teaserLabels[i + 1]); }
        if (introIdx >= 0) { allV.push('intv'); allA.push('inta'); }
        allV.push(epV); allA.push('epa');
        if (outroIdx >= 0) { allV.push('outv'); allA.push('outa'); }
        const finalInterleave: string[] = [];
        for (let i = 0; i < allV.length; i++) { finalInterleave.push(allV[i]); finalInterleave.push(allA[i]); }
        filter += `${finalInterleave.map(l => `[${l}]`).join('')}concat=n=${allV.length}:v=1:a=1[outv][outa];`;

        // Run ffmpeg.
        const rawOut = opts.out + '.raw.mp4';
        const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
        for (const inp of inputs) args.push('-i', inp);
        args.push('-filter_complex', filter, '-map', '[outv]', '-map', '[outa]');
        args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30');
        args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', rawOut);
        await run('ffmpeg', args);

        // Loudness normalization as a separate two-pass.
        if (clean !== 'off') {
            await normalizeLoudness(rawOut, opts.out);
            try { fs.unlinkSync(rawOut); } catch {}
        } else {
            fs.renameSync(rawOut, opts.out);
        }

        const outSecs = await probeDuration(opts.out);
        const report: RenderReport = {
            inputSeconds: inSeconds,
            outputSeconds: outSecs,
            cuts: opts.edit.cuts.length,
            timeSavedSeconds: Math.max(0, inSeconds - (editedMs / 1000)),
            renderSeconds: (Date.now() - start) / 1000,
        };
        const base = opts.out.replace(/\.\w+$/, '');
        if (opts.words?.length || opts.chapters?.length || opts.quotes?.length) {
            let offsetMs = 0;
            for (const f of [...(opts.teasers ?? []), ...(opts.intro ? [opts.intro] : [])]) offsetMs += Math.round((await probeDuration(f)) * 1000);
            const shift = <T extends { startMs: number; endMs?: number }>(x: T): T =>
                ({ ...x, startMs: x.startMs + offsetMs, ...(x.endMs !== undefined ? { endMs: x.endMs + offsetMs } : {}) });
            if (opts.words?.length) {
                const words = editedWords(opts.words, ranges, offsetMs);
                fs.writeFileSync(`${base}.words.json`, JSON.stringify(words));
                fs.writeFileSync(`${base}.srt`, toSrt(buildCues(words)));
            }
            fs.writeFileSync(`${base}.chapters.json`, JSON.stringify({
                chapters: applyToChapters(opts.chapters ?? [], ranges).map(shift),
                quotes: applyToQuotes(opts.quotes ?? [], ranges).map(shift),
            }, null, 2));
        }
        const reportPath = `${base}.report.json`;
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        return report;
    } finally {
        // Clean up temp directories so failed runs leave nothing behind.
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
        if (blockDir) { try { fs.rmSync(blockDir, { recursive: true }); } catch {} }
    }
}

// ─── command line ────────────────────────────────────────────────────────────

interface ParsedArgs {
    video?: string; editPath?: string; out?: string;
    teasers: string[]; intro?: string; outro?: string;
    broll: BrollArg[]; clean: 'off' | 'light' | 'strong' | 'auphonic'; detect?: 'auphonic'; noiseModel?: string; blockMinutes?: number;
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
            case '--clean': args.clean = argv[++i] as 'off' | 'light' | 'strong' | 'auphonic'; break;
            case '--detect': args.detect = argv[++i] as 'auphonic'; break;
            case '--noise-model': args.noiseModel = argv[++i]; break;
            case '--block-minutes': args.blockMinutes = Number(argv[++i]); break;
        }
    }
    return args;
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    if (!args.video || !args.editPath || !args.out) {
        console.error('Usage: editRender.ts --video in.mp4 --edit edit.json --out out.mp4 [--teaser a.mp4] [--intro intro.mp4] [--outro outro.mp4] [--broll json] [--clean off|light|strong] [--block-minutes N]');
        process.exit(1);
    }
    const edit: EpisodeEdit & Pick<Parameters<typeof renderEdit>[0], 'words' | 'chapters' | 'quotes'> =
        JSON.parse(fs.readFileSync(args.editPath, 'utf8'));
    renderEdit({
        video: args.video, edit, out: args.out,
        teasers: args.teasers.length ? args.teasers : undefined,
        intro: args.intro, outro: args.outro,
        broll: args.broll.length ? args.broll : undefined,
        clean: args.clean, detect: args.detect, noiseModel: args.noiseModel,
        blockMinutes: args.blockMinutes,
        words: edit.words, chapters: edit.chapters, quotes: edit.quotes,
    }).then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(e => { console.error('Render failed:', e); process.exit(1); });
}
