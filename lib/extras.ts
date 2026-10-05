// Why: the schema, prompt and cleaning for the social posts and follow-up email Claude writes
// from the approved show notes, shared by the notes job and the server route.

import { z } from 'zod';
import { mmss, type ShowNotes } from './showNotes';
import type { StudioSettings } from './studioSettings';

export const EXTRAS_DIRECTION_MAX = 1000;
export const X_MAX = 280;

// What Claude returns: a LinkedIn post, an Instagram caption, a post for X, and a follow-up email.
export const ExtrasSchema = z.object({
    linkedin: z.string().describe('A LinkedIn post of 120 to 250 words: a hook line, what the recording covers and why it matters, at most three hashtags at the end'),
    instagram: z.string().describe('An Instagram caption: a short hook line, two or three short paragraphs, then five to eight hashtags on the last line'),
    x: z.string().describe('A post for X, under 280 characters including any link, with no more than two hashtags'),
    followupSubject: z.string().describe('The subject line of a follow-up email to the people in the recording'),
    followupBody: z.string().describe('A plain-text follow-up email: a one-paragraph summary, the decisions as a list, the action items grouped by owner with due dates, and a short sign-off with no name'),
});

export type Extras = z.infer<typeof ExtrasSchema>;

// The system prompt for the extras request, following the Studio settings.
export function extrasSystemPrompt(s: StudioSettings): string {
    return `You write social posts and follow-up emails for ${s.showName}.` + (s.about ? ` It ${s.about}.` : '') +
        ' Write in plain, warm, specific language. Avoid hype, clickbait and clichés ("delve", "journey", "unlock").' +
        ' Never claim as fact what a speaker offered as belief or experience. Use only what is in the notes.' +
        (s.extraInstructions ? `\n\nAlso follow these instructions from the producer:\n${s.extraInstructions}` : '');
}

// The user message for the extras request: the notes, the link, and the producer's direction.
export function extrasUserMessage(notes: ShowNotes, link: string, direction: string): string {
    const titles = notes.titles;
    const title = titles[notes.chosenTitle] ?? titles[0] ?? '';
    const parts: string[] = [];
    parts.push(`Title: ${title}`);
    parts.push(`Summary:\n${notes.summary}`);
    parts.push(`Description:\n${notes.description}`);
    if (notes.chapters.length) {
        parts.push(`Chapters:\n` + notes.chapters.map(c => `${mmss(c.startMs)} ${c.title}`).join('\n'));
    }
    if (notes.decisions?.length) {
        parts.push(`Decisions:\n` + notes.decisions.map(d => `- ${d}`).join('\n'));
    }
    if (notes.actionItems?.length) {
        parts.push(`Action items:\n` + notes.actionItems.map(a => `- ${a.task}` + (a.owner ? ` (owner: ${a.owner})` : '') + (a.due ? ` (due: ${a.due})` : '')).join('\n'));
    }
    if (notes.quotes.length) {
        parts.push(`Quotes:\n` + notes.quotes.slice(0, 5).map(q => `"${q.text}" (${q.speaker})`).join('\n'));
    }
    if (link) {
        parts.push(`Link to share: ${link}`);
    }
    const hasActions = (notes.decisions?.length ?? 0) > 0 || (notes.actionItems?.length ?? 0) > 0;
    parts.push('Write the LinkedIn post, the Instagram caption, the post for X and the follow-up email.' +
        (hasActions ? '' : ' There are no decisions or action items, so the email is a short thank-you note with the summary.'));
    let message = parts.join('\n\n');
    if (direction.trim()) {
        message += `\n\nDirection from the producer: ${direction.trim()}`;
    }
    return message;
}

// Cleans the extras: every field trimmed; followupSubject whitespace collapsed; X cut to 280 at a word boundary.
export function cleanExtras(e: Extras): Extras {
    const cleaned: Extras = {
        linkedin: e.linkedin.trim(),
        instagram: e.instagram.trim(),
        x: e.x.trim(),
        followupSubject: e.followupSubject.trim().replace(/\s+/g, ' '),
        followupBody: e.followupBody.trim(),
    };
    if (cleaned.x.length > X_MAX) {
        let cut = cleaned.x.slice(0, 279);
        const space = cut.lastIndexOf(' ');
        if (space > 0) cut = cut.slice(0, space);
        cleaned.x = cut + '…';
    }
    return cleaned;
}

// A mailto: link with the subject and body URL-encoded.
export function mailtoLink(subject: string, body: string): string {
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
