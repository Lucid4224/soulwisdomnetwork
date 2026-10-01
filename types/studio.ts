// Shapes returned by the Podcast Studio API (app/api/studio) to the dashboard.

import type { BrollStyle } from '@/lib/broll';
import type { ShowNotes, SpokenWord } from '@/lib/showNotes';
import type { TimedWord } from '@/lib/retime';
import type { ShortAspect, ShortEdit, ShortRenderInputs } from '@/lib/shorts';
import type { ReviewUtterance } from '@/lib/transcript';
import type { ThumbKind } from '@/lib/thumbnail';
import type { YoutubeMetadata } from '@/lib/youtube';
import type { DetectedSpeaker, EpisodeBroll, EpisodeDescript, EpisodeFinal, EpisodePackage, EpisodeNotes, EpisodeStage, EpisodeShorts, EpisodeStatus, EpisodeThumbnails, EpisodeYoutube, TranscriptCorrections } from './episode';

export interface DriveVideo {
    id: string;
    name: string;
    sizeBytes: number;
    addedAt: string | null;        // ISO; when it arrived in the folder (Drive createdTime)
}

export interface EpisodeSummary {
    id: string;
    title: string;
    status: EpisodeStatus;
    stage: EpisodeStage;
    recordedAt: string | null;
    durationSeconds: number | null;
    costUsd: number;
    error: { stage: string; message: string; permanent: boolean } | null;
    docUrl: string | null;
    createdAt: number | null;      // epoch ms
    updatedAt: number | null;
    stuck: boolean;
    // Later steps whose last run failed (b-roll, edit package, Descript, ...), for the Studio home page.
    stepErrors: { step: string; message: string }[];
    finished: { by: string; at: number } | null;     // marked Finished in the Studio
    youtubeUrl: string | null;
    notesStatus: EpisodeNotes['status'] | null;   // show notes, once the transcript is accepted                // in progress and unchanged for 24 hours (spec 005 section 5)
}

export interface IngestRun {
    id: number;
    status: string;
    conclusion: string | null;
    event: string;
    createdAt: string;
    url: string;
}

export interface Pipeline {
    backlog: DriveVideo[];         // in the saved drag-and-drop order
    toProcess: DriveVideo[];
    episodes: EpisodeSummary[];
    runs: IngestRun[];
    monthCostUsd: number;
    dayCostUsd: number;            // paid runs in the last 24 hours (lib/server/spending.ts)
    dailyLimitUsd: number;
}

// GET /api/studio/episodes/[id]: everything the speaker review page needs.
export interface EpisodeReview {
    id: string;
    title: string;
    status: EpisodeStatus;
    recordedAt: string | null;
    durationSeconds: number | null;
    docUrl: string | null;
    videoUrl: string | null;       // signed link to the 720p proxy, valid for a few hours
    voices: DetectedSpeaker[];
    utterances: ReviewUtterance[];
    corrections: TranscriptCorrections;
    version: number;               // send back when saving; a mismatch means someone else saved
    accepted: { by: string; at: number; version: number | null } | null;   // version null: accepted before it was recorded
    knownNames: string[];          // offered when renaming a voice
}

// GET /api/studio/episodes/[id]/notes: the Checkpoint B page.
export interface EpisodeNotesView {
    id: string;
    title: string;
    recordedAt: string | null;
    durationSeconds: number | null;
    videoUrl: string | null;
    transcriptAccepted: boolean;
    words: SpokenWord[];           // the accepted transcript, to place quotes and teaser clips
    notes: {
        status: EpisodeNotes['status'];
        draft: ShowNotes | null;
        version: number;
        model: string | null;
        unverifiedQuotes: string[];
        error: string | null;
        requestedAt: number | null;
        generatedAt: number | null;
        approved: { by: string; at: number; version: number; notes: ShowNotes } | null;
        // Later steps made from an earlier approval: which, and its notes (null: approved before
        // earlier approvals were kept), to show what changed since and to go back to them.
        madeFrom: { version: number; steps: ('package' | 'descript' | 'final' | 'approval')[]; notes: ShowNotes | null; by: string | null; at: number | null } | null;
    } | null;
}

// GET /api/studio/episodes/[id]/broll: the b-roll images on the Checkpoint B page.
export interface BrollView {
    status: EpisodeBroll['status'] | null;
    only: number | null;
    error: string | null;
    notesApproved: boolean;
    images: {
        index: number;
        idea: string;
        style: 'photo' | 'digital';
        url: string;               // signed, a few hours
        model: string;
        prompt: string;
        usd: number;
        createdAt: number | null;
    }[];
}

// GET /api/studio/episodes/[id]/package: the edit package on the Checkpoint B page.
export interface PackageView {
    status: EpisodePackage['status'] | null;
    error: string | null;
    folderUrl: string | null;
    files: string[];
    warnings: string[];
    finishedAt: number | null;
    builtFromVersion: number | null;    // approved notes version, to spot a stale package
    notesApproved: boolean;
    approvedVersion: number | null;
    clipsStored: boolean;           // false for packages built before the Descript step
    descript: {
        status: EpisodeDescript['status'] | null;
        error: string | null;
        projectUrl: string | null;
        agentResponse: string | null;
        warnings: string[];
        mediaMinutes: number | null;
        aiCredits: number | null;
        finishedAt: number | null;
        builtFromVersion: number | null;
    };
}

// GET /api/studio/episodes/[id]/final: the final cut on the Checkpoint B page.
export interface FinalView {
    status: EpisodeFinal['status'] | null;
    error: string | null;
    canStart: boolean;                  // there is a finished Descript project to publish
    stale: boolean;                     // published from an earlier Descript project or notes
    driveUrl: string | null;
    folderUrl: string | null;
    shareUrl: string | null;
    durationSeconds: number | null;
    loudness: EpisodeFinal['loudness'] | null;
    coverage: number | null;
    chapters: NonNullable<EpisodeFinal['chapters']>;
    quoteCount: number;
    warnings: string[];
    finishedAt: number | null;
}

// Thumbnail options and Checkpoint D on the show notes page (docs/specs/011-thumbnails.md).
// Images are fetched by name (frame-0…, ai, approved); `key` changes when the image does.
export interface ThumbnailsView {
    status: EpisodeThumbnails['status'] | null;
    only: 'image' | null;
    error: string | null;
    canStart: boolean;                  // approved notes and a current final cut
    stale: boolean;                     // made from an earlier final cut
    hooks: string[];
    text: string;
    frames: { atMs: number; speaker: string; text: string; key: string }[];
    frame: number;
    image: { idea: string; style: BrollStyle; prompt: string; key: string } | null;
    choice: ThumbKind | null;
    finishedAt: number | null;
    title: string | null;               // the approved YouTube title
    chapterCount: number;
    blockers: string[];                 // what stands before approval
    approval: { by: string; at: number; kind: ThumbKind; text: string; key: string; stale: boolean } | null;
}

// The YouTube upload on the show notes page (docs/specs/012-youtube-upload.md).
export interface YoutubeView {
    status: EpisodeYoutube['status'] | null;
    error: string | null;
    blocker: string | null;             // why it cannot be uploaded yet
    videoId: string | null;
    url: string | null;
    privacyStatus: string | null;       // as YouTube last reported it
    finishedAt: number | null;
    warnings: string[];
    finalOutdated: boolean;             // the video on YouTube is an earlier final cut
    detailsOutdated: boolean;           // approved again since the last upload or update
    preview: YoutubeMetadata | null;    // exactly what is sent
}

// One short on the show notes page (docs/specs/013-shorts.md).
export interface ShortItemView extends ShortEdit {
    words: TimedWord[];                 // the final cut's words around it, for moving its ends
    render: { key: string; url: string; durationMs: number; inputs: ShortRenderInputs } | null;
    approved: { by: string; at: number } | null;    // of the render as it is now
    publishAt: number | null;
    youtube: { url: string; publishAt: number } | null;
    error: string | null;
}

// Shorts and Checkpoint E on the show notes page.
export interface ShortsView {
    status: EpisodeShorts['status'] | null;
    job: EpisodeShorts['job'];
    error: string | null;
    blocker: string | null;             // why shorts cannot be made yet
    episodeUrl: string | null;          // the episode on YouTube, which each short links to once it is there
    aspect: ShortAspect;
    version: number;
    finalAt: number;                    // the final cut now; a render from another is out of date
    finalUrl: string | null;            // the final cut, to preview a short before drawing it
    // The key quotes on the final cut, to pick shorts from. `match`: share of the quote's words heard
    // there; low means the edit cut or changed it.
    quotes: { text: string; speaker: string; startMs: number; endMs: number; match: number }[];
    items: ShortItemView[];
    lastSlot: number | null;            // the latest time any episode's short is scheduled for
    warnings: string[];
    finishedAt: number | null;
}
