// Why: transcript downloads (Word, plain text, captions) made in the browser from the accepted
// transcript, so no server round-trip is needed and no dependency is added.

import { para, wordFile } from './meetingDoc';
import { mmss, type SpokenWord } from './showNotes';

// One paragraph of the transcript: one speaker turn starting at a time.
export interface TranscriptPara {
    speaker: string;
    startMs: number;
    text: string;
}

// Groups words into one paragraph per speaker turn, skipping empty words.
export function transcriptParagraphs(words: SpokenWord[]): TranscriptPara[] {
    const paras: TranscriptPara[] = [];
    for (const word of words) {
        if (word.text.trim() === '') continue;
        const last = paras[paras.length - 1];
        if (last && last.speaker === word.speaker) {
            last.text += ' ' + word.text;
        } else {
            paras.push({ speaker: word.speaker, startMs: Math.round(word.start), text: word.text });
        }
    }
    return paras;
}

// The transcript as plain text: title, then each turn as "[m:ss] Speaker: text".
export function transcriptText(title: string, words: SpokenWord[]): string {
    const paras = transcriptParagraphs(words);
    return `${title}\n\n` + paras.map(p => `[${mmss(p.startMs)}] ${p.speaker}: ${p.text}`).join('\n\n') + '\n';
}

// Formats milliseconds as SRT time "HH:MM:SS,mmm", never negative.
export function srtTime(ms: number): string {
    const t = Math.max(0, Math.round(ms));
    const h = Math.floor(t / 3_600_000);
    const m = Math.floor((t % 3_600_000) / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    const mm = t % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mm).padStart(3, '0')}`;
}

interface Cue { start: number; end: number; speaker: string; text: string }

// The transcript as SRT captions, breaking cues at sentence ends, speaker changes, 84 characters and 6 seconds.
export function transcriptSrt(words: SpokenWord[]): string {
    const cues: Cue[] = [];
    for (const word of words) {
        if (word.text.trim() === '') continue;
        const cue = cues[cues.length - 1];
        if (cue) {
            const endsSentence = /[.?!][""')\]]*$/.test(cue.text);
            const sameSpeaker = word.speaker === cue.speaker;
            const newLen = cue.text.length + 1 + word.text.length;
            const withinTime = word.end - cue.start <= 6000;
            if (sameSpeaker && !endsSentence && newLen <= 84 && withinTime) {
                cue.text += ' ' + word.text;
                cue.end = word.end;
                continue;
            }
        }
        cues.push({ start: word.start, end: word.end, speaker: word.speaker, text: word.text });
    }
    return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

// The transcript as a Word .docx: the title, then one paragraph per turn.
export function transcriptDocx(title: string, words: SpokenWord[]): Uint8Array {
    const paras = transcriptParagraphs(words);
    const body = [para(title, 'Title'), ...paras.map(p => para(`[${mmss(p.startMs)}] ${p.speaker}: ${p.text}`))];
    return wordFile(body);
}

// A safe file name from the title: only letters, digits, underscores, dashes and spaces, then ".ext".
export function downloadName(title: string, ext: string): string {
    let safe = title.replace(/[^\w\d _-]/g, '').trim().replace(/\s+/g, '-');
    if (safe.length > 80) safe = safe.slice(0, 80);
    if (!safe) safe = 'transcript';
    return `${safe}.${ext}`;
}
