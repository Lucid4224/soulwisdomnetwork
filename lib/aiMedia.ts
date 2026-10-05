// AI b-roll clips with OpenAI's Sora video API and background music, uploaded or composed by
// ElevenLabs; shared by the b-roll job, the render job and the renderer.

export const SORA_MODEL = 'sora-2';
export const SORA_SIZE = '1280x720';
export const SORA_USD_PER_SECOND = 0.10;
export const SORA_LENGTHS = [4, 8, 12] as const;

// The clip length that covers a moment: the first allowed length >= the moment, or 12 if none.
export function soraSeconds(durationSeconds: number): 4 | 8 | 12 {
    for (const s of SORA_LENGTHS) if (s >= durationSeconds) return s;
    return 12;
}

// What a clip costs, rounded to cents.
export function soraUsd(seconds: number): number {
    return Math.round(seconds * SORA_USD_PER_SECOND * 100) / 100;
}

// The video prompt: the still's prompt plus a steady motion direction (no cuts, no text, no sound).
export function videoPrompt(stillPrompt: string): string {
    return stillPrompt.trim() + "\n\nMotion: one continuous shot with a slow, steady camera move and gentle natural movement in the scene. No cuts, no text, no sound.";
}

export const MUSIC_MODES = ['none', 'upload', 'generate'] as const;
export type MusicMode = typeof MUSIC_MODES[number];

export const DEFAULT_MUSIC_PROMPT = 'Calm, warm ambient instrumental with soft piano and gentle pads; hopeful and unobtrusive, for speech to sit over.';
export const MUSIC_TRACK_MS = 180000;

// The ElevenLabs music request: an instrumental track of the given length (kept to the API's range).
export function musicRequest(prompt: string, lengthMs: number = MUSIC_TRACK_MS): {
    url: string;
    body: { prompt: string; music_length_ms: number; model_id: string; force_instrumental: boolean };
} {
    const clamped = Math.min(600000, Math.max(3000, Math.round(lengthMs)));
    return {
        url: 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',
        body: { prompt: prompt.trim() || DEFAULT_MUSIC_PROMPT, music_length_ms: clamped, model_id: 'music_v1', force_instrumental: true },
    };
}

// The ffmpeg filter that ducks the music under the speech: split the episode, compress the music
// bed with the speech as the sidechain, and mix them back together (the episode keeps its level).
export function musicMix(musicIdx: number, volumeDb: number, epLabel = 'epa', outLabel = 'epm'): string {
    return `[${epLabel}]asplit=2[${epLabel}_main][${epLabel}_key];` +
    `[${musicIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${volumeDb}dB[${outLabel}_bed];` +
    `[${outLabel}_bed][${epLabel}_key]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=500[${outLabel}_duck];` +
    `[${epLabel}_main][${outLabel}_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[${outLabel}];`;
}
