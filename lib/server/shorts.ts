// Shorts and Checkpoint E (docs/specs/013-shorts.md): ask GitHub Actions to write headlines and
// titles for, draw or schedule the shorts the producer picked from the key quotes, keep the producer's edits, record which drawn short was approved, and show
// it all on the show notes page.

import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { TimedWord } from '@/lib/retime';
import {
    DEFAULT_ASPECT, renderInputs, sameRender, quoteMatch, SHORT_ASPECTS, SHORT_MAX_MS, ShortEditSchema, showsBroll, TRIM_WINDOW_MS, wordsBetween,
    type ShortAspect,
} from '@/lib/shorts';
import type { Episode, EpisodeShorts, ShortItem } from '@/types/episode';
import type { ShortsView } from '@/types/studio';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startShorts } from './github';
import { HttpError } from './staff';

// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 70 * 60_000;       // the workflow's own limit is 60 minutes
const LINK_MS = 3 * 60 * 60_000;
const MAX_ITEMS = 40;               // the notes allow up to 40 key quotes
const MIN_LEAD_MS = 30 * 60_000;    // the first scheduled short, at the earliest
const MAX_LEAD_MS = 180 * 24 * 60 * 60_000;

type Mode = 'titles' | 'render' | 'upload';

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

function busy(s: EpisodeShorts | undefined) {
    if (s?.status !== 'queued' && s?.status !== 'working') return false;
    const since = Math.max(millis(s.requestedAt) ?? 0, millis(s.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

const finalAt = (episode: Episode) => millis(episode.final?.finishedAt) ?? 0;

// Shorts come from a final cut that matches the approved notes, whose quotes they start from.
function finalProblem(episode: Episode) {
    const f = episode.final;
    if (episode.notes?.status !== 'approved') return 'Approve the show notes first';
    if (f?.status !== 'ready' || !f.wordsPath) return 'Get the final cut from Descript first';
    if (f.projectId !== episode.descript?.projectId || f.notesVersion !== episode.notes.approvedVersion) {
        return 'The final cut is out of date; get it again first';
    }
    if (!f.quotes?.length) return 'The final cut has no key quotes';
    return null;
}

const current = (item: ShortItem, shorts: EpisodeShorts, episode: Episode) =>
    !!item.render && sameRender(item.render, renderInputs(item, shorts.aspect ?? DEFAULT_ASPECT, finalAt(episode)));
const approved = (item: ShortItem, shorts: EpisodeShorts, episode: Episode) =>
    current(item, shorts, episode) && item.approved?.renderedAt === item.render?.renderedAt;

export async function requestShorts(id: string, body: { mode?: unknown; firstAt?: unknown; timeZone?: unknown }) {
    const mode = body.mode as Mode;
    if (!['titles', 'render', 'upload'].includes(mode)) throw new HttpError(400, 'Not a shorts job');
    const firstAt = Number(body.firstAt);
    if (mode === 'upload' && (!Number.isFinite(firstAt) || firstAt < Date.now() + MIN_LEAD_MS || firstAt > Date.now() + MAX_LEAD_MS)) {
        throw new HttpError(400, 'Pick a time for the first short at least half an hour from now');
    }
    const timeZone = typeof body.timeZone === 'string' && /^[\w/+-]{1,64}$/.test(body.timeZone) ? body.timeZone : 'UTC';
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        const problem = finalProblem(episode);
        if (problem) throw new HttpError(409, problem);
        const shorts = episode.shorts;
        if (busy(shorts)) throw new HttpError(409, 'The shorts job is already running');
        const update: Record<string, unknown> = {
            'shorts.status': 'queued', 'shorts.job': mode, 'shorts.requestedAt': FieldValue.serverTimestamp(), 'shorts.error': null,
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (!shorts) Object.assign(update, { 'shorts.aspect': DEFAULT_ASPECT, 'shorts.items': [], 'shorts.version': 0 });
        const items = shorts?.items ?? [];
        if (!items.length) throw new HttpError(409, 'Pick some key quotes for shorts first');
        if (mode === 'titles' && !items.some(i => !i.youtube && (!i.headline.trim() || !i.title.trim()))) {
            throw new HttpError(409, 'Every short already has a headline and a title; clear one to have it rewritten');
        }
        if (mode === 'render' && !items.some(i => !i.youtube && !current(i, shorts!, episode))) {
            throw new HttpError(409, 'Every short is already drawn');
        }
        if (mode === 'upload') {
            // One a day, in the order on the page, after any already scheduled.
            let n = 0;
            const scheduled = items.map(i => {
                if (i.youtube) return i;
                return { ...i, publishAt: approved(i, shorts!, episode) ? firstAt + n++ * 24 * 60 * 60_000 : null, error: null };
            });
            if (!n) throw new HttpError(409, 'Approve at least one short first');
            Object.assign(update, { 'shorts.items': scheduled, 'shorts.timeZone': timeZone });
        }
        tx.update(ref, update);
    });
    try {
        await startShorts(id, mode);
    } catch (error) {
        const message = `Could not start the shorts job: ${(error as Error).message}`;
        await ref.update({ 'shorts.status': 'failed', 'shorts.error': message });
        throw new HttpError(502, message);
    }
}

const SaveSchema = z.object({
    version: z.number().int().min(0),
    aspect: z.enum(SHORT_ASPECTS),
    items: z.array(ShortEditSchema).max(MAX_ITEMS),
});

// The producer's edits: which shorts, their ends, headline, title and flag, and the crop. What
// the jobs record (renders, approvals, uploads) is kept, and shorts on YouTube cannot change.
export async function saveShorts(id: string, body: unknown) {
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, 'The shorts did not come through in the expected shape');
    const { version, aspect, items } = parsed.data;
    const ref = episodeRef(id);
    return adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (episode.final?.status !== 'ready') throw new HttpError(409, 'Get the final cut from Descript first');
        const shorts = episode.shorts;
        if ((shorts?.version ?? 0) !== version) throw new HttpError(409, 'The shorts were changed elsewhere (or Claude just wrote their titles). Reload the page.');
        const durationMs = (episode.final.durationSeconds ?? 0) * 1000;
        const quoteCount = episode.final.quotes?.length ?? 0;
        const before = new Map((shorts?.items ?? []).map(i => [i.id, i]));
        const next: ShortItem[] = [];
        for (const edit of items) {
            const old = before.get(edit.id);
            if (old?.youtube) {
                next.push(old);
                continue;
            }
            if (edit.endMs <= edit.startMs || edit.endMs - edit.startMs > SHORT_MAX_MS || edit.endMs > durationMs + 1000) {
                throw new HttpError(400, `"${edit.title || edit.headline}" must be under three minutes and inside the episode`);
            }
            if (edit.quoteIndex !== null && edit.quoteIndex >= quoteCount) throw new HttpError(400, 'There is no such quote');
            if (/[<>]/.test(edit.title)) throw new HttpError(400, 'YouTube does not allow < or > in titles');
            // A new short is flagged when AI b-roll may show in it; the producer can untick it.
            const synthetic = edit.synthetic || (!old && showsBroll(Object.values(episode.broll?.images ?? {}),
                edit.quoteIndex !== null ? episode.final.quotes?.[edit.quoteIndex] : undefined, edit.startMs, edit.endMs));
            next.push({ ...old, ...edit, synthetic, headline: edit.headline.replace(/\s+/g, ' '), title: edit.title.replace(/\s+/g, ' ') });
        }
        // A short already on YouTube stays listed even if the page left it out.
        for (const old of before.values()) {
            if (old.youtube && !next.some(i => i.id === old.id)) next.push(old);
        }
        const nextVersion = version + 1;
        tx.update(ref, {
            ...(shorts ? {} : { 'shorts.status': 'ready', 'shorts.job': null }),
            'shorts.aspect': aspect, 'shorts.items': next, 'shorts.version': nextVersion,
            updatedAt: FieldValue.serverTimestamp(),
        });
        return nextVersion;
    });
}

// Checkpoint E, one short at a time: approves the render as it is now.
export async function approveShort(id: string, body: { item?: unknown; approved?: unknown }, user: { uid: string }) {
    if (typeof body.item !== 'string') throw new HttpError(400, 'Which short?');
    const ref = episodeRef(id);
    const profile = (await adminDb().collection('users').doc(user.uid).get()).data() ?? {};
    const by = { uid: user.uid, name: (profile.displayName as string) || (profile.email as string) || 'a producer' };
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        const shorts = episode?.shorts;
        const item = shorts?.items.find(i => i.id === body.item);
        if (!episode || !shorts || !item) throw new HttpError(404, 'No such short');
        if (item.youtube) throw new HttpError(409, 'This short is already on YouTube');
        if (body.approved && !current(item, shorts, episode)) throw new HttpError(409, 'Draw this short again first; it changed since it was drawn');
        if (body.approved && !item.title.trim()) throw new HttpError(409, 'Give the short a YouTube title first');
        const approval = body.approved ? { by, at: Date.now(), renderedAt: item.render!.renderedAt } : null;
        tx.update(ref, {
            'shorts.items': shorts.items.map(i => (i.id === item.id ? { ...i, approved: approval, publishAt: null } : i)),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
}

// The final cut's words, kept between requests while the page polls.
const wordCache = new Map<string, TimedWord[]>();

async function finalWords(episode: Episode) {
    const path = episode.final?.wordsPath;
    if (!path) return [];
    const key = `${path}@${finalAt(episode)}`;
    const hit = wordCache.get(key);
    if (hit) return hit;
    const [raw] = await adminBucket().file(path).download();
    const words = (JSON.parse(raw.toString('utf8')) as { words: TimedWord[] }).words;
    if (wordCache.size > 4) wordCache.delete(wordCache.keys().next().value!);
    wordCache.set(key, words);
    return words;
}

const signed = (path: string) => adminBucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + LINK_MS }).then(([url]) => url);

// The latest publish time taken by any episode's shorts, so the next batch can follow on.
async function lastSlot() {
    const snap = await adminDb().collection('episodes').select('shorts.items').get();
    let last: number | null = null;
    for (const doc of snap.docs) {
        for (const i of ((doc.get('shorts.items') ?? []) as ShortItem[])) {
            const at = i.youtube?.publishAt ?? null;
            if (at && (last === null || at > last)) last = at;
        }
    }
    return last;
}

export async function getShorts(id: string): Promise<ShortsView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const s = episode.shorts;
    const lost = (s?.status === 'queued' || s?.status === 'working') && !busy(s);
    const ready = episode.final?.status === 'ready';
    const [words, finalUrl, slot] = await Promise.all([
        ready ? finalWords(episode) : Promise.resolve([]),
        ready && episode.final?.videoPath ? signed(episode.final.videoPath) : Promise.resolve(null),
        lastSlot(),
    ]);
    const quotes = ready ? episode.final!.quotes ?? [] : [];
    const items = await Promise.all((s?.items ?? []).map(async i => {
        const q = i.quoteIndex !== null ? quotes[i.quoteIndex] : undefined;
        const from = Math.min(i.startMs, q?.startMs ?? i.startMs) - TRIM_WINDOW_MS;
        const to = Math.max(i.endMs, q?.endMs ?? i.endMs) + TRIM_WINDOW_MS;
        return {
            id: i.id, quoteIndex: i.quoteIndex, speaker: i.speaker, startMs: i.startMs, endMs: i.endMs,
            headline: i.headline, title: i.title, synthetic: i.synthetic,
            words: wordsBetween(words, from, to),
            render: i.render ? {
                key: String(i.render.renderedAt), url: await signed(i.render.path), durationMs: i.render.durationMs,
                inputs: {
                    startMs: i.render.startMs, endMs: i.render.endMs, headline: i.render.headline, speaker: i.render.speaker,
                    aspect: i.render.aspect, finalAt: i.render.finalAt,
                },
            } : null,
            approved: approved(i, s!, episode) && i.approved ? { by: i.approved.by.name, at: i.approved.at } : null,
            publishAt: i.publishAt ?? null,
            youtube: i.youtube ? { url: i.youtube.url, publishAt: i.youtube.publishAt } : null,
            error: i.error ?? null,
        };
    }));
    const labels: Record<string, string> = { titles: 'Writing the headlines and titles', render: 'Drawing the shorts', upload: 'Scheduling the shorts' };
    return {
        // A request whose run died reads as failed, so the page offers a retry.
        status: lost ? 'failed' : s?.status ?? null,
        job: s?.job ?? null,
        error: s?.error ?? (lost ? `${(s?.job && labels[s.job]) || 'The shorts job'} did not finish. Check the Podcast Shorts run in GitHub Actions, then try again.` : null),
        blocker: finalProblem(episode),
        episodeUrl: episode.youtube?.url ?? null,
        aspect: (s?.aspect ?? DEFAULT_ASPECT) as ShortAspect,
        version: s?.version ?? 0,
        finalAt: finalAt(episode),
        finalUrl,
        quotes: quotes.map(q => ({
            text: q.text, speaker: q.speaker, startMs: q.startMs, endMs: q.endMs,
            match: quoteMatch(q.text, wordsBetween(words, q.startMs - 2000, q.endMs + 2000)),
        })),
        items,
        lastSlot: slot,
        warnings: s?.status === 'ready' ? s.warnings ?? [] : [],
        finishedAt: millis(s?.finishedAt),
    };
}
