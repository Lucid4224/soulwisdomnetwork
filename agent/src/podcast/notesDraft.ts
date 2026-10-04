// The show notes request itself (docs/specs/007-show-notes.md): the prompt, the call to Claude
// and what it cost. Shared by notes.ts, which saves the draft, and compareNotes.ts, which
// only reports on it, so both send exactly the same prompt.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { anchorToTranscript, mmss, notesSchemaFor, parseShowNotes, type ShowNotes, type SpokenWord } from '../../../lib/showNotes';
import { DEFAULT_SETTINGS, notesSystemPrompt, type StudioSettings } from '../../../lib/studioSettings';
import type { Episode } from '../../../types/episode';

// Chosen by a side-by-side run (compareNotes.ts; docs/specs/007-show-notes.md). Effort is set
// explicitly because Opus 5.5 defaults to 'medium'.
export const NOTES_MODEL = 'claude-opus-5-5';
export const NOTES_EFFORT: Effort = 'high';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// US dollars per million tokens, for the episode's cost record.
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
    'claude-opus-5': { input: 5, output: 25 },
    'claude-opus-5-5': { input: 4, output: 20 },
};

export interface ReviewedLine { name: string; clip: boolean; start: number; text: string; words: { text: string; start: number; end: number }[] }

// Consecutive lines from one voice become one paragraph, each stamped with its start in
// milliseconds so Claude can return exact chapter, quote and b-roll times.
function transcriptForPrompt(lines: ReviewedLine[]) {
    const paragraphs: { start: number; who: string; text: string[] }[] = [];
    for (const l of lines) {
        const who = l.clip ? `${l.name} (clip played during the episode)` : l.name;   // quotable too
        const last = paragraphs[paragraphs.length - 1];
        if (last?.who === who) last.text.push(l.text);
        else paragraphs.push({ start: l.start, who, text: [l.text] });
    }
    return paragraphs.map(p => `[${p.start}ms ${mmss(p.start)}] ${p.who}: ${p.text.join(' ')}`).join('\n\n');
}

function speakerList(lines: ReviewedLine[]) {
    const seen = new Map<string, boolean>();
    for (const l of lines) if (!seen.has(l.name)) seen.set(l.name, l.clip);
    return [...seen].map(([name, clip]) => (clip ? `${name} (guest, heard in a recording played during the episode)` : name)).join(', ');
}

// The instructions come from the Studio settings (lib/studioSettings.ts notesSystemPrompt); with
// the default settings they are word for word the Soul Wisdom Collective prompt this always sent.


export interface Draft {
    notes: ShowNotes;
    unverified: string[];     // quotes and clips not found word for word in the transcript
    model: string;            // the model that answered (a fallback may have stepped in)
    inputTokens: number;
    outputTokens: number;
    usd: number;
    seconds: number;
}

export async function draftNotes(client: Anthropic, episode: Episode, lines: ReviewedLine[],
    model = NOTES_MODEL, effort = NOTES_EFFORT, settings: StudioSettings = DEFAULT_SETTINGS, direction = ''): Promise<Draft> {
    const transcript = transcriptForPrompt(lines);
    const started = Date.now();
    // Streamed: twenty long quotes need more output than a single non-streamed request allows.
    const response = await client.beta.messages.stream({
        model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, format: betaZodOutputFormat(notesSchemaFor(settings)) },  // schema follows the format and choices
        system: notesSystemPrompt(settings),
        messages: [{
            role: 'user',
            content: `Episode: "${episode.title}"${episode.recordedAt ? `, recorded ${episode.recordedAt.slice(0, 10)}` : ''}.\n` +
                `Speakers: ${speakerList(lines)}.\n\n` +
                `<transcript>\n${transcript}\n</transcript>\n\nWrite the show notes.` + (direction ? `\n\n${direction}` : ''),
        }],
    }).finalMessage();

    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write notes for this transcript');
    if (response.stop_reason === 'max_tokens') throw new Error('The notes were cut off (max_tokens); try again');
    if (!response.parsed_output) throw new Error('Claude returned notes in an unexpected shape');

    const notes = parseShowNotes(response.parsed_output);
    // Quotes and teaser clips get their exact times and speaker from the transcript words.
    const words: SpokenWord[] = lines.flatMap(l => l.words.map(w => ({ ...w, speaker: l.name, clip: l.clip })));
    const unverified = anchorToTranscript(notes, words);
    const { input_tokens, output_tokens } = response.usage;
    const price = USD_PER_MTOK[response.model] ?? USD_PER_MTOK[model] ?? USD_PER_MTOK[NOTES_MODEL];
    const usd = Math.round((input_tokens * price.input + output_tokens * price.output) / 1e4) / 100;
    return {
        notes, unverified, model: response.model, inputTokens: input_tokens, outputTokens: output_tokens, usd,
        seconds: Math.round((Date.now() - started) / 1000),
    };
}
