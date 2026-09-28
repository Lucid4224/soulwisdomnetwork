// Descript's API (https://docs.descriptapi.com): authenticated calls with retries, and waiting
// for a background job. Shared by descript.ts (making the project) and final.ts (publishing it).

const API = 'https://descriptapi.com/v1';
const POLL_MS = 20_000;
const JOB_TIMEOUT_MS = 110 * 60_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class DescriptError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export interface Job {
    job_id: string;
    job_state: 'queued' | 'running' | 'stopped' | 'cancelled';
    project_url?: string;
    progress?: { label: string; percent?: number };
    result?: {
        status: string;
        error_message?: string;
        media_status?: Record<string, { status: string; error_message?: string }>;
        media_seconds_used?: number;
        created_compositions?: { id: string; name: string }[];
        agent_response?: string;
        ai_credits_used?: number;
        // Publish jobs
        share_url?: string;
        download_url?: string;
        download_url_expires_at?: string;
    };
}

export function createDescript(token: string) {
    async function call<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            const res = await fetch(`${API}${route}`, {
                method,
                headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined,
            });
            if (res.ok) return res.json() as Promise<T>;
            const text = await res.text();
            // Rate limited or a passing server error: wait as told, a few times.
            if ((res.status === 429 || res.status >= 500) && attempt < 5) {
                const wait = Number(res.headers.get('retry-after')) || 5 * attempt;
                console.log(`  ⏳ Descript ${res.status}; retrying in ${wait}s`);
                await sleep(wait * 1000);
                continue;
            }
            let message = text.slice(0, 300);
            try {
                const e = JSON.parse(text) as { error?: string; message?: string };
                message = [e.error, e.message].filter(Boolean).join(': ') || message;
            } catch { /* not JSON */ }
            const hint = res.status === 401 ? ' (check the DESCRIPT_API_TOKEN secret)'
                : res.status === 402 ? ' (the Descript plan is out of media minutes or AI credits)' : '';
            throw new DescriptError(`Descript ${method} ${route} failed with ${res.status}: ${message}${hint}`, res.status);
        }
    }

    async function waitFor(jobId: string, what: string): Promise<Job> {
        const started = Date.now();
        let last = '';
        while (Date.now() - started < JOB_TIMEOUT_MS) {
            const job = await call<Job>('GET', `/jobs/${encodeURIComponent(jobId)}`);
            if (job.job_state === 'stopped') return job;
            if (job.job_state === 'cancelled') throw new Error(`The Descript ${what} job was cancelled`);
            const now = job.progress ? `${job.progress.label}${job.progress.percent != null ? ` ${job.progress.percent}%` : ''}` : job.job_state;
            if (now !== last) console.log(`  … ${what}: ${now}`);
            last = now;
            await sleep(POLL_MS);
        }
        throw new Error(`The Descript ${what} job did not finish within ${JOB_TIMEOUT_MS / 60_000} minutes; check the project in Descript`);
    }

    return { call, waitFor };
}
