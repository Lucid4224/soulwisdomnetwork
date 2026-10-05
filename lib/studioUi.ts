// Why: the Studio home page and the editor's speed buttons share this logic —
// which episodes go in which section, and where each episode's Continue button
// leads — so it can be tested without React or the DOM.

import { journey, journeyHref, JOURNEY, type FinalSource } from '../components/studio/steps';
import type { EpisodeSummary } from '../types/studio';

// The playback speeds offered beside the Edited / Original switch.
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

// The four sections of the Studio home page.
export interface EpisodeGroups {
    processing: EpisodeSummary[];
    failed: EpisodeSummary[];
    active: EpisodeSummary[];
    finished: EpisodeSummary[];
}

// Why: the Studio home page splits episodes into processing, failed, active (in progress)
// and finished, so the page can show each section only when it has something in it.
export function episodeGroups(episodes: EpisodeSummary[]): EpisodeGroups {
    const processing = episodes.filter(e => e.status === 'ingesting' || e.status === 'transcribing');
    const failed = episodes.filter(e => e.status === 'failed');
    const active = episodes
        .filter(e => e.status === 'awaiting_speaker_review' || (e.status === 'speakers_confirmed' && !e.finished))
        .sort((a, b) => {
            const ua = a.updatedAt ?? -1;
            const ub = b.updatedAt ?? -1;
            return ub - ua;
        });
    const finished = episodes
        .filter(e => e.status === 'speakers_confirmed' && e.finished)
        .sort((a, b) => (b.finished!.at) - (a.finished!.at));
    return { processing, failed, active, finished };
}

// Why: each episode's Continue button opens the step it is on, so the producer
// can carry on without hunting through the journey bar for the next action.
export function continueTarget(
    e: EpisodeSummary,
    source: FinalSource | null | undefined,
): { label: string; href: string } {
    if (e.status === 'awaiting_speaker_review') {
        return { label: 'Continue: Speakers', href: `/admin/podcast/${e.id}` };
    }
    const entries = journey({ accepted: true, ...e.progress });
    const index = entries.findIndex(en => en.status === 'current');
    if (index < 0) {
        return { label: 'Open', href: `/admin/podcast/${e.id}/notes` };
    }
    return {
        label: `Continue: ${JOURNEY[index]}`,
        href: journeyHref(e.id, index, source),
    };
}
