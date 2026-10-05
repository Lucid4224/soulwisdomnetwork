// Part I: retakes. Claude reads the accepted transcript and finds where a speaker abandoned a
// sentence and said it again, or asked to redo a passage; each abandoned attempt becomes a
// suggested cut (reason 'retake') the producer reviews in the editor like any other suggestion.

import { z } from 'zod';
import type { Cut } from './edit';

export interface RetakeLine { name: string; words: { text: string; start: number; end: number }[] }

export const RetakesSchema = z.object({
    retakes: z.array(z.object({
        line: z.number().int(),          // the transcript line the words are on
        text: z.string(),                // the words to remove, copied exactly from that line
        why: z.string(),                 // a few words for the producer
    })),
});
export type RetakesAnswer = z.infer<typeof RetakesSchema>;

// A retake as the editor shows it: the cut, and Claude's few words on why.
export interface Retake { startMs: number; endMs: number; why: string }

// Instructions for finding retakes.
export function retakesSystemPrompt(): string {
    return 'You help edit a recorded conversation. Find the retakes: places where a speaker stops partway and says the same thing again, ' +
        'starts a sentence, abandons it and restarts it, or says they will say something again. For each one, give the words of the abandoned ' +
        'attempt to remove, copied exactly from one transcript line, so the better, final attempt is what remains. When an abandoned ' +
        'attempt runs over several lines, give one item per line. Leave alone repetition used for emphasis, single doubled words and ' +
        'filler words such as um and uh (they are handled elsewhere). When unsure, leave it out; a missed retake costs less than a cut sentence.';
}

// The transcript as numbered lines, one per speaker turn.
export function retakesUserMessage(lines: RetakeLine[]): string {
    return `<transcript>\n${lines.map((l, i) => `${i}\t${l.name}: ${l.words.map(w => w.text).join(' ')}`).join('\n')}\n</transcript>\n\nList the retakes.`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

// Finds `text` as consecutive words of the line (ignoring case and punctuation): their first and last index, or null.
export function findWords(words: { text: string }[], text: string): [number, number] | null {
    const want = text.split(/\s+/).map(norm).filter(Boolean);
    if (!want.length) return null;
    const have = words.map(w => norm(w.text));
    for (let i = 0; i + want.length <= have.length; i++) {
        let k = 0;
        while (k < want.length && have[i + k] === want[k]) k++;
        if (k === want.length) return [i, i + want.length - 1];
    }
    return null;
}

// Claude's answer as timed retakes: each found on its line, from its first word's start to its last
// word's end. Ones not found word for word are counted and left out.
export function timeRetakes(lines: RetakeLine[], answer: RetakesAnswer): { retakes: Retake[]; notFound: number } {
    const retakes: Retake[] = [];
    let notFound = 0;
    for (const r of answer.retakes) {
        const line = lines[r.line];
        const span = line ? findWords(line.words, r.text) : null;
        if (!line || !span) { notFound++; continue; }
        retakes.push({ startMs: line.words[span[0]].start, endMs: line.words[span[1]].end, why: r.why.trim().slice(0, 200) });
    }
    retakes.sort((a, b) => a.startMs - b.startMs);
    return { retakes, notFound };
}

// Adds the retakes to the edit's cuts as suggestions, skipping any already there.
export function addRetakes(cuts: Cut[], retakes: Retake[]): Cut[] {
    const have = new Set(cuts.map(c => `${c.startMs}-${c.endMs}`));
    const added = retakes.filter(r => !have.has(`${r.startMs}-${r.endMs}`)).map(r => ({ startMs: r.startMs, endMs: r.endMs, reason: 'retake' as const }));
    return [...cuts, ...added];
}
