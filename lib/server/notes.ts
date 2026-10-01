// Show notes for one episode (docs/specs/007-show-notes.md): ask GitHub Actions to draft
// them, load and save a producer's edits, and approve them (Checkpoint B).

import { FieldValue } from 'firebase-admin/firestore';
import { fillMissingEnds, parseShowNotes, sameNotes, StoredShowNotesSchema, type ShowNotes, type SpokenWord } from '@/lib/showNotes';
import type { Episode, EpisodeNotes, NotesApproval } from '@/types/episode';
import type { EpisodeNotesView } from '@/types/studio';
import { adminBucket, adminDb } from './firebaseAdmin';
import { startNotes } from './github';
import { ESTIMATE_USD, withinDailyLimit } from './spending';
import { HttpError } from './staff';

const VIDEO_LINK_MS = 6 * 60 * 60_000;
// A request that has not turned into notes by now is treated as lost and can be retried.
const STALE_MS = 20 * 60_000;

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

// Earlier approvals, by the version they approved (NotesApproval).
function approvalRef(id: string, version: number) {
    return episodeRef(id).collection('approvals').doc(String(version));
}

function millis(t: unknown): number | null {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : null;
}

function busy(notes: EpisodeNotes | undefined) {
    if (notes?.status !== 'queued' && notes?.status !== 'generating') return false;
    const since = Math.max(millis(notes.requestedAt) ?? 0, millis(notes.startedAt) ?? 0);
    return Date.now() - since < STALE_MS;
}

// Starts the Podcast Show Notes workflow. Approved notes are only redrafted when `force`.
export async function requestNotes(id: string, { force = false } = {}) {
    const ref = episodeRef(id);
    await adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        if (!episode) throw new HttpError(404, 'Episode not found');
        if (episode.status !== 'speakers_confirmed') throw new HttpError(409, 'Accept the transcript first');
        if (busy(episode.notes)) throw new HttpError(409, 'Show notes are already being drafted');
        if (episode.notes?.status === 'approved' && !force) throw new HttpError(409, 'Show notes are already approved');
        tx.update(ref, {
            'notes.status': 'queued',
            'notes.requestedAt': FieldValue.serverTimestamp(),
            'notes.error': null,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
    try {
        await withinDailyLimit('show notes', ESTIMATE_USD.notes, () => startNotes(id));
    } catch (error) {
        const message = `Could not start drafting: ${(error as Error).message}`;
        await ref.update({ 'notes.status': 'failed', 'notes.error': message });
        throw new HttpError(502, message);
    }
}

// reviewed.json is rewritten on every Accept, so it is cached by path and acceptance time.
const wordCache = new Map<string, SpokenWord[]>();

async function acceptedWords(episode: Episode): Promise<SpokenWord[]> {
    const path = episode.review?.reviewedPath;
    if (!path) return [];
    const key = `${path}@${millis(episode.review?.acceptedAt)}`;
    const cached = wordCache.get(key);
    if (cached) return cached;
    const [raw] = await adminBucket().file(path).download();
    const lines = (JSON.parse(raw.toString('utf8')) as {
        lines: { name: string; clip: boolean; words: { text: string; start: number; end: number }[] }[];
    }).lines;
    const words = lines.flatMap(l => l.words.map(w => ({ text: w.text, start: w.start, end: w.end, speaker: l.name, clip: l.clip })));
    if (wordCache.size >= 5) wordCache.delete(wordCache.keys().next().value!);
    wordCache.set(key, words);
    return words;
}

// Drafts saved before a field existed get its default (e.g. no teaser clips), so the page
// always receives the current shape. Returned as stored if it does not parse at all.
function upgrade(draft: ShowNotes | undefined, words: SpokenWord[]): ShowNotes | null {
    if (!draft) return null;
    const parsed = StoredShowNotesSchema.safeParse(draft);
    return parsed.success ? fillMissingEnds(parsed.data, words) : draft;
}

// The steps made from approved notes, each recording which approval it used.
const MADE_FROM = ['package', 'descript', 'final', 'approval'] as const;
type MadeFromStep = typeof MADE_FROM[number];

// The newest earlier approval that a finished later step was made from, with the steps made from
// it; null when every step is on the current approval.
function madeFromEarlier(episode: Episode): { version: number; steps: MadeFromStep[] } | null {
    const current = episode.notes?.approvedVersion ?? 0;
    const used = MADE_FROM.flatMap(key => {
        const step = episode[key];
        const ready = key === 'approval' || (step as { status?: string } | undefined)?.status === 'ready';
        const version = step?.notesVersion;
        return ready && typeof version === 'number' && version !== current ? [{ version, key }] : [];
    });
    if (!used.length) return null;
    const version = Math.max(...used.map(u => u.version));
    return { version, steps: used.filter(u => u.version === version).map(u => u.key) };
}

export async function getNotes(id: string): Promise<EpisodeNotesView> {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    const n = episode.notes;
    const earlier = n?.approved ? madeFromEarlier(episode) : null;
    const [videoUrl, words, kept] = await Promise.all([
        episode.media?.proxyPath
            ? adminBucket().file(episode.media.proxyPath)
                .getSignedUrl({ action: 'read', expires: Date.now() + VIDEO_LINK_MS }).then(([url]) => url)
            : Promise.resolve(null),
        acceptedWords(episode),
        earlier ? approvalRef(id, earlier.version).get().then(d => d.data() as NotesApproval | undefined) : Promise.resolve(undefined),
    ]);
    return {
        id,
        title: episode.title,
        recordedAt: episode.recordedAt ?? null,
        durationSeconds: episode.media?.durationSeconds ?? null,
        videoUrl,
        transcriptAccepted: episode.status === 'speakers_confirmed',
        words,
        notes: n ? {
            // A request whose run died reads as failed, so the page offers a retry.
            status: (n.status === 'queued' || n.status === 'generating') && !busy(n) ? 'failed' : n.status,
            draft: upgrade(n.draft, words),
            version: n.version ?? 0,
            model: n.model ?? null,
            unverifiedQuotes: n.unverifiedQuotes ?? [],
            error: n.error ?? ((n.status === 'queued' || n.status === 'generating') && !busy(n)
                ? 'Drafting did not finish. Check the Podcast Show Notes run in GitHub Actions, then try again.' : null),
            requestedAt: millis(n.requestedAt),
            generatedAt: millis(n.generatedAt),
            approved: n.approvedBy && n.approved
                ? { by: n.approvedBy.name, at: millis(n.approvedAt) ?? 0, version: n.approvedVersion ?? 0, notes: upgrade(n.approved, words)! }
                : null,
            madeFrom: earlier ? {
                ...earlier,
                notes: kept ? upgrade(kept.notes, words) : null,
                by: kept?.by?.name ?? null,
                at: kept ? millis(kept.at) : null,
            } : null,
        } : null,
    };
}

export async function saveNotes(id: string, input: unknown, version: unknown) {
    let draft;
    try {
        draft = parseShowNotes(input);
    } catch (error) {
        throw new HttpError(400, `Invalid show notes: ${(error as Error).message}`);
    }
    const ref = episodeRef(id);
    return adminDb().runTransaction(async tx => {
        const notes = ((await tx.get(ref)).data() as Episode | undefined)?.notes;
        if (!notes?.draft) throw new HttpError(409, 'There are no show notes to edit yet');
        if (busy(notes)) throw new HttpError(409, 'New notes are being drafted; your edits would be replaced');
        const current = notes.version ?? 0;
        if (version !== current) throw new HttpError(409, 'Someone else changed these notes. Reload to see their changes.');
        tx.update(ref, { 'notes.draft': draft, 'notes.version': current + 1, updatedAt: FieldValue.serverTimestamp() });
        return current + 1;
    });
}

async function producer(user: { uid: string }) {
    const profile = (await adminDb().collection('users').doc(user.uid).get()).data() ?? {};
    return { uid: user.uid, name: (profile.displayName as string) || (profile.email as string) || 'a producer' };
}

// The current approval, as kept when another replaces it.
function keepApproval(notes: EpisodeNotes): NotesApproval {
    return {
        notes: notes.approved!, version: notes.approvedVersion ?? 0, by: notes.approvedBy ?? null,
        at: notes.approvedAt ?? null, replacedAt: FieldValue.serverTimestamp(),
    };
}

// Checkpoint B: freezes the current draft as the approved notes. Approving notes that say the
// same as the approved ones changes nothing, so later steps do not read as out of date.
export async function approveNotes(id: string, version: unknown, user: { uid: string }) {
    const ref = episodeRef(id);
    const approvedBy = await producer(user);
    await adminDb().runTransaction(async tx => {
        const notes = ((await tx.get(ref)).data() as Episode | undefined)?.notes;
        if (!notes?.draft) throw new HttpError(409, 'There are no show notes to approve yet');
        if (busy(notes)) throw new HttpError(409, 'New notes are being drafted');
        if (version !== (notes.version ?? 0)) throw new HttpError(409, 'Someone else changed these notes. Reload to see their changes.');
        if (notes.approved && notes.approvedBy && sameNotes(notes.draft, notes.approved)) {
            if (notes.status !== 'approved') tx.update(ref, { 'notes.status': 'approved', updatedAt: FieldValue.serverTimestamp() });
            return;
        }
        if (notes.approved) tx.set(approvalRef(id, notes.approvedVersion ?? 0), keepApproval(notes));
        tx.update(ref, {
            'notes.status': 'approved',
            'notes.approved': notes.draft,
            'notes.approvedBy': approvedBy,
            'notes.approvedAt': FieldValue.serverTimestamp(),
            'notes.approvedVersion': notes.version ?? 0,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });
}

// Throws away changes that are not approved: the draft goes back to the approved notes.
export async function discardChanges(id: string, version: unknown) {
    const ref = episodeRef(id);
    return adminDb().runTransaction(async tx => {
        const notes = ((await tx.get(ref)).data() as Episode | undefined)?.notes;
        if (!notes?.approved) throw new HttpError(409, 'There are no approved notes to go back to');
        if (busy(notes)) throw new HttpError(409, 'New notes are being drafted');
        const current = notes.version ?? 0;
        if (version !== current) throw new HttpError(409, 'Someone else changed these notes. Reload to see their changes.');
        tx.update(ref, {
            'notes.draft': notes.approved, 'notes.version': current + 1, 'notes.status': 'approved', 'notes.error': null,
            updatedAt: FieldValue.serverTimestamp(),
        });
        return current + 1;
    });
}

// Undoes later approvals: the notes a later step was made from become the approved notes again,
// under their old version, so that step and everything after it are up to date again. The
// approval being undone is kept, so this can be undone too. Approvals from before they were kept
// have no copy; then the producer puts the notes back by hand and the draft is used.
export async function restoreApproval(id: string, version: unknown, to: unknown, user: { uid: string }) {
    const ref = episodeRef(id);
    const approvedBy = await producer(user);
    return adminDb().runTransaction(async tx => {
        const episode = (await tx.get(ref)).data() as Episode | undefined;
        const notes = episode?.notes;
        if (!episode || !notes?.approved || !notes.draft) throw new HttpError(409, 'There are no approved notes yet');
        if (busy(notes)) throw new HttpError(409, 'New notes are being drafted');
        const current = notes.version ?? 0;
        if (version !== current) throw new HttpError(409, 'Someone else changed these notes. Reload to see their changes.');
        const earlier = madeFromEarlier(episode);
        if (!earlier || earlier.version !== to) throw new HttpError(409, 'Nothing was made from those notes. Reload the page.');
        const kept = (await tx.get(approvalRef(id, earlier.version))).data() as NotesApproval | undefined;
        const restored = kept?.notes ?? notes.draft;
        tx.set(approvalRef(id, notes.approvedVersion ?? 0), keepApproval(notes));
        tx.update(ref, {
            'notes.status': 'approved',
            'notes.draft': restored,
            'notes.approved': restored,
            'notes.version': current + 1,
            'notes.approvedVersion': earlier.version,
            'notes.approvedBy': kept?.by ?? approvedBy,
            'notes.approvedAt': kept?.at ?? FieldValue.serverTimestamp(),
            'notes.error': null,
            updatedAt: FieldValue.serverTimestamp(),
        });
        return current + 1;
    });
}
