// Speaker review for one episode (docs/specs/006-podcast-studio.md, page 2): load the
// transcript and video, save a person's corrections, and accept the result.

import type { Transcript } from 'assemblyai';
import { FieldValue } from 'firebase-admin/firestore';
import { getSettings } from './studioSettings';
import { labelResolver } from '@/agent/src/podcast/transcribe';
import {
    buildLines, emptyCorrections, isNamed, parseCorrections, reviewedText, speakerName,
    type ReviewUtterance,
} from '@/lib/transcript';
import type { Episode } from '@/types/episode';
import type { EpisodeReview } from '@/types/studio';
import { studioDrive } from './drive';
import { requestNotes } from './notes';
import { episodeProgress } from './pipeline';
import { adminBucket, adminDb } from './firebaseAdmin';
import { HttpError } from './staff';

const REVIEWABLE: Episode['status'][] = ['awaiting_speaker_review', 'speakers_confirmed'];
const VIDEO_LINK_MS = 6 * 60 * 60_000;

function episodeRef(id: string) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    return adminDb().collection('episodes').doc(id);
}

async function loadEpisode(id: string) {
    const snap = await episodeRef(id).get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');
    const episode = snap.data() as Episode;
    if (!REVIEWABLE.includes(episode.status) || !episode.transcription?.transcriptPath) {
        throw new HttpError(409, 'This episode has no transcript to review yet');
    }
    return episode;
}

// raw.json never changes, so each server instance keeps the last few it has slimmed.
const utteranceCache = new Map<string, ReviewUtterance[]>();

async function loadUtterances(path: string): Promise<ReviewUtterance[]> {
    const cached = utteranceCache.get(path);
    if (cached) return cached;
    const [raw] = await adminBucket().file(path).download();
    const transcript = JSON.parse(raw.toString('utf8')) as Transcript;
    const { labelOf } = labelResolver(transcript);
    const utterances = (transcript.utterances ?? []).map(u => ({
        label: labelOf(u.speaker),
        words: (u.words ?? []).map(w => ({ text: w.text, start: w.start, end: w.end })),
    })).filter(u => u.words.length);
    if (utteranceCache.size >= 5) utteranceCache.delete(utteranceCache.keys().next().value!);
    utteranceCache.set(path, utterances);
    return utterances;
}

function millis(t: unknown) {
    return t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis: () => number }).toMillis() : 0;
}

// Names confirmed on earlier episodes, for the rename list, with the Studio settings' speaker
// names (the hosts by default). The people directory (PR 4) will replace this.
async function knownNames() {
    const names = new Set((await getSettings()).hosts);
    const done = await adminDb().collection('episodes').where('status', '==', 'speakers_confirmed').get();
    for (const d of done.docs) {
        for (const s of Object.values((d.data() as Episode).corrections?.speakers ?? {})) {
            if (s.name) names.add(s.name);
        }
    }
    return [...names].sort();
}

export async function getReview(id: string): Promise<EpisodeReview> {
    const episode = await loadEpisode(id);
    const [utterances, names, videoUrl] = await Promise.all([
        loadUtterances(episode.transcription!.transcriptPath!),
        knownNames(),
        episode.media?.proxyPath
            ? adminBucket().file(episode.media.proxyPath)
                .getSignedUrl({ action: 'read', expires: Date.now() + VIDEO_LINK_MS })
                .then(([url]) => url)
            : Promise.resolve(null),
    ]);
    const accepted = episode.review?.acceptedBy
        ? { by: episode.review.acceptedBy.name, at: millis(episode.review.acceptedAt), version: episode.review.acceptedVersion ?? null }
        : null;
    return {
        id,
        title: episode.title,
        status: episode.status,
        recordedAt: episode.recordedAt ?? null,
        durationSeconds: episode.media?.durationSeconds ?? null,
        docUrl: episode.review?.docUrl ?? null,
        videoUrl,
        voices: episode.transcription?.speakers ?? [],
        utterances,
        corrections: { ...emptyCorrections(), ...episode.corrections },
        version: episode.correctionsVersion ?? 0,
        accepted,
        knownNames: names,
        progress: episodeProgress(episode),   // how far the episode has got after speaker review
    };
}

export async function saveCorrections(id: string, input: unknown, version: unknown) {
    const episode = await loadEpisode(id);
    const utterances = await loadUtterances(episode.transcription!.transcriptPath!);
    let corrections;
    try {
        corrections = parseCorrections(input, utterances.length);
    } catch (error) {
        throw new HttpError(400, (error as Error).message);
    }
    const ref = episodeRef(id);
    return adminDb().runTransaction(async tx => {
        const current = ((await tx.get(ref)).get('correctionsVersion') as number | undefined) ?? 0;
        if (version !== current) {
            throw new HttpError(409, 'Someone else changed this review. Reload to see their changes.');
        }
        tx.update(ref, { corrections, correctionsVersion: current + 1, updatedAt: FieldValue.serverTimestamp() });
        return current + 1;
    });
}

function docIdFrom(url: string) {
    return url.match(/\/d\/([\w-]+)/)?.[1] ?? null;
}

// Writes transcripts/reviewed.json and .txt, replaces the Google Doc's text (Drive keeps
// the earlier version in its history) and marks the speakers confirmed.
export async function acceptReview(id: string, version: unknown, user: { uid: string }) {
    const episode = await loadEpisode(id);
    if (version !== (episode.correctionsVersion ?? 0)) {
        throw new HttpError(409, 'Someone else changed this review. Reload to see their changes.');
    }
    const utterances = await loadUtterances(episode.transcription!.transcriptPath!);
    const voices = episode.transcription?.speakers ?? [];
    const corrections = { ...emptyCorrections(), ...episode.corrections };
    const lines = buildLines(utterances, voices, corrections);

    const unnamed = [...new Set(lines.map(l => l.label))].filter(label => !isNamed(voices, corrections, label));
    if (unnamed.length) {
        throw new HttpError(400, `Name every voice first: ${unnamed.map(l => speakerName(voices, corrections, l)).join(', ')}`);
    }

    const profile = (await adminDb().collection('users').doc(user.uid).get()).data() ?? {};
    const acceptedBy = { uid: user.uid, name: (profile.displayName as string) || (profile.email as string) || 'a producer' };
    const acceptedAt = new Date();
    const prefix = episode.transcription!.transcriptPath!.replace(/\/raw\.json$/, '');
    const reviewedPath = `${prefix}/reviewed.json`;
    const text = reviewedText(
        { title: episode.title, recordedAt: episode.recordedAt, durationSeconds: episode.media?.durationSeconds },
        lines, acceptedBy.name, acceptedAt,
    );

    const reviewed = {
        episodeId: id,
        acceptedBy,
        acceptedAt: acceptedAt.toISOString(),
        speakers: [...new Map(lines.map(l => [l.label, { label: l.label, name: l.name, clip: l.clip }])).values()],
        lines: lines.map(l => ({
            speaker: l.label, name: l.name, clip: l.clip, start: l.start, end: l.end, text: l.text, words: l.words,
        })),
    };
    try {
        await Promise.all([
            adminBucket().file(reviewedPath).save(JSON.stringify(reviewed), { contentType: 'application/json' }),
            adminBucket().file(`${prefix}/reviewed.txt`).save(text, { contentType: 'text/plain; charset=utf-8' }),
        ]);
    } catch (error) {
        if ((error as { code?: number }).code === 403) {
            throw new HttpError(500, 'The website cannot save to Cloud Storage. Give firebase-app-hosting-compute@ the Storage Object User role.');
        }
        throw error;
    }

    // The accepted transcript is safe in Storage by now; a Doc failure is reported, not fatal.
    let docError: string | null = null;
    const docId = episode.review?.docUrl ? docIdFrom(episode.review.docUrl) : null;
    if (docId) {
        try {
            await studioDrive().files.update({
                fileId: docId,
                supportsAllDrives: true,
                media: { mimeType: 'text/plain', body: text },
            });
        } catch (error) {
            docError = (error as Error).message;
            console.error('Doc update failed', error);
        }
    }

    await episodeRef(id).update({
        status: 'speakers_confirmed',
        'review.reviewedPath': reviewedPath,
        'review.acceptedBy': acceptedBy,
        'review.acceptedAt': FieldValue.serverTimestamp(),
        'review.acceptedVersion': episode.correctionsVersion ?? 0,
        updatedAt: FieldValue.serverTimestamp(),
    });

    // Spec 005 step 5 follows Checkpoint A automatically the first time (or after a failure).
    let notesStarted = false;
    if (!episode.notes || episode.notes.status === 'failed') {
        try {
            await requestNotes(id);
            notesStarted = true;
        } catch (error) {
            console.error('Could not start show notes', error);
        }
    }
    return { docUpdated: !!docId && !docError, docError, notesStarted };
}
