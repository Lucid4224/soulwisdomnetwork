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
    // The accepted transcript and show-note times, when known: their new times are written
    // next to the output, so the final cut never has to be transcribed again.
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

    // Auphonic, run once when it detects cuts, cleans the voice, or both. It works in
    // "export_uncut_audio" mode, so its cleaned audio keeps the original timing and
    // the cuts above still line up with it.
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

    // ── Block rendering for long episodes ───────────────────────────────────
    // When the episode is longer than blockMinutes and has more than one kept range,
    // group ranges into blocks spanning at most blockMinutes of source each.
    // Render each block in its own ffmpeg call (as .mkv with pcm_s16le audio),
    // then join the blocks with the concat demuxer. The joined file becomes the
    // episode video for the teasers, intro, b-roll, outro and loudness steps.
    const useBlocks = inSeconds > blockMinutes * 60 && ranges.length > 1;

    // The episode video that teasers/intro/b-roll/outro/loudness operate on.
    // For short episodes this is opts.video. For long episodes with blocks,
    // this is the joined-blocks file (which has the same edited timing as the
    // single-pass would produce, since the blocks are just the kept ranges
    // concatenated in order).
    let episodeVideoForAssembly = opts.video;
    let blockDir = '';

    if (useBlocks) {
        blockDir = path.join(path.dirname(opts.out), `_blocks_${Date.now()}`);
        fs.mkdirSync(blockDir, { recursive: true });

        // Group ranges into blocks: accumulate source duration until blockMinutes.
        type Block = { ranges: typeof ranges; sourceMs: number };
        const blocks: Block[] = [];
        let current: Block = { ranges: [], sourceMs: 0 };
        for (const r of ranges) {
            const rDur = r.endMs - r.startMs;
            if (current.sourceMs + rDur > blockMinutes * 60 * 1000 && current.ranges.length > 0) {
                blocks.push(current);
                current = { ranges: [], sourceMs: 0 };
            }
            current.ranges.push(r);
            current.sourceMs += rDur;
        }
        if (current.ranges.length > 0) blocks.push(current);

        // Render each block as .mkv with pcm_s16le audio.
        const blockFiles: string[] = [];
        for (let bi = 0; bi < blocks.length; bi++) {
            const block = blocks[bi];
            const blockFile = path.join(blockDir, `block_${bi}.mkv`);

            // Build the filter for this block's ranges (same trims, cleanup, fades).
            let blockFilter = '';
            const bSegV: string[] = [];
            const bSegA: string[] = [];
            for (let i = 0; i < block.ranges.length; i++) {
                const r = block.ranges[i];
                const s = (r.startMs / 1000).toFixed(3);
                const e = (r.endMs / 1000).toFixed(3);
                blockFilter += `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,${FILL_1080},format=yuv420p[bsv${i}];`;
                let af = `atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS`;
                if (clean !== 'off' && clean !== 'auphonic') {
                    af += ',highpass=f=80';
                    if (clean === 'strong' && opts.noiseModel) af += `,arnndn=model=${opts.noiseModel}`;
                    else af += ',afftdn=nr=12';
                    af += ',acompressor=threshold=-20dB:ratio=2:attack=5:release=50';
                }
                af += ',aformat=sample_rates=48000:channel_layouts=stereo';
                const segDur = (r.endMs - r.startMs) / 1000;
                if (segDur > fadeSecs * 2)
                    af += `,afade=t=in:d=${fadeSecs},afade=t=out:st=${(segDur - fadeSecs).toFixed(3)}:d=${fadeSecs}`;
                // Use the cleaned audio input when available, else the original video's audio.
                const aInput = cleanedAudio ? 1 : 0;
                blockFilter += `[${aInput}:a]${af}[bsa${i}];`;
                bSegV.push(`bsv${i}`);
                bSegA.push(`bsa${i}`);
            }

            // Concat this block's segments.
            blockFilter += `${bSegV.map(l => `[${l}]`).join('')}concat=n=${bSegV.length}:v=1:a=0[bov];`;
            blockFilter += `${bSegA.map(l => `[${l}]`).join('')}concat=n=${bSegA.length}:v=0:a=1[boa];`;

            const blockArgs: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
            blockArgs.push('-i', opts.video);
            if (cleanedAudio) blockArgs.push('-i', cleanedAudio);
            blockArgs.push('-filter_complex', blockFilter, '-map', '[bov]', '-map', '[boa]');
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

        // The joined file is the edited episode (no teasers/intro/outro yet).
        // It replaces opts.video for the assembly steps below.
        episodeVideoForAssembly = joinedFile;

        // Clean up block files after joining (keep joinedFile for the assembly).
        // Block files are deleted after the concat; joinedFile is deleted after the final render.
        for (const bf of blockFiles) { try { fs.unlinkSync(bf); } catch {} }
    }

    // Gather all inputs.
    const inputs: string[] = [];
    let idx = 0;
    const teasers = opts.teasers ?? [];
    const teaserIdxs: number[] = [];
    for (const t of teasers) { inputs.push(t); teaserIdxs.push(idx++); }
    const introIdx = opts.intro ? (inputs.push(opts.intro), idx++) : -1;
    const episodeIdx = idx++; inputs.push(episodeVideoForAssembly);
    const outroIdx = opts.outro ? (inputs.push(opts.outro), idx++) : -1;
    // With --clean auphonic the episode's sound comes from Auphonic's cleaned audio.
    const episodeAudioIdx = cleanedAudio ? (inputs.push(cleanedAudio), idx++) : episodeIdx;
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
    // When blocks were used, the joined file is already the edited episode
    // (contiguous 0 to editedMs), so we just pass it through. Otherwise we
    // trim the original video into kept-range segments.
    const segV: string[] = [];
    const segA: string[] = [];
    if (useBlocks) {
        // The joined file is already the edited episode — pass it through as-is.
        filter += `[${episodeIdx}:v]${FILL_1080},format=yuv420p[sv0];`;
        filter += `[${episodeAudioIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo[sa0];`;
        segV.push('sv0');
        segA.push('sa0');
    } else {
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const s = (r.startMs / 1000).toFixed(3);
        const e = (r.endMs / 1000).toFixed(3);
        filter += `[${episodeIdx}:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS,${FILL_1080},format=yuv420p[sv${i}];`;
        let af = `atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS`;
        if (clean !== 'off' && clean !== 'auphonic') {
            af += ',highpass=f=80';
            if (clean === 'strong' && opts.noiseModel) af += `,arnndn=model=${opts.noiseModel}`;
            else af += ',afftdn=nr=12';
            af += ',acompressor=threshold=-20dB:ratio=2:attack=5:release=50';
        }
        af += ',aformat=sample_rates=48000:channel_layouts=stereo';
        const segDur = (r.endMs - r.startMs) / 1000;
        if (segDur > fadeSecs * 2)
            af += `,afade=t=in:d=${fadeSecs},afade=t=out:st=${(segDur - fadeSecs).toFixed(3)}:d=${fadeSecs}`;
        filter += `[${episodeAudioIdx}:a]${af}[sa${i}];`;
        segV.push(`sv${i}`);
        segA.push(`sa${i}`);
    }
    } // end else (not useBlocks)

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
        const startSec = at / 1000;
        const endSec = startSec + b.seconds;
        const fadeDur = 0.5;
        const br = `br${bi}`;
        const next = `ep${bi + 1}`;
        // Shift the b-roll clip to start at the edited time, with 0.5s alpha fade in and out.
        filter += `[${brollIdxs[i]}:v]setpts=PTS-STARTPTS+${startSec}/TB,format=yuv420p,fade=t=in:st=${startSec.toFixed(3)}:d=${fadeDur}:alpha=1,fade=t=out:st=${(endSec - fadeDur).toFixed(3)}:d=${fadeDur}:alpha=1[${br}];`;
        filter += `[${epV}][${br}]overlay=x=0:y=0:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})':eof_action=pass,format=yuv420p[${next}];`;
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
    // Loudness for the whole programme (teasers and intro included) unless cleanup is off.
    if (clean !== 'off') {
        await normalizeLoudness(rawOut, opts.out);
        try { fs.unlinkSync(rawOut); } catch {}
    } else {
        fs.renameSync(rawOut, opts.out);
    }

    // Cleanup b-roll and block temp.
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    if (useBlocks && blockDir) {
        try { fs.rmSync(blockDir, { recursive: true }); } catch {}
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
        // Everything before the episode (teasers, then the intro) pushes its times later.
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
        console.error('Usage: editRender.ts --video in.mp4 --edit edit.json --out out.mp4 [--teaser a.mp4] [--intro intro.mp4] [--outro outro.mp4] [--broll json] [--clean off|light|strong]');
        process.exit(1);
    }
    // The edit file may also carry "words", "chapters" and "quotes" for the new times.
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
