// Podcast Studio data: what is waiting in Drive, what the pipeline has done, and the
// actions that move work along. Used by the app/api/studio routes.

import { isVideo, listFolderFiles, moveItem, type DriveFile } from '@/agent/src/podcast/drive';
import type { Episode } from '@/types/episode';
import type { DriveVideo, EpisodeSummary, Pipeline } from '@/types/studio';
import { DRIVE_FOLDERS, studioDrive } from './drive';
import { adminDb } from './firebaseAdmin';
import { latestIngestRuns } from './github';
import { DAILY_LIMIT_USD, spentToday } from './spending';
import { HttpError } from './staff';
import { getSettings } from './studioSettings';

const STUCK_MS = 24 * 60 * 60_000;
const BACKLOG_ORDER = () => adminDb().collection('studio').doc('backlog');

function toVideo(f: DriveFile): DriveVideo {
    return { id: f.id!, name: f.name ?? f.id!, sizeBytes: Number(f.size ?? 0), addedAt: f.createdTime ?? null };
}

async function listVideos(folderId: string) {
    return (await listFolderFiles(studioDrive(), folderId)).filter(isVideo).map(toVideo);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function'
        ? (t as { toMillis: () => number }).toMillis()
        : null;
}

async function savedOrder(): Promise<string[]> {
    return ((await BACKLOG_ORDER().get()).get('order') as string[] | undefined) ?? [];
}

// Saved order first; anything added to the folder since goes last, oldest first.
function ordered(videos: DriveVideo[], order: string[]) {
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...videos].sort((a, b) =>
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)
        || (a.addedAt ?? '').localeCompare(b.addedAt ?? ''));
}

// The steps after speaker review, and where each keeps its last run.
const STEP_JOBS = [
    ['Show notes', 'notes'], ['B-roll images', 'broll'], ['Edit package', 'package'], ['Descript', 'descript'],
    ['Final cut', 'final'], ['Thumbnails', 'thumbnails'], ['YouTube', 'youtube'], ['Shorts', 'shorts'],
] as const;

function stepErrors(e: Episode) {
    return STEP_JOBS.flatMap(([step, field]) => {
        const job = e[field] as { status?: string; error?: string | null } | undefined;
        return job?.status === 'failed' ? [{ step, message: job.error || 'No reason given' }] : [];
    });
}

function summarise(id: string, e: Episode): EpisodeSummary {
    const updatedAt = millis(e.updatedAt);
    const inProgress = e.status === 'ingesting' || e.status === 'transcribing';
    return {
        id,
        title: e.title,
        status: e.status,
        stage: e.stage,
        recordedAt: e.recordedAt ?? null,
        durationSeconds: e.media?.durationSeconds ?? null,
        costUsd: e.costs?.totalUsd ?? 0,
        error: e.error ? { stage: e.error.stage, message: e.error.message, permanent: e.error.permanent } : null,
        docUrl: e.review?.docUrl ?? null,
        createdAt: millis(e.createdAt),
        updatedAt,
        notesStatus: e.notes?.status ?? null,
        stepErrors: stepErrors(e),
        finished: e.finished ? { by: e.finished.by.name, at: millis(e.finished.at) ?? 0 } : null,
        youtubeUrl: e.youtube?.url ?? null,
        stuck: inProgress && updatedAt !== null && Date.now() - updatedAt > STUCK_MS,
    };
}

export async function getPipeline(): Promise<Pipeline> {
    // Drive is optional (Studio settings): without it, or when it cannot be read, the page still
    // works for recordings uploaded in the Studio.
    const { useDrive } = await getSettings();
    let driveProblem: string | null = null;
    const fromDrive = (folderId: string | undefined) => (useDrive && folderId ? listVideos(folderId) : Promise.resolve([]))
        .catch((e: Error) => { driveProblem = `Drive could not be read: ${e.message}`; return [] as DriveVideo[]; });
    const [backlog, toProcess, order, episodesSnap, runs, dayCostUsd] = await Promise.all([
        fromDrive(DRIVE_FOLDERS.backlog),
        fromDrive(DRIVE_FOLDERS.toProcess),
        savedOrder(),
        adminDb().collection('episodes').get(),
        latestIngestRuns(5).catch(() => []),
        spentToday(),
    ]);

    const episodes = episodesSnap.docs
        .map(d => summarise(d.id, d.data() as Episode))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthCostUsd = episodes
        .filter(e => (e.createdAt ?? 0) >= monthStart.getTime())
        .reduce((sum, e) => sum + e.costUsd, 0);

    return {
        backlog: ordered(backlog, order), toProcess, useDrive, driveProblem, episodes, runs, monthCostUsd, dayCostUsd, dailyLimitUsd: DAILY_LIMIT_USD,
    };
}

export async function saveBacklogOrder(order: string[]) {
    await BACKLOG_ORDER().set({ order, updatedAt: new Date() });
}

// Moves one backlog video into To Process: the given one, or the top of the saved order.
export async function queueFromBacklog(fileId?: string) {
    if (!DRIVE_FOLDERS.backlog) throw new HttpError(500, 'The backlog folder is not configured');
    const backlog = ordered(await listVideos(DRIVE_FOLDERS.backlog), await savedOrder());
    const video = fileId ? backlog.find(v => v.id === fileId) : backlog[0];
    if (!video) throw new HttpError(fileId ? 404 : 400, fileId ? 'That video is no longer in the backlog' : 'The backlog is empty');

    await moveItem(studioDrive(), video.id, DRIVE_FOLDERS.backlog, DRIVE_FOLDERS.toProcess);
    return video;
}
