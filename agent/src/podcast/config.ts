import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Always offered to AssemblyAI as candidate names. Guests are named at Checkpoint A.
export const HOSTS = ['Daniel Endy', 'Tom Wood'];

// AssemblyAI: $0.21 transcription + $0.02 diarization + $0.02 speaker ID per audio hour
// (docs/research, Sept 2026). Used for the cost cap only; confirm against the invoice.
export const ASSEMBLYAI_USD_PER_HOUR = 0.25;

// A transient failure is retried on the next scheduled run; after this many it is
// treated as permanent and alerted.
export const MAX_ATTEMPTS = 3;

// Skip a video added this recently, so a file still uploading is never picked up.
export const SETTLE_MINUTES = 15;

// Speech models to try in order; the first AssemblyAI accepts is used.
export function speechModels() {
    return (process.env.ASSEMBLYAI_SPEECH_MODELS || 'universal-3-5-pro,universal-2').split(',').map(s => s.trim()).filter(Boolean);
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

// Failure and "ready" emails, shared by every podcast job.
export function loadAlert() {
    return {
        resendApiKey: process.env.RESEND_API_KEY || '',
        to: process.env.ALERT_EMAIL || '',
        from: process.env.ALERT_FROM || 'Soul Wisdom Pipeline <pipeline@soulwisdomcollective.com>',
    };
}

export function loadConfig() {
    return {
        serviceAccountJson: required('PODCAST_SA_JSON'),
        assemblyAiKey: required('ASSEMBLYAI_API_KEY'),
        toProcessFolderId: required('DRIVE_TO_PROCESS_FOLDER_ID'),
        processedFolderId: required('DRIVE_PROCESSED_FOLDER_ID'),
        bucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
        speechModels: speechModels(),
        costCapUsd: Number(process.env.PODCAST_EPISODE_COST_CAP_USD || 5),
        workDir: process.env.RUNNER_TEMP || '/tmp',
        retryFileId: process.env.RETRY_FILE_ID || '',
        dryRun: process.env.DRY_RUN === 'true',
        // Manual runs only; scheduled runs always wait, since a file may still be uploading.
        skipWait: process.env.SKIP_WAIT === 'true',
        runUrl: process.env.GITHUB_RUN_URL || '',
        alert: loadAlert(),
    };
}

export type Config = ReturnType<typeof loadConfig>;
