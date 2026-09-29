// The Usage page (/admin/usage, lib/usage.ts): what each episode cost and how long it took,
// worked out now from the episode records and GitHub Actions, and the reports the podcast jobs
// post when an episode starts and finishes (usage_reports).

import type { Episode } from '@/types/episode';
import { analyseEpisode, type RunTime, type UsageReport } from '@/lib/usage';
import { adminDb } from './firebaseAdmin';
import { podcastRuns, type PodcastRun } from './github';
import { HttpError } from './staff';

const REPORTS = 'usage_reports';

export interface UsageView {
    episodes: ReturnType<typeof analyseEpisode>[];
    reports: (UsageReport & { id: string })[];
    runsError: string | null;       // GitHub could not be asked; times come from the records
}

// Runs named after the episode (" · <id>"); earlier runs carry no episode ID.
function runsFor(id: string, runs: PodcastRun[]): RunTime[] {
    return runs.filter(r => r.title.endsWith(` · ${id}`)).map(r => ({ workflow: r.workflow, startedAt: r.startedAt, minutes: r.minutes, ok: r.ok }));
}

async function allRuns(episodes: { e: Episode }[]) {
    const starts = episodes.map(({ e }) => (e.createdAt as { toMillis?: () => number })?.toMillis?.() ?? Date.now());
    if (!starts.length) return { runs: [] as PodcastRun[], error: null };
    try {
        return { runs: await podcastRuns(new Date(Math.min(...starts))), error: null };
    } catch (error) {
        return { runs: [] as PodcastRun[], error: (error as Error).message };
    }
}

// Episodes past speaker review: the ones with a production to account for.
async function productions() {
    const snap = await adminDb().collection('episodes').get();
    return snap.docs
        .map(d => ({ id: d.id, e: d.data() as Episode }))
        .filter(({ e }) => !!e.review?.acceptedAt || !!e.notes);
}

export async function getUsage(): Promise<UsageView> {
    const [episodes, reportsSnap] = await Promise.all([
        productions(),
        adminDb().collection(REPORTS).orderBy('at', 'desc').limit(100).get(),
    ]);
    const { runs, error } = await allRuns(episodes);
    return {
        episodes: episodes
            .map(({ id, e }) => analyseEpisode(id, e, runsFor(id, runs)))
            .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
        reports: reportsSnap.docs.map(d => ({ id: d.id, ...(d.data() as UsageReport) })),
        runsError: error,
    };
}

// Posts an analysis of one episode as it stands now (for episodes finished before the jobs
// posted reports, or to take stock mid-way).
export async function postUsage(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    const snap = await adminDb().collection('episodes').doc(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const e = snap.data() as Episode;
    const { runs } = await allRuns([{ e }]);
    const usage = analyseEpisode(id, e, runsFor(id, runs));
    const report: UsageReport = { episodeId: id, title: e.title, kind: usage.onYoutubeAt ? 'finished' : 'started', at: Date.now(), usage, projection: null };
    await adminDb().collection(REPORTS).add(report);
}
