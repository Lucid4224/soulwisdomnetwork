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

    const cutMode = opts.detectOnly ? 'export_uncut_audio' : 'apply_cuts';
    const algorithms: Record<string, unknown> = {
        normloudness: true,
        loudnesstarget: opts.loudnessTarget ?? -14,
    };
    if (opts.fillerCutting !== false) algorithms.fillercutting = true;
    if (opts.silenceCutting !== false) algorithms.silencecutting = true;
    if (opts.coughCutting) algorithms.coughcutting = true;
    if (opts.noiseReduction !== false) {
        algorithms.denoise = true;
        algorithms.denoiseamount = 50;
    }

    // Create the production.
    const createBody = {
        algorithms,
        cut_mode: cutMode,
        output_files: [
            { format: 'aac', bitrate: '192' },
            { format: 'cut-list', ending: 'cut-list.json' },
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
    const cutListOut = outData.data.find(f => f.filename.includes('cut-list'));

    let cleanedAudio = audioPath;
    if (audioOut) {
        const dlRes = await fetch(audioOut.download_url);
        if (!dlRes.ok) throw new Error(`Auphonic download failed: ${dlRes.status}`);
        const buf = Buffer.from(await dlRes.arrayBuffer());
        cleanedAudio = audioPath.replace(/\.\w+$/, '') + '.cleaned.m4a';
        fs.writeFileSync(cleanedAudio, buf);
    }

    // Parse cut regions from the cut-list output.
    const regions: AuphonicRegion[] = [];
    if (cutListOut) {
        const dlRes = await fetch(cutListOut.download_url);
        if (dlRes.ok) {
            const text = await dlRes.text();
            try {
                const parsed = JSON.parse(text);
                // Auphonic cut-lists contain arrays of [start, end, type] or
                // objects with start/end/type fields. Handle both shapes.
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        if (Array.isArray(item) && item.length >= 2) {
                            regions.push({
                                start: Number(item[0]),
                                end: Number(item[1]),
                                type: (item[2] as AuphonicRegion['type']) || 'filler',
                            });
                        } else if (item && typeof item === 'object') {
                            regions.push({
                                start: Number(item.start ?? item.begin),
                                end: Number(item.end ?? item.stop),
                                type: (item.type as AuphonicRegion['type']) || 'filler',
                            });
                        }
                    }
                }
            } catch {
                // If the cut-list isn't JSON, try the CSV format.
                for (const line of text.split('\n').filter(l => l.trim() && !l.startsWith('#'))) {
                    const parts = line.split(/[,\t]/).map(Number);
                    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
                        regions.push({
                            start: parts[0],
                            end: parts[1],
                            type: (parts[2] === 1 ? 'silence' : 'filler') as AuphonicRegion['type'],
                        });
                    }
                }
            }
        }
    }

    return { cleanedAudio, regions };
}
