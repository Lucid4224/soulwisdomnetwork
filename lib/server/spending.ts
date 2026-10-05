// A limit on what the Studio's paid runs can spend in a day ($10 in any 24 hours), so a
// runaway loop or a misused account cannot run up a bill. The jobs record what each run cost
// on its episode (`costs.items`), but only when it finishes, so each paid start also reserves
// its estimate in `studio/spending`; the limit counts whichever of the two is higher. Runs that
// cost no money (the edit package, Descript's plan credits, YouTube) are not limited.

import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import type { Episode } from '@/types/episode';
import { adminDb } from './firebaseAdmin';
import { HttpError } from './staff';

export const DAILY_LIMIT_USD = 10;
const DAY_MS = 24 * 60 * 60_000;

// Rough costs of one run, for the reservation; the job records the real one.
export const ESTIMATE_USD = {
    notes: 0.5,           // Claude drafts the show notes from the transcript
    brollImage: 0.165,    // one OpenAI image (BROLL_USD_PER_IMAGE)
    thumbnails: 0.25,     // Claude's texts and an AI background
    shortsTitles: 0.05,   // Claude's headlines and titles
    shortsPick: 0.15,     // Claude reads the final cut and picks moments for Shorts
    finalPerHour: 0.21,   // transcribing the final cut (WORDS_USD_PER_HOUR in agent/src/podcast/final.ts)
    extras: 0.1,          // Claude's social posts and follow-up email
};

interface Reservation { id: string; at: number; usd: number; what: string }

const ledger = () => adminDb().collection('studio').doc('spending');

function millis(t: unknown): number {
    if (t instanceof Date) return t.getTime();
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : 0;
}

// What the jobs recorded in the last 24 hours, across every episode.
async function recorded(since: number) {
    const snap = await adminDb().collection('episodes').select('costs').get();
    let usd = 0;
    for (const d of snap.docs) {
        for (const item of (d.data() as Pick<Episode, 'costs'>).costs?.items ?? []) {
            if (millis(item.at) >= since) usd += item.usd ?? 0;
        }
    }
    return usd;
}

// Spent in the last 24 hours, for the Studio home page.
export async function spentToday() {
    const since = Date.now() - DAY_MS;
    const [actual, entries] = await Promise.all([
        recorded(since),
        ledger().get().then(d => ((d.get('entries') as Reservation[] | undefined) ?? []).filter(e => e.at >= since)),
    ]);
    return Math.max(actual, entries.reduce((t, e) => t + e.usd, 0));
}

const money = (usd: number) => `$${usd.toFixed(2)}`;

// Runs `start` (which queues a paid job) if its estimate fits under the limit. Refused runs
// change nothing; a start that fails gives its reservation back.
export async function withinDailyLimit<T>(what: string, usd: number, start: () => Promise<T>): Promise<T> {
    if (usd <= 0) return start();
    const since = Date.now() - DAY_MS;
    const actual = await recorded(since);
    const id = randomUUID();
    await adminDb().runTransaction(async tx => {
        const entries = (((await tx.get(ledger())).get('entries') as Reservation[] | undefined) ?? []).filter(e => e.at >= since);
        const spent = Math.max(actual, entries.reduce((t, e) => t + e.usd, 0));
        if (spent + usd > DAILY_LIMIT_USD) {
            throw new HttpError(429, `Daily spending limit: about ${money(spent)} spent on paid runs in the last 24 hours, and this `
                + `would add about ${money(usd)}; the limit is ${money(DAILY_LIMIT_USD)}. It frees up as earlier runs pass 24 hours.`);
        }
        tx.set(ledger(), { entries: [...entries, { id, at: Date.now(), usd, what }], updatedAt: FieldValue.serverTimestamp() });
    });
    try {
        return await start();
    } catch (error) {
        await adminDb().runTransaction(async tx => {
            const entries = ((await tx.get(ledger())).get('entries') as Reservation[] | undefined) ?? [];
            tx.update(ledger(), { entries: entries.filter(e => e.id !== id) });
        }).catch(() => {});
        throw error;
    }
}
