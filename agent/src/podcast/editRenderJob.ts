// Editor Light (spec 015), render job: turns the edit saved in the Studio into a finished
// episode. Loads the episode and its edit, downloads the source video, teaser clips, intro
// (also used as the outro) and b-roll stills, runs renderEdit, then saves the video and its
// words, captions and chapter times to Cloud Storage and the video to "04 Final" in Drive.
// Firestore, Storage, Drive and the renderer come in as `deps`, so tests can run the whole
// job on stand-in data. editRenderRun.ts wires in the real services.
//
// The Studio settings (lib/studioSettings.ts) choose the intro (the show's, an uploaded one,
// or none), whether teaser clips play first, and whether this render becomes the episode's
// final cut in place of Descript's, which the thumbnails, Shorts and YouTube steps then use.
// With the default settings and a built edit package, it renders exactly as before.

import * as fs from 'fs';
import * as path from 'path';
import type { EpisodeEdit } from '../../../lib/edit';
import type { TimedWord } from '../../../lib/retime';
import { DEFAULT_SETTINGS, type StudioSettings } from '../../../lib/studioSettings';
import type { Episode, EpisodeEditRender } from '../../../types/episode';
import type { renderEdit } from './editRender';

export interface EditRenderDeps {
    getEpisode: () => Promise<Episode | undefined>;
    download: (storagePath: string, dest: string) => Promise<void>;
    upload: (local: string, storagePath: string, contentType: string) => Promise<void>;
    // null when no Drive folder is set up; the video is then only in Cloud Storage.
    saveToDrive: (local: string, name: string) => Promise<{ fileId: string; folderId: string } | null>;
    update: (fields: Record<string, unknown>) => Promise<void>;
    render: typeof renderEdit;
    now: () => unknown;                  // a server timestamp in production
    settings?: StudioSettings;           // the defaults when left out
    showIntro?: string;                  // the show's intro in the repository, when there is no edit package
    // Cuts a plain teaser clip from the recording, when there is no edit package to take clips from.
    cutClip?: (input: string, output: string, startSeconds: number, durationSeconds: number) => Promise<void>;
    // Composes the background music (ElevenLabs) into `dest`, when the settings ask for generated music.
    makeMusic?: (prompt: string, dest: string) => Promise<void>;
}

export interface EditRenderPlan {
    edit: EpisodeEdit;
    video: string;                       // Storage path of the source
    teasers: string[];                   // Storage paths, in order (from the edit package)
    teaserClips: { startMs: number; endMs: number }[];   // to cut from the recording when there is no package
    intro: string | null;                // Storage path; also closes the episode as the outro
    showIntro: boolean;                  // use the show's intro from the repository (no package)
    broll: { atMs: number; seconds: number; image: string; video?: string }[];   // Storage paths; video when an AI clip was made
    // Background music (Part H): an uploaded track, or a prompt to compose one; null for none.
    music: { path: string | null; prompt: string | null; volumeDb: number } | null;
    wordsPath: string | null;            // reviewed transcript, Storage path
    chapters: { title: string; startMs: number }[];
    quotes: { text: string; speaker: string; startMs: number; endMs: number }[];
    warnings: string[];
}

// Breathing room around a teaser clip cut here, as the edit package gives its clips.
const CLIP_LEAD_MS = 300;
const CLIP_TAIL_MS = 600;

// Drive allows almost anything in a name, but the file gets downloaded to Macs and PCs.
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

// Decides what the render needs from the episode and settings, without touching any service, so
// the choices (filled source first, intro as outro, b-roll in idea order) are testable.
export function planEditRender(episode: Episode, settings: StudioSettings = DEFAULT_SETTINGS): EditRenderPlan {
    const edit = episode.edit;
    if (!edit) throw new Error('Save an edit in the Studio editor first');
    const video = episode.package?.episodePath || episode.media?.sourcePath;
    if (!video) throw new Error('The original video is not in Cloud Storage');
    const warnings: string[] = [];
    const pkg = episode.package?.status === 'ready' ? episode.package : undefined;
    const images = Object.values(episode.broll?.images ?? {}).sort((a, b) => a.index - b.index);
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    if (!notes) warnings.push('The show notes are not approved, so no chapter or quote times were made.');

    const teasers = settings.teasers && pkg ? pkg.clipPaths ?? [] : [];
    const teaserClips = settings.teasers && !pkg
        ? (notes?.teaserClips ?? []).filter(c => c.endMs > c.startMs).map(c => ({ startMs: c.startMs, endMs: c.endMs }))
        : [];
    const intro = settings.intro === 'custom' ? settings.introPath
        : settings.intro === 'show' && pkg ? pkg.introPath ?? null : null;
    const showIntro = settings.intro === 'show' && !pkg;
    if (!pkg && (settings.teasers || settings.intro === 'show')) {
        warnings.push('The edit package is not built, so the teaser clips are cut plainly from the recording and the show\'s intro comes from the site\'s files.');
    }
    return {
        edit,
        video,
        teasers,
        teaserClips,
        intro,
        showIntro,
        broll: images.map(i => ({ atMs: i.startMs, seconds: i.durationSeconds, image: i.path, ...(i.videoPath ? { video: i.videoPath } : {}) })),
        music: settings.music === 'upload' && settings.musicPath ? { path: settings.musicPath, prompt: null, volumeDb: settings.musicVolumeDb }
            : settings.music === 'generate' ? { path: null, prompt: settings.musicPrompt, volumeDb: settings.musicVolumeDb } : null,
        wordsPath: episode.review?.reviewedPath ?? null,
        chapters: notes?.chapters ?? [],
        quotes: (notes?.quotes ?? []).filter(q => q.endMs > q.startMs)
            .map(q => ({ text: q.text, speaker: q.speaker, startMs: q.startMs, endMs: q.endMs })),
        warnings,
    };
}

// Runs the whole job. Status moves queued → downloading → rendering → saving → ready;
// the caller marks it failed when this throws.
export async function runEditRender(episodeId: string, deps: EditRenderDeps, workDir: string): Promise<EditRenderResult> {
    const settings = deps.settings ?? DEFAULT_SETTINGS;
    const episode = await deps.getEpisode();
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const plan = planEditRender(episode, settings);
    fs.mkdirSync(workDir, { recursive: true });

    await deps.update({
        'editRender.status': 'downloading', 'editRender.startedAt': deps.now(), 'editRender.error': null,
        'editRender.editVersion': plan.edit.version, updatedAt: deps.now(),
    });
    // Each file is downloaded once, under a name that keeps its extension for ffmpeg.
    const fetched = new Map<string, string>();
    const get = async (storagePath: string, name: string) => {
        const known = fetched.get(storagePath);
        if (known) return known;
        const local = path.join(workDir, `${name}${path.extname(storagePath) || '.mp4'}`);
        await deps.download(storagePath, local);
        fetched.set(storagePath, local);
        return local;
    };
    const video = await get(plan.video, 'source');
    const teasers: string[] = [];
    for (const [i, t] of plan.teasers.entries()) teasers.push(await get(t, `teaser-${i + 1}`));
    if (plan.teaserClips.length && deps.cutClip) {
        for (const [i, c] of plan.teaserClips.entries()) {
            const out = path.join(workDir, `teaser-cut-${i + 1}.mp4`);
            const start = Math.max(0, c.startMs - CLIP_LEAD_MS);
            await deps.cutClip(video, out, start / 1000, (c.endMs + CLIP_TAIL_MS - start) / 1000);
            teasers.push(out);
        }
    }
    const intro = plan.intro ? await get(plan.intro, 'intro')
        : plan.showIntro && deps.showIntro && fs.existsSync(deps.showIntro) ? deps.showIntro : undefined;
    const broll: { atMs: number; seconds: number; image: string; video?: string }[] = [];
    for (const [i, b] of plan.broll.entries()) {
        broll.push({ ...b, image: await get(b.image, `broll-${i + 1}`), ...(b.video ? { video: await get(b.video, `broll-video-${i + 1}`) } : {}) });
    }
    // The music bed: the uploaded track, or one composed now; a failure leaves the episode without music.
    let music: { file: string; volumeDb: number } | undefined;
    if (plan.music?.path) music = { file: await get(plan.music.path, 'music'), volumeDb: plan.music.volumeDb };
    else if (plan.music?.prompt !== undefined && plan.music?.prompt !== null) {
        if (!deps.makeMusic) plan.warnings.push('Music is set to be composed, but this run cannot compose it, so the episode has no music.');
        else {
            const file = path.join(workDir, 'music.mp3');
            try {
                await deps.makeMusic(plan.music.prompt, file);
                music = { file, volumeDb: plan.music.volumeDb };
            } catch (error) {
                plan.warnings.push(`The music could not be composed (${(error as Error).message}), so the episode has no music.`);
            }
        }
    }
    let words: TimedWord[] | undefined;
    if (plan.wordsPath) {
        const local = await get(plan.wordsPath, 'reviewed');
        words = (JSON.parse(fs.readFileSync(local, 'utf8')) as { lines: { words: TimedWord[] }[] }).lines.flatMap(l => l.words);
    }

    await deps.update({ 'editRender.status': 'rendering' });
    const out = path.join(workDir, 'episode.mp4');
    const report = await deps.render({
        video, edit: plan.edit, out,
        teasers: teasers.length ? teasers : undefined,
        intro, outro: intro,
        broll: broll.length ? broll : undefined,
        music,
        words, chapters: plan.chapters, quotes: plan.quotes,
    });

    // renderEdit writes episode.words.json, .srt and .chapters.json beside the video when
    // it was given words, chapters or quotes; each one found is kept with the video.
    await deps.update({ 'editRender.status': 'saving' });
    const prefix = `episodes/${episodeId}/editRender`;
    const videoPath = `${prefix}/episode.mp4`;
    await deps.upload(out, videoPath, 'video/mp4');
    const extras: Record<string, string | null> = { wordsPath: null, captionsPath: null, chaptersPath: null };
    const sidecars: [keyof typeof extras, string, string][] = [
        ['wordsPath', 'episode.words.json', 'application/json'],
        ['captionsPath', 'episode.srt', 'application/x-subrip'],
        ['chaptersPath', 'episode.chapters.json', 'application/json'],
    ];
    for (const [key, name, type] of sidecars) {
        const local = path.join(workDir, name);
        if (!fs.existsSync(local)) continue;
        await deps.upload(local, `${prefix}/${name}`, type);
        extras[key] = `${prefix}/${name}`;
    }
    const drive = await deps.saveToDrive(out, `${safeName(episode.title)} (Editor Light).mp4`);
    const result: EditRenderResult = {
        videoPath, ...extras as Pick<EditRenderResult, 'wordsPath' | 'captionsPath' | 'chaptersPath'>,
        driveFileId: drive?.fileId ?? null,
        driveUrl: drive ? `https://drive.google.com/file/d/${drive.fileId}/view` : null,
        folderUrl: drive ? `https://drive.google.com/drive/folders/${drive.folderId}` : null,
        durationSeconds: report.outputSeconds,
        cuts: report.cuts,
        timeSavedSeconds: report.timeSavedSeconds,
        renderSeconds: report.renderSeconds,
        editVersion: plan.edit.version,
        warnings: plan.warnings,
    };
    await deps.update({
        ...Object.fromEntries(Object.entries(result).map(([k, v]) => [`editRender.${k}`, v])),
        'editRender.status': 'ready', 'editRender.finishedAt': deps.now(), 'editRender.error': null,
        updatedAt: deps.now(),
        ...(settings.finalSource === 'editorLight' ? await asFinalCut(episodeId, episode, plan, result, workDir, deps) : {}),
    });
    return result;
}

// With the Editor Light render chosen as the final cut (Studio settings), it stands in for the
// one from Descript: the same `final` record, with the words, chapter and quote times on the
// rendered video, so the thumbnails, Shorts and YouTube steps work from it unchanged.
async function asFinalCut(episodeId: string, episode: Episode, plan: EditRenderPlan, result: EditRenderResult,
    workDir: string, deps: EditRenderDeps): Promise<Record<string, unknown>> {
    let wordsPath: string | null = null;
    const wordsFile = path.join(workDir, 'episode.words.json');
    if (fs.existsSync(wordsFile)) {
        // The final cut's words are kept as { words } with text, start and end, as final.ts saves them.
        const words = (JSON.parse(fs.readFileSync(wordsFile, 'utf8')) as TimedWord[]).map(w => ({ text: w.text, start: w.start, end: w.end }));
        const local = path.join(workDir, 'final-words.json');
        fs.writeFileSync(local, JSON.stringify({ words }));
        wordsPath = `episodes/${episodeId}/editRender/final-words.json`;
        await deps.upload(local, wordsPath, 'application/json');
    }
    const moved = path.join(workDir, 'episode.chapters.json');
    const timed = fs.existsSync(moved)
        ? JSON.parse(fs.readFileSync(moved, 'utf8')) as { chapters: { startMs: number }[]; quotes: { startMs: number; endMs: number }[] }
        : { chapters: [], quotes: [] };
    return {
        final: {
            status: 'ready',
            source: 'editorLight',
            editVersion: result.editVersion,
            videoPath: result.videoPath,
            ...(wordsPath ? { wordsPath } : {}),
            ...(result.driveFileId ? { driveFileId: result.driveFileId, driveUrl: result.driveUrl, folderUrl: result.folderUrl } : {}),
            durationSeconds: result.durationSeconds,
            chapters: plan.chapters.map((c, i) => ({ title: c.title, originalMs: c.startMs, startMs: timed.chapters[i]?.startMs ?? c.startMs })),
            quotes: plan.quotes.map((q, i) => ({
                text: q.text, speaker: q.speaker, originalMs: q.startMs,
                startMs: timed.quotes[i]?.startMs ?? q.startMs, endMs: timed.quotes[i]?.endMs ?? q.endMs,
            })),
            notesVersion: episode.notes?.status === 'approved' ? episode.notes.approvedVersion ?? 0 : null,
            warnings: result.warnings,
            startedAt: deps.now(),
            finishedAt: deps.now(),
            error: null,
        },
    };
}

export type EditRenderResult = Required<Pick<EpisodeEditRender,
    'videoPath' | 'wordsPath' | 'captionsPath' | 'chaptersPath' | 'driveFileId' | 'driveUrl' | 'folderUrl'
    | 'durationSeconds' | 'cuts' | 'timeSavedSeconds' | 'renderSeconds' | 'editVersion' | 'warnings'>>;
