// Starts and watches the Podcast Ingest workflow (.github/workflows/podcast_ingest.yml)
// and starts Podcast Show Notes, B-roll, Edit Package, Descript, Final Cut, Thumbnails, YouTube and Shorts (podcast_notes, _broll, _package, _descript, _final, _thumbnails, _youtube, _shorts.yml), with GITHUB_ACTIONS_TOKEN: a fine-grained token for this repository, Actions read/write.

const REPO = 'masterytv/soulwisdomnetwork';
const WORKFLOW = 'podcast_ingest.yml';

async function github(path: string, init: RequestInit = {}) {
    const token = process.env.GITHUB_ACTIONS_TOKEN;
    if (!token) throw new Error('GITHUB_ACTIONS_TOKEN is not set');
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...init.headers,
        },
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
}

export interface WorkflowRun {
    id: number;
    status: string;             // queued | in_progress | completed
    conclusion: string | null;  // success | failure | cancelled | ...
    event: string;              // schedule | workflow_dispatch
    createdAt: string;
    url: string;
}

export async function latestIngestRuns(count = 5): Promise<WorkflowRun[]> {
    const res = await github(`/actions/workflows/${WORKFLOW}/runs?per_page=${count}`);
    const data = await res.json() as { workflow_runs: Array<Record<string, unknown>> };
    return data.workflow_runs.map(r => ({
        id: r.id as number,
        status: r.status as string,
        conclusion: r.conclusion as string | null,
        event: r.event as string,
        createdAt: r.created_at as string,
        url: r.html_url as string,
    }));
}

export async function startIngest(inputs: { skip_wait?: boolean; dry_run?: boolean; retry_file_id?: string } = {}) {
    // Workflow inputs are strings on the wire.
    const wire = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)]));
    await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: wire }),
    });
}

// Drafts show notes for one episode (spec 005 step 5).
export async function startNotes(episodeId: string) {
    await github('/actions/workflows/podcast_notes.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId } }),
    });
}

// Generates b-roll stills for one episode (spec 005 step 7); `index` regenerates just one.
export async function startBroll(episodeId: string, index: number | null) {
    await github('/actions/workflows/podcast_broll.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId, index: index === null ? '' : String(index) } }),
    });
}

// Builds the edit package for Descript (spec 005 step 8, part 1).
export async function startPackage(episodeId: string) {
    await github('/actions/workflows/podcast_package.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId } }),
    });
}

// Makes the Descript project from the edit package (spec 005 step 8, part 2).
export async function startDescript(episodeId: string) {
    await github('/actions/workflows/podcast_descript.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId } }),
    });
}

// Publishes the edited episode from Descript and re-times the notes (spec 005 steps 10-11).
export async function startFinal(episodeId: string) {
    await github('/actions/workflows/podcast_final.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId } }),
    });
}

// Makes thumbnail options (spec 005 step 12); `onlyImage` makes just a new AI background.
export async function startThumbnails(episodeId: string, onlyImage: boolean) {
    await github('/actions/workflows/podcast_thumbnails.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId, only: onlyImage ? 'image' : '' } }),
    });
}

// Uploads the approved episode to YouTube, or updates the video already there (spec 005 step 13).
export async function startYoutube(episodeId: string) {
    await github('/actions/workflows/podcast_youtube.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId } }),
    });
}

// Writes headlines and titles for, draws or schedules the shorts of one episode (spec 005 step 14).
export async function startShorts(episodeId: string, mode: 'titles' | 'render' | 'upload') {
    await github('/actions/workflows/podcast_shorts.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { episode_id: episodeId, mode } }),
    });
}

export interface PodcastRun {
    workflow: string;           // e.g. "Podcast Final Cut"
    title: string;              // the run name; ends with " · <episode ID>" since 30 Sept 2026
    startedAt: number;
    minutes: number;
    ok: boolean;
}

// Every finished run since `since` (up to 500), for the Usage page.
export async function podcastRuns(since: Date): Promise<PodcastRun[]> {
    const out: PodcastRun[] = [];
    const created = since.toISOString().slice(0, 10);
    for (let page = 1; page <= 5; page++) {
        const res = await github(`/actions/runs?per_page=100&page=${page}&status=completed&created=%3E%3D${created}`);
        const data = await res.json() as { workflow_runs: Array<Record<string, unknown>> };
        for (const r of data.workflow_runs) {
            const start = Date.parse((r.run_started_at ?? r.created_at) as string);
            const end = Date.parse(r.updated_at as string);
            if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
            out.push({
                workflow: r.name as string, title: (r.display_title as string) ?? '',
                startedAt: start, minutes: Math.max(0, (end - start) / 60_000), ok: r.conclusion === 'success',
            });
        }
        if (data.workflow_runs.length < 100) break;
    }
    return out;
}
