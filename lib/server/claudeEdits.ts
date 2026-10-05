// Why: the server side of Part I's two Claude jobs. Requesting caption translations or a retake
// search checks the episode is ready, the spending limit holds, and nothing is already running,
// then starts the notes job (which does the work); reading them back gives the editor and the
// show notes page what they show, with download links for the translated captions.

import { FieldValue } from 'firebase-admin/firestore';
import { cleanLanguages, languageName } from '@/lib/translate';
import type { Episode, EpisodeRetakes, EpisodeTranslations } from '@/types/episode';
import type { RetakesView, TranslationsView } from '@/types/studio';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startNotes } from './github';
import { ESTIMATE_USD, withinDailyLimit } from './spending';
import { HttpError } from './staff';
import { getSettings } from './studioSettings';

// A request that has not finished by now is treated as lost and can be retried.
const STALE_MS = 30 * 60_000;
const LINK_MS = 60 * 60_000;

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

// Whether a job is still running (queued or working and not stale).
function busy(x: { status: string; requestedAt?: unknown; startedAt?: unknown } | undefined) {
    if (x?.status !== 'queued' && x?.status !== 'working') return false;
    return Date.now() - Math.max(millis(x.requestedAt) ?? 0, millis(x.startedAt) ?? 0) < STALE_MS;
}

// The status as the page shows it: a queued or working job that is no longer busy reads as failed.
function shown<T extends { status: 'queued' | 'working' | 'ready' | 'failed'; error?: string | null; requestedAt?: unknown; startedAt?: unknown }>(x: T | undefined) {
    if (!x) return { status: null, error: null };
    const running = x.status === 'queued' || x.status === 'working';
    return running && !busy(x)
        ? { status: 'failed' as const, error: x.error ?? 'It did not finish. Check the Podcast Show Notes run in GitHub Actions, then try again.' }
        : { status: x.status, error: x.error ?? null };
}

// Why translating cannot start yet, or null when it can.
function cannotTranslate(episode: Episode): string | null {
    if (episode.final?.status !== 'ready' || !episode.final.wordsPath) return 'Make the final cut first; the captions come from its transcript.';
    return null;
}

// Starts translating the final cut's captions into the chosen languages (the notes job does it).
export async function requestTranslations(id: string, body: { languages?: unknown }) {
    const languages = cleanLanguages(body.languages);
    if (!languages.length) throw new HttpError(400, 'Choose at least one language');
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        const why = cannotTranslate(episode);
        if (why) throw new HttpError(409, why);
        if (busy(episode.translations)) throw new HttpError(409, 'Claude is already translating');
        tx.update(ref, {
            translations: { status: 'queued', languages, requestedAt: FieldValue.serverTimestamp(), error: null, tracks: episode.translations?.tracks ?? {} },
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
    try {
        await withinDailyLimit('caption translations', ESTIMATE_USD.translation * languages.length, () => startNotes(id));
    } catch (error) {
        const message = `Could not start translating: ${(error as Error).message}`;
        await ref.update({ 'translations.status': 'failed', 'translations.error': message });
        throw new HttpError(502, message);
    }
}

// The translations for the show notes page, with an hour-long download link for each language.
export async function getTranslations(id: string): Promise<TranslationsView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const t: EpisodeTranslations | undefined = episode.translations;
    const finalAt = millis(episode.final?.finishedAt) ?? 0;
    const tracks = await Promise.all(Object.entries(t?.tracks ?? {}).map(async ([code, track]) => ({
        code, name: languageName(code), missing: track.missing, withTitle: !!track.title,
        url: await adminBucket().file(track.path).getSignedUrl({ action: 'read', expires: Date.now() + LINK_MS }).then(([u]) => u).catch(() => null),
    })));
    return {
        ...shown(t),
        languages: t?.languages?.length ? t.languages : (await getSettings()).captionLanguages,
        canStart: cannotTranslate(episode),
        tracks,
        stale: !!tracks.length && t?.finalAt !== undefined && t.finalAt !== finalAt,
        onYoutube: !!episode.youtube?.videoId,
        generatedAt: millis(t?.generatedAt),
    };
}

// Starts Claude's search for retakes in the accepted transcript (the notes job does it).
export async function requestRetakes(id: string) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (episode.status !== 'speakers_confirmed' || !episode.review?.reviewedPath) throw new HttpError(409, 'Accept the transcript first');
        if (busy(episode.retakes)) throw new HttpError(409, 'Claude is already looking for retakes');
        tx.update(ref, {
            retakes: { status: 'queued', requestedAt: FieldValue.serverTimestamp(), error: null, found: episode.retakes?.found ?? [] },
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
    try {
        await withinDailyLimit('finding retakes', ESTIMATE_USD.retakes, () => startNotes(id));
    } catch (error) {
        const message = `Could not start looking: ${(error as Error).message}`;
        await ref.update({ 'retakes.status': 'failed', 'retakes.error': message });
        throw new HttpError(502, message);
    }
}

// The retakes for the editor.
export async function getRetakes(id: string): Promise<RetakesView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const r: EpisodeRetakes | undefined = (snap.data() as Episode).retakes;
    return { ...shown(r), found: r?.found ?? [], notFound: r?.notFound ?? 0, generatedAt: millis(r?.generatedAt) };
}
