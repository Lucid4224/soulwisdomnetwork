// Editor Light (spec 015), Card 5: Auphonic integration.
// Uses Auphonic's API for automatic filler, silence, and cough detection,
// noise reduction, and loudness normalization. When used in detect mode
// ("Export Uncut Audio"), Auphonic returns cut regions (start/end pairs in
// seconds) that we convert to Cut[] for the Editor Light edit model.
// See: https://auphonic.com/help/api/details.html

import * as fs from 'fs';
import type { Cut } from '../../../lib/edit';

const AUPHONIC_API = 'https://auphonic.com/api';

// A cut region from Auphonic's cut-list output, in seconds.
export interface AuphonicRegion {
    start: number;       // seconds
    end: number;         // seconds
    type: 'filler' | 'silence' | 'cough';
}

// Options for auphonicProcess.
export interface AuphonicOptions {
    apiKey?: string;         // defaults to AUPHONIC_API_KEY env var
    detectOnly?: boolean;    // true = "Export Uncut Audio" (detect but don't cut)
    fillerCutting?: boolean; // detect filler words
    silenceCutting?: boolean; // detect silence
    coughCutting?: boolean;  // detect coughs
    noiseReduction?: boolean; // noise reduction
    loudnessTarget?: number;  // LUFS target (default -14)
}

// Converts Auphonic cut regions (in seconds) to Cut[] (in milliseconds).
// Filler and cough regions become 'filler' cuts; silence regions become 'pause' cuts.
export function auphonicCutsToEdit(regions: AuphonicRegion[]): Cut[] {
    return regions.map(r => ({
        startMs: Math.round(r.start * 1000),
        endMs: Math.round(r.end * 1000),
        reason: r.type === 'silence' ? 'pause' as const : 'filler' as const,
    }));
}

// Processes an audio file through Auphonic: creates a production, uploads the
// audio, starts it with the specified algorithms, waits for completion, and
// downloads the cleaned audio and cut regions (when detectOnly is true).
// Returns the path to the cleaned audio and the detected cut regions.
export async function auphonicProcess(
    audioPath: string,
    opts: AuphonicOptions = {},
): Promise<{ cleanedAudio: string; regions: AuphonicRegion[] }> {
    const apiKey = opts.apiKey ?? process.env.AUPHONIC_API_KEY;
    if (!apiKey) throw new Error('AUPHONIC_API_KEY is not set');

    // Names from Auphonic's API docs (help/api/details.html): the cutters and
    // cut_mode live inside `algorithms`; "export_uncut_audio" detects without cutting.
    const algorithms: Record<string, unknown> = {
        cut_mode: opts.detectOnly ? 'export_uncut_audio' : 'apply_cuts',
        loudnesstarget: opts.loudnessTarget ?? -14,
    };
    if (opts.fillerCutting !== false) algorithms.filler_cutter = true;
    if (opts.silenceCutting !== false) algorithms.silence_cutter = true;
    if (opts.coughCutting) algorithms.cough_cutter = true;
    if (opts.noiseReduction !== false) algorithms.denoise = true;

    // Create the production.
    const createBody = {
        algorithms,
        output_files: [
            { format: 'aac', bitrate: '192' },
            { format: 'cut-list', ending: 'ReaperRegions.csv' },
        ],
        action: 'start',
    };

    const createRes = await fetch(`${AUPHONIC_API}/productions.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `bearer ${apiKey}`,
        },
        body: JSON.stringify(createBody),
    });
    if (!createRes.ok) throw new Error(`Auphonic create failed: ${createRes.status}`);
    const createData = await createRes.json() as { data: { uuid: string } };
    const uuid = createData.data.uuid;

    // Upload the audio file.
    const formData = new FormData();
    formData.append('input_file', new Blob([fs.readFileSync(audioPath)]), 'input.mp3');

    const uploadRes = await fetch(`${AUPHONIC_API}/production/${uuid}/upload.json`, {
        method: 'POST',
        headers: { 'Authorization': `bearer ${apiKey}` },
        body: formData,
    });
    if (!uploadRes.ok) throw new Error(`Auphonic upload failed: ${uploadRes.status}`);

    // Wait for the production to finish.
    let status = '';
    let attempts = 0;
    while (status !== 'Done' && attempts < 600) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await fetch(`${AUPHONIC_API}/production/${uuid}.json`, {
            headers: { 'Authorization': `bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`Auphonic status failed: ${res.status}`);
        const data = await res.json() as { data: { status: string; error: string | null } };
        status = data.data.status;
        if (data.data.error) throw new Error(`Auphonic error: ${data.data.error}`);
        attempts++;
    }
    if (status !== 'Done') throw new Error('Auphonic production timed out');

    // Get the output files: the cleaned audio and the cut-list.
    const outRes = await fetch(`${AUPHONIC_API}/production/${uuid}/output.json`, {
        headers: { 'Authorization': `bearer ${apiKey}` },
    });
    if (!outRes.ok) throw new Error(`Auphonic output list failed: ${outRes.status}`);
    const outData = await outRes.json() as { data: Array<{ filename: string; download_url: string }> };

    // Download the cleaned audio (AAC output).
    const audioOut = outData.data.find(f => f.filename.endsWith('.m4a') || f.filename.endsWith('.aac'));
    const cutListOut = outData.data.find(f => /regions\.csv$/i.test(f.filename));

    let cleanedAudio = audioPath;
    if (audioOut) {
        const dlRes = await fetch(audioOut.download_url);
        if (!dlRes.ok) throw new Error(`Auphonic download failed: ${dlRes.status}`);
        const buf = Buffer.from(await dlRes.arrayBuffer());
        cleanedAudio = audioPath.replace(/\.\w+$/, '') + '.cleaned.m4a';
        fs.writeFileSync(cleanedAudio, buf);
    }

    // Parse cut regions from the Reaper regions cut list.
    let regions: AuphonicRegion[] = [];
    if (cutListOut) {
        const dlRes = await fetch(cutListOut.download_url);
        if (!dlRes.ok) throw new Error(`Auphonic cut list download failed: ${dlRes.status}`);
        regions = parseReaperRegions(await dlRes.text());
    }

    return { cleanedAudio, regions };
}

// Reaper times come as plain seconds or as [h:]m:s.ms; returns seconds.
function reaperSeconds(value: string): number {
    const parts = value.trim().split(':').map(Number);
    return parts.reduce((total, part) => total * 60 + part, 0);
}

// Parses Auphonic's "ReaperRegions.csv" cut list (#,Name,Start,End,Length). The region
// name says what was detected; anything not silence or a cough counts as a filler.
export function parseReaperRegions(csv: string): AuphonicRegion[] {
    const regions: AuphonicRegion[] = [];
    for (const line of csv.split(/\r?\n/)) {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 4 || !/^R?\d+$/i.test(cols[0])) continue;
        const start = reaperSeconds(cols[2]), end = reaperSeconds(cols[3]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const name = cols[1].toLowerCase();
        const type: AuphonicRegion['type'] = name.includes('silence') ? 'silence' : name.includes('cough') ? 'cough' : 'filler';
        regions.push({ start, end, type });
    }
    return regions;
}
