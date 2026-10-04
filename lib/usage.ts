// What an episode cost and how long it took (the Usage page, /admin/usage): money by service,
// the Descript plan's AI credits and media minutes, the machine time of every job, and the
// elapsed time from the video arriving to the episode being on YouTube. Shared by the server
// (the page) and the podcast jobs, which post a report when an episode starts and finishes.

import type { CostItem, Episode } from '../types/episode';

export interface JobTime { step: string; minutes: number; runs: number }
export interface RunTime { workflow: string; startedAt: number; minutes: number; ok: boolean }

export interface EpisodeUsage {
    episodeId: string;
    title: string;
    lengthMinutes: number | null;
    startedAt: number | null;           // the video arrived (ingest began)
    onYoutubeAt: number | null;         // first uploaded to YouTube
    shortsDoneAt: number | null;        // the last short went to YouTube
    elapsedHours: number | null;        // started → on YouTube
    milestones: { label: string; at: number }[];
    machine: { minutes: number; source: 'github' | 'records'; byStep: JobTime[] };
    money: { totalUsd: number; byService: { service: string; usd: number }[]; items: { label: string; usd: number; count: number }[] };
    descript: { aiCredits: number; mediaMinutes: number; sends: number; allSends: boolean };
    usdPerEpisodeMinute: number | null;
}

// Cost items by what they are and who is paid.
const ITEMS: { test: RegExp; label: string; service: string }[] = [
    { test: /^transcription_raw$/, label: 'Transcript (speaker labels)', service: 'AssemblyAI' },
    { test: /^final_transcript$/, label: 'Transcript of the final cut', service: 'AssemblyAI' },
    { test: /^show_notes$/, label: 'Show notes', service: 'Anthropic (Claude)' },
    { test: /^thumbnail_text$/, label: 'Thumbnail texts', service: 'Anthropic (Claude)' },
    { test: /^shorts_titles$/, label: 'Shorts headlines and titles', service: 'Anthropic (Claude)' },
    { test: /^shorts_pick$/, label: "Claude's picks for Shorts", service: 'Anthropic (Claude)' },
    { test: /^broll_\d+$/, label: 'B-roll images', service: 'OpenAI' },
    { test: /^thumbnail_image$/, label: 'Thumbnail AI background', service: 'OpenAI' },
];
const classify = (item: string) => ITEMS.find(i => i.test.test(item)) ?? { label: item, service: 'Other' };

// The workflow behind each step, as named in GitHub Actions.
export const STEP_WORKFLOWS: Record<string, string> = {
    'Podcast Ingest': 'Copy and transcribe', 'Podcast Show Notes': 'Show notes', 'Podcast B-roll': 'B-roll images',
    'Podcast Edit Package': 'Edit package', 'Podcast Descript': 'Descript project', 'Podcast Final Cut': 'Final cut',
    'Podcast Thumbnails': 'Thumbnails', 'Podcast YouTube Upload': 'YouTube upload', 'Podcast Shorts': 'Shorts',
};

export function millis(t: unknown): number | null {
    if (t == null) return null;
    if (typeof t === 'number') return t;
    if (t instanceof Date) return t.getTime();
    const o = t as { toMillis?: () => number; _seconds?: number; seconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis();
    const s = o._seconds ?? o.seconds;
    return typeof s === 'number' ? s * 1000 : null;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

// `runs`: this episode's GitHub Actions runs (named with its ID), when known; otherwise the
// time comes from each job's last run in the episode record, which misses earlier retries.
export function analyseEpisode(episodeId: string, e: Episode, runs: RunTime[] = []): EpisodeUsage {
    const startedAt = millis(e.createdAt);
    const onYoutubeAt = millis(e.youtube?.uploadedAt);
    const shortTimes = (e.shorts?.items ?? []).map(i => i.youtube?.uploadedAt ?? null).filter((t): t is number => t != null);
    const shortsDoneAt = shortTimes.length ? Math.max(...shortTimes) : null;

    const milestones = ([
        ['Video arrived', startedAt],
        ['Transcript ready for review', millis(e.review?.notifiedAt)],
        ['Speakers accepted', millis(e.review?.acceptedAt)],
        ['Show notes approved', millis(e.notes?.approvedAt)],
        ['Edit package built', millis(e.package?.finishedAt)],
        ['Descript project made', millis(e.descript?.finishedAt)],
        ['Final cut in', millis(e.final?.finishedAt)],
        ['Thumbnail approved', millis(e.approval?.approvedAt)],
        ['On YouTube', onYoutubeAt],
        ['Shorts scheduled', shortsDoneAt],
    ] as [string, number | null][]).flatMap(([label, at]) => (at != null ? [{ label, at }] : []));

    const span = (a: unknown, b: unknown) => {
        const x = millis(a), y = millis(b);
        return x != null && y != null && y >= x ? (y - x) / 60_000 : null;
    };
    // Ingest handles whatever is waiting, so its runs are not tied to one episode: its time is
    // from the video arriving to the transcript being ready.
    const ingest = span(e.createdAt, e.review?.notifiedAt);
    const ingestStep = ingest != null ? [{ step: 'Copy and transcribe', minutes: round(ingest, 1), runs: 1 }] : [];

    // Machine time: every run from GitHub when we have them, else each job's last run.
    let machine: EpisodeUsage['machine'];
    if (runs.length) {
        const by = new Map<string, JobTime>();
        for (const r of runs) {
            const step = STEP_WORKFLOWS[r.workflow] ?? r.workflow;
            const j = by.get(step) ?? { step, minutes: 0, runs: 0 };
            j.minutes += r.minutes;
            j.runs += 1;
            by.set(step, j);
        }
        const byStep = [...ingestStep, ...[...by.values()].map(j => ({ ...j, minutes: round(j.minutes, 1) }))];
        machine = { minutes: round(byStep.reduce((t, j) => t + j.minutes, 0), 1), source: 'github', byStep };
    } else {
        const jobs: [string, number | null][] = [
            ['Show notes', span(e.notes?.startedAt ?? e.notes?.requestedAt, e.notes?.generatedAt)],
            ['B-roll images', span(e.broll?.startedAt, e.broll?.finishedAt)],
            ['Edit package', span(e.package?.startedAt, e.package?.finishedAt)],
            ['Descript project', span(e.descript?.startedAt, e.descript?.finishedAt)],
            ['Final cut', span(e.final?.startedAt, e.final?.finishedAt)],
            ['Thumbnails', span(e.thumbnails?.startedAt, e.thumbnails?.finishedAt)],
            ['YouTube upload', span(e.youtube?.startedAt, e.youtube?.finishedAt)],
            ['Shorts', span(e.shorts?.startedAt, e.shorts?.finishedAt)],
        ];
        const byStep = [...ingestStep, ...jobs.filter((j): j is [string, number] => j[1] != null).map(([step, minutes]) => ({ step, minutes: round(minutes, 1), runs: 1 }))];
        machine = { minutes: round(byStep.reduce((t, j) => t + j.minutes, 0), 1), source: 'records', byStep };
    }

    // Money: every charge the jobs recorded, by item and by service.
    const items = new Map<string, { label: string; usd: number; count: number; service: string }>();
    for (const c of (e.costs?.items ?? []) as CostItem[]) {
        if (c.item === 'descript_send') continue;   // plan credits, counted below
        const k = classify(c.item);
        const row = items.get(k.label) ?? { label: k.label, usd: 0, count: 0, service: k.service };
        row.usd += c.usd || 0;
        row.count += 1;
        items.set(k.label, row);
    }
    const services = new Map<string, number>();
    for (const r of items.values()) services.set(r.service, (services.get(r.service) ?? 0) + r.usd);
    const totalUsd = round([...items.values()].reduce((t, r) => t + r.usd, 0));

    // Descript: every send is logged since 30 Sept 2026; before that only the last one was kept.
    const sends = ((e.costs?.items ?? []) as CostItem[]).filter(c => c.item === 'descript_send');
    const descript = sends.length
        ? {
            aiCredits: round(sends.reduce((t, c) => t + (c.aiCredits ?? 0), 0), 1),
            mediaMinutes: Math.round(sends.reduce((t, c) => t + (c.mediaSeconds ?? 0), 0) / 60),
            sends: sends.length, allSends: true,
        }
        : {
            aiCredits: round(e.descript?.aiCreditsUsed ?? 0, 1),
            mediaMinutes: Math.round((e.descript?.mediaSecondsUsed ?? 0) / 60),
            sends: e.descript?.status === 'ready' ? 1 : 0, allSends: false,
        };

    const lengthMinutes = e.media?.durationSeconds ? round(e.media.durationSeconds / 60, 1) : null;
    return {
        episodeId,
        title: e.title,
        lengthMinutes,
        startedAt,
        onYoutubeAt,
        shortsDoneAt,
        elapsedHours: startedAt != null && onYoutubeAt != null ? round((onYoutubeAt - startedAt) / 3_600_000, 1) : null,
        milestones,
        machine,
        money: {
            totalUsd,
            byService: [...services.entries()].map(([service, usd]) => ({ service, usd: round(usd) })).sort((a, b) => b.usd - a.usd),
            items: [...items.values()].map(({ label, usd, count }) => ({ label, usd: round(usd), count })).sort((a, b) => b.usd - a.usd),
        },
        descript,
        usdPerEpisodeMinute: lengthMinutes ? round(totalUsd / lengthMinutes, 3) : null,
    };
}

// What a new episode of this length should take, from the finished ones.
export function projectUsage(lengthMinutes: number | null, finished: EpisodeUsage[]) {
    const done = finished.filter(f => f.lengthMinutes);
    if (!done.length || !lengthMinutes) return null;
    const perMinute = (f: (u: EpisodeUsage) => number) => done.reduce((t, u) => t + f(u) / u.lengthMinutes!, 0) / done.length;
    return {
        basedOn: done.length,
        usd: round(perMinute(u => u.money.totalUsd) * lengthMinutes),
        machineMinutes: Math.round(perMinute(u => u.machine.minutes) * lengthMinutes),
        aiCredits: Math.round(perMinute(u => u.descript.aiCredits) * lengthMinutes),
        elapsedHours: (() => {
            const e = done.filter(u => u.elapsedHours != null);
            return e.length ? round(e.reduce((t, u) => t + u.elapsedHours!, 0) / e.length, 1) : null;
        })(),
    };
}

export type UsageProjection = NonNullable<ReturnType<typeof projectUsage>>;

// One post on the Usage page: `usage_reports/{id}` in Firestore.
export interface UsageReport {
    episodeId: string;
    title: string;
    kind: 'started' | 'finished';
    at: number;
    usage: EpisodeUsage;
    projection: UsageProjection | null;     // for "started": what it should take
}
