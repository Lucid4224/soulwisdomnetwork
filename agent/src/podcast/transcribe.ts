import { AssemblyAI, type Transcript } from 'assemblyai';
import type { DetectedSpeaker } from '../../../types/episode';
import { PermanentError, withRetry } from './errors';

export function createAssemblyAI(apiKey: string) {
    return new AssemblyAI({ apiKey });
}

type Client = ReturnType<typeof createAssemblyAI>;

// Uploads the audio and starts a job; returns immediately. The id is saved to Firestore
// before we wait, so a crashed run resumes polling instead of paying for a second job.
export async function submitTranscription(client: Client, audioFile: string, speechModels: string[], candidates: string[]) {
    const uploadUrl = await withRetry('AssemblyAI upload', () => client.files.upload(audioFile));
    const transcript = await withRetry('AssemblyAI submit', () => client.transcripts.submit({
        audio: uploadUrl,
        speech_models: speechModels,
        speaker_labels: true,
        speech_understanding: {
            request: {
                speaker_identification: { speaker_type: 'name', known_values: candidates },
            },
        },
    }));
    return transcript.id;
}

// Words and their times only, no speakers: for lining the finished episode up with the
// original (spec 005 step 11). Waits for the result.
export async function transcribeWords(client: Client, audioFile: string, speechModels: string[]) {
    const uploadUrl = await withRetry('AssemblyAI upload', () => client.files.upload(audioFile));
    const submitted = await withRetry('AssemblyAI submit', () => client.transcripts.submit({ audio: uploadUrl, speech_models: speechModels }));
    const transcript = await waitForTranscript(client, submitted.id);
    return {
        id: transcript.id,
        words: (transcript.words ?? []).map(w => ({ text: w.text, start: w.start, end: w.end })),
    };
}

// A job that errored on AssemblyAI's side is resubmitted on retry rather than re-polled.
export async function hasFailed(client: Client, id: string) {
    const transcript = await withRetry('AssemblyAI get', () => client.transcripts.get(id));
    return transcript.status === 'error';
}

export async function waitForTranscript(client: Client, id: string): Promise<Transcript> {
    const transcript = await withRetry('AssemblyAI poll', () =>
        client.transcripts.waitUntilReady(id, { pollingInterval: 15_000, pollingTimeout: 3 * 60 * 60_000 }),
    );
    if (transcript.status === 'error') throw new PermanentError(`AssemblyAI: ${transcript.error}`);
    return transcript;
}

// Diarization label for an utterance. The speaker-ID mapping goes from label to identified
// name, and utterance.speaker may hold either; a label is preferred because two voices can
// map to one name.
export function labelResolver(transcript: Transcript) {
    const mapping = transcript.speech_understanding?.response?.speaker_identification?.mapping ?? {};
    const labelFor = new Map(Object.entries(mapping).map(([label, name]) => [name, label]));
    return {
        mapping,
        labelOf: (speaker: string) => speaker in mapping ? speaker : (labelFor.get(speaker) ?? speaker),
    };
}

function clip(text: string, maxWords: number) {
    const words = text.split(/\s+/);
    return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : text;
}

// One entry per diarized voice with a few sample lines, for Checkpoint A.
export function summariseSpeakers(transcript: Transcript): DetectedSpeaker[] {
    const { mapping, labelOf } = labelResolver(transcript);
    const bySpeaker = new Map<string, DetectedSpeaker & { fallback: DetectedSpeaker['samples'] }>();
    for (const u of transcript.utterances ?? []) {
        const label = labelOf(u.speaker);
        let s = bySpeaker.get(label);
        if (!s) {
            s = {
                // An unmatched voice comes back mapped to its own letter ("D": "D").
                label, suggestedName: mapping[label] && mapping[label] !== label ? mapping[label] : null, firstMs: u.start,
                wordCount: 0, talkSeconds: 0, samples: [], fallback: [],
            };
            bySpeaker.set(label, s);
        }
        const words = u.words?.length ?? u.text.split(/\s+/).length;
        s.wordCount += words;
        s.talkSeconds += (u.end - u.start) / 1000;
        // Mid-length lines identify a voice best; skip "yeah" and monologues.
        if (s.samples.length < 3 && words >= 8 && words <= 40) {
            s.samples.push({ text: u.text, startMs: u.start });
        }
        // A video clip is often one long stretch, so keep its opening lines too.
        if (s.fallback.length < 3) s.fallback.push({ text: clip(u.text, 40), startMs: u.start });
    }
    return [...bySpeaker.values()]
        .map(({ fallback, ...s }) => ({
            ...s,
            samples: s.samples.length ? s.samples : fallback,
            talkSeconds: Math.round(s.talkSeconds),
        }))
        .sort((a, b) => b.talkSeconds - a.talkSeconds);
}
