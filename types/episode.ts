import type { BrollStyle } from '../lib/broll';
import type { ShortAspect, ShortEdit, ShortRenderInputs } from '../lib/shorts';
import type { ShowNotes } from '../lib/showNotes';
import type { ThumbKind } from '../lib/thumbnail';
import type { EpisodeEdit } from '../lib/edit';

// Firestore `episodes/{driveFileId}` — written by agent/src/podcast/ingest.ts via the
// Admin SDK. See docs/specs/005-podcast-production-pipeline.md, steps 1-3.

export type EpisodeStatus =
    | 'ingesting'                // copying from Drive and making the proxy + audio files
    | 'transcribing'             // submitted to AssemblyAI, waiting for the result
    | 'awaiting_speaker_review'  // Checkpoint A: a person confirms the speaker names
    | 'speakers_confirmed'       // transcript accepted in the Podcast Studio
    | 'failed';

export type EpisodeStage = 'copy' | 'media' | 'transcribe' | 'finalize';

export interface EpisodeError {
    stage: EpisodeStage;
    message: string;
    permanent: boolean;   // permanent failures are not retried until someone asks
    attempts: number;     // failed runs so far; transient failures become permanent at 3
    at: unknown;            // Firestore Timestamp
}

export interface CostItem {
    item: string;         // e.g. 'transcription_raw'
    usd: number;
    at: unknown;            // Firestore Timestamp
    aiCredits?: number;     // descript_send: the Descript plan's AI credits and media time used
    mediaSeconds?: number;
}

export interface DetectedSpeaker {
    label: string;        // diarization label from AssemblyAI, e.g. 'A'
    suggestedName: string | null;
    firstMs: number;      // start of this voice's first line
    wordCount: number;
    talkSeconds: number;
    samples: { text: string; startMs: number }[];
}

// Fixes made in the Podcast Studio's speaker review. Keyed by diarization label; lines by
// `${utterance index}:${first word index}` (see lib/transcript.ts).
export interface TranscriptCorrections {
    speakers: Record<string, { name: string; clip: boolean }>;  // includes voices added by hand
    mergedInto: Record<string, string>;   // label -> the label it is the same person as
    splits: Record<string, number[]>;     // utterance index -> word indices that start a new line
    reassign: Record<string, string>;     // line id -> label
    dismissed: string[];                  // flagged line ids a person said are fine
}

// Show notes (docs/specs/007-show-notes.md). `generated` is what Claude wrote and is kept
// unchanged; `draft` is what producers edit; approving freezes the draft as the record.
export interface EpisodeNotes {
    status: 'queued' | 'generating' | 'ready' | 'failed' | 'approved';
    generated?: ShowNotes;
    draft?: ShowNotes;
    approved?: ShowNotes;                 // the draft as it was approved; later steps read this
    version?: number;                     // bumped on every save, as with corrections
    model?: string;
    unverifiedQuotes?: string[];          // quotes Claude returned that are not in the transcript
    requestedAt?: unknown;                // asked for from the Studio
    startedAt?: unknown;                  // the drafting run began
    generatedAt?: unknown;
    error?: string | null;
    approvedBy?: { uid: string; name: string };
    approvedAt?: unknown;
    approvedVersion?: number;             // the draft version approved; later steps record which one they used
    // Editor Light (spec 015): the transcript edit, behind NEXT_PUBLIC_EDITOR_LIGHT.
    edit?: EpisodeEdit & { updatedAt?: unknown; updatedBy?: string };
}

// An approval that a later one replaced, kept in `episodes/{id}/approvals/{approvedVersion}` so the
// Studio can show what changed since a step was made, and go back to it (docs/specs/007-show-notes.md).
export interface NotesApproval {
    notes: ShowNotes;
    version: number;
    by: { uid: string; name: string } | null;
    at: unknown;                          // when it was approved
    replacedAt: unknown;
}

// One generated b-roll still (spec 005 step 7; docs/specs/008-broll-images.md), with its
// provenance record. Keyed by the index of the approved idea it was made from.
export interface BrollImage {
    index: number;
    idea: string;                         // the approved idea it was made from
    style?: 'photo' | 'digital';          // brand style (lib/broll.ts); photo before styles existed
    startMs: number;
    durationSeconds: number;
    prompt: string;                       // exactly what was sent to the model
    model: string;
    quality: string;
    size: string;
    path: string;                         // Cloud Storage object path, PNG
    usd: number;
    createdAt: unknown;                   // Firestore Timestamp
}

export interface EpisodeBroll {
    status: 'queued' | 'generating' | 'ready' | 'failed';
    only: number | null;                  // one image being regenerated, or null for the set
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    images?: Record<string, BrollImage>;
}

// The edit package (spec 005 step 8, part 1; docs/specs/009-edit-package.md): everything for
// the Descript edit, in one Drive folder.
export interface EpisodePackage {
    status: 'queued' | 'building' | 'ready' | 'failed';
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    folderId?: string;
    folderUrl?: string;
    notesVersion?: number;                // the approved notes it was built from
    files?: string[];                     // names, in folder order
    clipPaths?: string[];                 // teaser clips in Cloud Storage, in order
    brollClipPaths?: (string | null)[];   // each b-roll image as a clip with a slow zoom or pan, by idea (null: no image)
    brollStillPaths?: (string | null)[];  // the same images cropped to 1920x1080, by idea
    introPath?: string | null;            // the show's intro in Cloud Storage
    bannerPath?: string | null;           // the generic "In this episode" banner (transparent PNG) in Cloud Storage
    episodePath?: string | null;          // the episode filled to 1920x1080, when the original is not 16:9
    sourceSize?: string;                  // the original's frame, e.g. "1920x1044"
    warnings?: string[];
}

// The Descript project (spec 005 step 8, part 2; docs/specs/009-edit-package.md), made through
// Descript's API from the edit package.
export interface EpisodeDescript {
    status: 'queued' | 'importing' | 'cleaning' | 'ready' | 'failed';
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    projectId?: string;
    projectUrl?: string;
    compositionId?: string;
    importJobId?: string;
    agentJobId?: string;
    agentResponse?: string;
    warnings?: string[];
    mediaSecondsUsed?: number;
    aiCreditsUsed?: number;
    notesVersion?: number;
}

// The final cut (spec 005 steps 10-11; docs/specs/010-final-cut.md): the edited episode
// published from Descript, loudness-normalized and kept in Storage and Drive, with the show
// notes' chapter and quote times moved onto it.
export interface EpisodeFinal {
    status: 'queued' | 'publishing' | 'mastering' | 'retiming' | 'ready' | 'failed';
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    projectId?: string;                   // the Descript project it was published from
    shareUrl?: string;                    // Descript's share page for it
    videoPath?: string;                   // Cloud Storage
    driveFileId?: string;
    driveUrl?: string;
    folderUrl?: string;                   // "04 Final"
    durationSeconds?: number;
    loudness?: { beforeLufs: number; afterLufs: number; truePeak: number };
    wordsPath?: string;                   // the final cut's words and times, Cloud Storage
    coverage?: number;                    // share of the original's words found in the final cut
    chapters?: { title: string; originalMs: number; startMs: number }[];
    quotes?: { text: string; speaker: string; originalMs: number; startMs: number; endMs: number }[];
    notesVersion?: number;                // the approved notes the times came from
    warnings?: string[];
}

// Editor Light render (spec 015): the edit saved in the Studio, rendered by GitHub Actions
// (agent/src/podcast/editRenderRun.ts) and kept apart from Descript's final cut, which the
// later steps still use.
export interface EpisodeEditRender {
    status: 'queued' | 'downloading' | 'rendering' | 'saving' | 'ready' | 'failed';
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    editVersion?: number;                 // the saved edit it was rendered from
    videoPath?: string;                   // Cloud Storage
    wordsPath?: string | null;            // the words on the rendered video's times
    captionsPath?: string | null;         // .srt
    chaptersPath?: string | null;         // chapters and quotes on the rendered video's times
    driveFileId?: string;
    driveUrl?: string;
    folderUrl?: string;                   // "04 Final"
    durationSeconds?: number;
    cuts?: number;
    timeSavedSeconds?: number;
    renderSeconds?: number;
    warnings?: string[];
}

// Thumbnail options (spec 005 step 12; docs/specs/011-thumbnails.md). The job makes the raw
// material: short texts from Claude, frames from the final cut, an AI background. The Studio
// draws the three options from it and the producer picks one at Checkpoint D.
export interface ThumbnailFrame {
    path: string;                         // Cloud Storage, 1280x720 JPEG
    atMs: number;                         // in the final cut
    speaker: string;                      // the quote it was taken at
    text: string;
}

export interface EpisodeThumbnails {
    status: 'queued' | 'working' | 'ready' | 'failed';
    only?: 'image' | null;                // just a new AI image
    imageRequest?: { idea: string; style: BrollStyle } | null;   // an idea the producer wrote
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    hooks?: string[];                     // Claude's texts, best first
    frames?: ThumbnailFrame[];
    image?: {
        idea: string; style: BrollStyle; prompt: string; model: string; path: string; usd: number; createdAt: unknown;
    };
    finalAt?: number;                     // the final cut they were made from (its finishedAt)
    // The producer's choices, saved as they go.
    text?: string;
    frame?: number;
    choice?: ThumbKind | null;
}

// Checkpoint D: the thumbnail as approved, and who approved the episode for publishing.
export interface EpisodeApproval {
    thumbnailPath: string;                // Cloud Storage, JPEG as it will be uploaded
    kind: ThumbKind;
    text: string;
    approvedBy: { uid: string; name: string };
    approvedAt: unknown;
    notesVersion: number;                 // what was approved; later changes make it stale
    finalAt: number;
}

// The YouTube upload (spec 005 step 13; docs/specs/012-youtube-upload.md). Uploaded once; a
// second run updates the title, description, tags, thumbnail and captions of the same video.
export interface EpisodeYoutube {
    status: 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    videoId?: string;
    url?: string;
    privacyStatus?: string;               // as YouTube reports it after the upload
    uploadedAt?: unknown;
    finalAt?: number;                     // the final cut that was uploaded (its finishedAt)
    approvalAt?: number;                  // the approval it was uploaded or updated under
    captionId?: string | null;
    playlistId?: string | null;           // the podcast playlist it was added to
    warnings?: string[];
}

// One short (spec 005 step 14; docs/specs/013-shorts.md): the producer's edit, the render made
// from it, the approval of that render at Checkpoint E, and the scheduled YouTube upload.
export interface ShortItem extends ShortEdit {
    render?: ShortRenderInputs & { path: string; renderedAt: number; durationMs: number } | null;
    approved?: { by: { uid: string; name: string }; at: number; renderedAt: number } | null;
    publishAt?: number | null;            // the slot it was scheduled for, ms
    youtube?: { videoId: string; url: string; publishAt: number; uploadedAt: number } | null;
    error?: string | null;                // the last upload attempt for this one failed
}

export interface EpisodeShorts {
    status: 'queued' | 'working' | 'ready' | 'failed';
    job: 'titles' | 'render' | 'upload' | 'suggest' | null;   // what was asked for last ('suggest': the first version)
    requestedAt?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    error?: string | null;
    aspect: ShortAspect;
    items: ShortItem[];
    version: number;                      // bumped on every edit, as with corrections
    finalAt?: number;                     // unused since shorts come from the key quotes
    timeZone?: string;                    // the producer's, for the times in emails
    warnings?: string[];
}

export interface Episode {
    title: string;                        // from the file name, Zoom prefix stripped
    recordedAt: string | null;            // ISO date from a Zoom file name, if present
    status: EpisodeStatus;
    stage: EpisodeStage;                  // the stage in progress, or the last one reached
    drive: {
        fileId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
    };
    candidateSpeakers: string[];          // names offered to AssemblyAI (the hosts)
    media?: {
        sourcePath?: string;              // Cloud Storage object paths
        proxyPath?: string;               // 720p H.264
        audioPath?: string;               // mono AAC
        durationSeconds?: number;
    };
    transcription?: {
        provider: 'assemblyai';
        transcriptId: string;
        speechModels: string[];
        transcriptPath?: string;          // full word-level JSON in Cloud Storage
        speakerIdStatus?: string | null;
        speakerMapping?: Record<string, string>;
        speakers?: DetectedSpeaker[];
    };
    review?: {
        transcriptTextPath?: string;      // readable transcript in Cloud Storage
        docUrl?: string;                  // same transcript as a Google Doc next to the video
        notifiedAt?: unknown;             // "ready for review" email sent
        reviewedPath?: string;            // transcripts/reviewed.json, written on Accept
        acceptedBy?: { uid: string; name: string };
        acceptedAt?: unknown;
        acceptedVersion?: number;         // correctionsVersion that was accepted
    };
    notes?: EpisodeNotes;                 // show notes, spec 005 step 5 and Checkpoint B
    broll?: EpisodeBroll;                 // b-roll images, spec 005 step 7
    package?: EpisodePackage;             // edit package for Descript, spec 005 step 8
    descript?: EpisodeDescript;           // the Descript project made from it
    final?: EpisodeFinal;                 // the finished episode, spec 005 steps 10-11
    // Editor Light (spec 015): the edit as the edit route saves it (top level), and its render.
    edit?: EpisodeEdit & { updatedAt?: unknown; updatedBy?: string };
    editRender?: EpisodeEditRender;
    thumbnails?: EpisodeThumbnails;       // thumbnail options, spec 005 step 12
    approval?: EpisodeApproval;           // Checkpoint D
    youtube?: EpisodeYoutube;             // the upload, spec 005 step 13
    shorts?: EpisodeShorts;               // shorts and Checkpoint E, spec 005 step 14
    corrections?: TranscriptCorrections;  // speaker review fixes, a layer over raw.json
    correctionsVersion?: number;          // bumped on every save; stops two people overwriting
    costs: { items: CostItem[]; totalUsd: number };
    // Marked Finished in the Studio: off the Accepted column and into Finished. Null when moved back.
    finished?: { by: { uid: string; name: string }; at: unknown } | null;
    error: EpisodeError | null;
    createdAt: unknown;
    updatedAt: unknown;
}
