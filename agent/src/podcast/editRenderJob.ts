// Editor Light (spec 015), render job: turns the edit saved in the Studio into a finished
// episode. Loads the episode and its edit, downloads the source video, teaser clips, intro
// (also used as the outro) and b-roll stills, runs renderEdit, then saves the video and its
// words, captions and chapter times to Cloud Storage and the video to "04 Final" in Drive.
// Firestore, Storage, Drive and the renderer come in as `deps`, so tests can run the whole
// job on stand-in data. editRenderRun.ts wires in the real services.

import * as fs from 'fs';
import * as path from 'path';
import type { EpisodeEdit } from '../../../lib/edit';
import type { TimedWord } from '../../../lib/retime';
import type { Episode, EpisodeEditRender } from '../../../types/episode';
import type { renderEdit } from './editRender';

export interface EditRenderDeps {
    getEpisode: () => Promise<Episode | undefined>;
    download: (storagePath: string, dest: string) => Promise<void>;
    upload: (local: string, storagePath: string, contentType: string) => Promise<void>;
    saveToDrive: (local: string, name: string) => Promise<{ fileId: string; folderId: string }>;
    update: (fields: Record<string, unknown>) => Promise<void>;
    render: typeof renderEdit;
    now: () => unknown;                  // a server timestamp in production
}

export interface EditRenderPlan {
    edit: EpisodeEdit;
    video: string;                       // Storage path of the source
    teasers: string[];                   // Storage paths, in order
    intro: string | null;                // Storage path; also closes the episode as the outro
    broll: { atMs: number; seconds: number; image: string }[];   // image = Storage path
    wordsPath: string | null;            // reviewed transcript, Storage path
    chapters: { title: string; startMs: number }[];
    quotes: { text: string; speaker: string; startMs: number; endMs: number }[];
    warnings: string[];
}

// Drive allows almost anything in a name, but the file gets downloaded to Macs and PCs.
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

// Decides what the render needs from the episode, without touching any service, so the
// choices (filled source first, intro as outro, b-roll in idea order) are testable.
export function planEditRender(episode: Episode): EditRenderPlan {
    const edit = episode.edit;
    if (!edit) throw new Error('Save an edit in the Studio editor first');
    const video = episode.package?.episodePath || episode.media?.sourcePath;
    if (!video) throw new Error('The original video is not in Cloud Storage');
    const warnings: string[] = [];
    const pkg = episode.package?.status === 'ready' ? episode.package : undefined;
    if (!pkg) warnings.push('The edit package is not built, so the render has no teaser clips and no intro or outro.');
    const images = Object.values(episode.broll?.images ?? {}).sort((a, b) => a.index - b.index);
    const notes = episode.notes?.status === 'approved' ? episode.notes.approved : undefined;
    if (!notes) warnings.push('The show notes are not approved, so no chapter or quote times were made.');
    return {
        edit,
        video,
        teasers: pkg?.clipPaths ?? [],
        intro: pkg?.introPath ?? null,
        broll: images.map(i => ({ atMs: i.startMs, seconds: i.durationSeconds, image: i.path })),
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
    const episode = await deps.getEpisode();
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const plan = planEditRender(episode);
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
    const intro = plan.intro ? await get(plan.intro, 'intro') : undefined;
    const broll: { atMs: number; seconds: number; image: string }[] = [];
    for (const [i, b] of plan.broll.entries()) broll.push({ ...b, image: await get(b.image, `broll-${i + 1}`) });
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
        driveFileId: drive.fileId,
        driveUrl: `https://drive.google.com/file/d/${drive.fileId}/view`,
        folderUrl: `https://drive.google.com/drive/folders/${drive.folderId}`,
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
    });
    return result;
}

export type EditRenderResult = Required<Pick<EpisodeEditRender,
    'videoPath' | 'wordsPath' | 'captionsPath' | 'chaptersPath' | 'driveFileId' | 'driveUrl' | 'folderUrl'
    | 'durationSeconds' | 'cuts' | 'timeSavedSeconds' | 'renderSeconds' | 'editVersion' | 'warnings'>>;
