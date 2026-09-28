// What goes to YouTube (spec 005 step 13; docs/specs/012-youtube-upload.md): the title, description
// with the chapter times of the final cut, tags and settings. Shared by the upload job and the
// show notes page, which previews exactly this.

import { youtubeDescription, type ShowNotes } from './showNotes';
import type { Episode } from '../types/episode';

export const YOUTUBE_CATEGORY = '27';            // Education (decided 28 Sept 2026)
export const YOUTUBE_CATEGORY_LABEL = 'Education';
// Asked for on upload. Until the API project passes YouTube's audit, YouTube keeps every API
// upload Private whatever is asked for.
export const YOUTUBE_PRIVACY = 'unlisted';

const TITLE_MAX = 100;
const DESCRIPTION_MAX_BYTES = 5000;
const TAGS_MAX_CHARS = 500;

// YouTube rejects angle brackets in titles and descriptions.
const clean = (s: string) => s.replace(/[<>]/g, '');

export interface YoutubeMetadata {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    privacyStatus: string;
    containsSyntheticMedia: boolean;
}

// Tags count toward YouTube's 500-character limit with a comma between them and quotes around any with a space.
function fitTags(tags: string[]) {
    const out: string[] = [];
    let used = 0;
    for (const raw of tags) {
        const tag = clean(raw).replace(/,/g, ' ').trim();
        if (!tag || out.includes(tag)) continue;
        const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
        if (used + cost > TAGS_MAX_CHARS) break;
        out.push(tag);
        used += cost;
    }
    return out;
}

function fitBytes(text: string, max: number) {
    while (new TextEncoder().encode(text).length > max) text = text.slice(0, -50);
    return text;
}

// The approved notes with the final cut's chapter times, which is what the video shows.
export function youtubeMetadata(episode: Episode): YoutubeMetadata | null {
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    const final = episode.final?.status === 'ready' ? episode.final : undefined;
    if (!notes || !final) return null;
    const chapters = (final.chapters ?? []).map(c => ({ title: c.title, startMs: c.startMs })) as ShowNotes['chapters'];
    return {
        title: clean(notes.titles[notes.chosenTitle] ?? episode.title).trim().slice(0, TITLE_MAX),
        description: fitBytes(clean(youtubeDescription({ ...notes, chapters })), DESCRIPTION_MAX_BYTES),
        tags: fitTags(notes.tags),
        categoryId: YOUTUBE_CATEGORY,
        privacyStatus: YOUTUBE_PRIVACY,
        // AI b-roll in the edit is "altered or synthetic content" under YouTube's rules.
        containsSyntheticMedia: Object.keys(episode.broll?.images ?? {}).length > 0,
    };
}
