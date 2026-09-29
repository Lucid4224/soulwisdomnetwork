"use client";

// Speaker review (docs/specs/006-podcast-studio.md, page 2): check who said what against
// the video, fix it, and accept the transcript. Every fix is saved as you go.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import LineRow, { type LineActions, type Voice } from "@/components/studio/review/LineRow";
import SpeakersPanel, { type VoiceRow } from "@/components/studio/review/SpeakersPanel";
import * as edit from "@/components/studio/review/corrections";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { ago, minutes } from "@/components/studio/format";
import { useAuth } from "@/context/AuthContext";
import { studioFetch } from "@/lib/studioClient";
import { allLabels, buildLines, findFlags, isNamed, rootLabel, speakerName } from "@/lib/transcript";
import type { TranscriptCorrections } from "@/types/episode";
import type { EpisodeReview } from "@/types/studio";

const COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399", "#f472b6", "#fb7185", "#facc15", "#2dd4bf", "#c084fc", "#94a3b8"];
const button = "text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} border-amber-500/40 text-amber-300 hover:bg-amber-500/10`;
const secondary = `${button} border-white/10 text-gray-300 hover:bg-white/10`;

type SaveState = "saved" | "unsaved" | "saving" | "error";

export default function SpeakerReviewPage() {
    const { episodeId } = useParams<{ episodeId: string }>();
    const { profile, loading } = useAuth();
    const allowed = profile?.role === "admin" || profile?.role === "producer";

    const [review, setReview] = useState<EpisodeReview | null>(null);
    const [corrections, setCorrections] = useState<TranscriptCorrections | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [accepting, setAccepting] = useState(false);
    const [currentMs, setCurrentMs] = useState(0);
    const [splitting, setSplitting] = useState<string | null>(null);
    const [onlyFlagged, setOnlyFlagged] = useState(false);
    const [follow, setFollow] = useState(false);
    const [savedVersion, setSavedVersion] = useState(0);   // corrections version on the server

    const video = useRef<HTMLVideoElement>(null);
    const version = useRef(0);
    const pending = useRef<TranscriptCorrections | null>(null);   // edits not yet sent
    const current = useRef<TranscriptCorrections | null>(null);   // latest edits, sent or not
    const inflight = useRef<Promise<void> | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flagCursor = useRef(-1);
    const saveError = useRef("");

    const load = useCallback(async () => {
        try {
            const data = await studioFetch<EpisodeReview>(`/api/studio/episodes/${episodeId}`);
            setReview(data);
            setCorrections(data.corrections);
            current.current = data.corrections;
            pending.current = null;
            version.current = data.version;
            setSavedVersion(data.version);
            setSaveState("saved");
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, [episodeId]);

    useEffect(() => {
        if (!loading && allowed) load();
    }, [loading, allowed, load]);

    // Saves the latest corrections; changes made while a save is running go in the next one.
    // `inflight` is set before the first await and cleared in `finally`, so it can never be
    // left pointing at a finished save (which would silently stop all later saves).
    const flush = useCallback(async (): Promise<void> => {
        if (timer.current) clearTimeout(timer.current);
        while (inflight.current) await inflight.current;
        if (!pending.current) return;
        let finished = () => {};
        inflight.current = new Promise<void>(resolve => { finished = resolve; });
        try {
            while (pending.current) {
                const next = pending.current;
                pending.current = null;
                setSaveState("saving");
                try {
                    const res = await studioFetch<{ version: number }>(`/api/studio/episodes/${episodeId}/corrections`, {
                        method: "PUT",
                        body: JSON.stringify({ corrections: next, version: version.current }),
                    });
                    version.current = res.version;
                    setSavedVersion(res.version);
                    saveError.current = "";
                } catch (e) {
                    saveError.current = (e as Error).message;
                    pending.current ??= next;
                    setSaveState("error");
                    setNotice(`⚠️ Not saved: ${(e as Error).message}`);
                    return;
                }
            }
            setSaveState("saved");
        } finally {
            inflight.current = null;
            finished();
        }
    }, [episodeId]);

    // The edit is applied here, outside React's state updater, so the change to save is
    // known immediately rather than whenever React next renders.
    const update = useCallback((fn: (c: TranscriptCorrections) => TranscriptCorrections) => {
        if (!current.current) return;
        const next = fn(current.current);
        current.current = next;
        pending.current = next;
        setCorrections(next);
        setSaveState("unsaved");
        setNotice("");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void flush(); }, 800);
    }, [flush]);

    // Warn before leaving with changes that haven't reached the server.
    useEffect(() => {
        if (saveState === "saved") return;
        const warn = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [saveState]);

    const lines = useMemo(
        () => (review && corrections ? buildLines(review.utterances, review.voices, corrections) : []),
        [review, corrections],
    );
    const flags = useMemo(() => (corrections ? findFlags(lines, corrections) : new Map()), [lines, corrections]);

    const labels = useMemo(() => (review && corrections ? allLabels(review.voices, corrections) : []), [review, corrections]);
    const colorOf = useMemo(() => new Map(labels.map((l, i) => [l, COLORS[i % COLORS.length]])), [labels]);
    const roots = useMemo(() => labels.filter(l => !corrections?.mergedInto[l]), [labels, corrections]);
    const voices: Voice[] = useMemo(
        () => (review && corrections
            ? roots.map(l => ({ label: l, name: speakerName(review.voices, corrections, l), color: colorOf.get(l)! }))
            : []),
        [review, corrections, roots, colorOf],
    );

    const rows: VoiceRow[] = useMemo(() => {
        if (!review || !corrections) return [];
        // AssemblyAI names one person heard as two voices "Tom Wood - 1" and "Tom Wood - 2".
        // Near-identical names ("Tom Wood" and "Tom Woods") are almost always one person typed twice.
        const name = (label: string) => speakerName(review.voices, corrections, label);
        const base = (label: string) => name(label).match(/^(.+?) - \d+$/)?.[1] ?? null;
        const key = (label: string) => (base(label) ?? name(label)).toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
        const talk = (label: string) => lines.filter(l => l.label === label).reduce((s, l) => s + l.end - l.start, 0);
        return roots.map(label => {
            const twin = roots.find(l => l !== label && key(l) === key(label) && !/^speaker/.test(key(l)));
            // Merge under the name of whichever voice talks more, without any " - 2" suffix.
            const keep = twin && talk(twin) >= talk(label) ? twin : label;
            const detected = review.voices.find(v => v.label === label);
            const own = lines.filter(l => l.label === label);
            const ownName = (l: string) => corrections.speakers[l]?.name
                || review.voices.find(v => v.label === l)?.suggestedName || `Speaker ${l}`;
            return {
                label,
                name: speakerName(review.voices, corrections, label),
                typed: corrections.speakers[label]?.name ?? detected?.suggestedName ?? "",
                placeholder: detected?.suggestedName ?? (detected ? `Voice ${label}: who is this?` : "Name"),
                named: isNamed(review.voices, corrections, label),
                clip: !!corrections.speakers[label]?.clip,
                color: colorOf.get(label)!,
                talkSeconds: Math.round(own.reduce((s, l) => s + (l.end - l.start) / 1000, 0)),
                lineCount: own.length,
                sampleMs: own[0]?.start ?? null,
                merged: labels.filter(l => l !== label && corrections.mergedInto[l] && rootLabel(corrections, l) === label)
                    .map(l => ({ label: l, name: ownName(l) })),
                sameAs: twin ? { label: twin, name: name(twin), base: base(keep) ?? name(keep) } : null,
            };
        });
    }, [review, corrections, roots, labels, lines, colorOf]);

    const unnamed = rows.filter(r => r.lineCount > 0 && !r.named);

    // The line playing now: the last one that starts at or before the playhead.
    const activeId = useMemo(() => {
        let lo = 0, hi = lines.length - 1, found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (lines[mid].start <= currentMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return found >= 0 ? lines[found].id : null;
    }, [lines, currentMs]);

    useEffect(() => {
        if (follow && activeId && !video.current?.paused) {
            document.getElementById(`line-${activeId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, [follow, activeId]);

    const seek = useCallback((ms: number) => {
        const v = video.current;
        if (!v) return;
        v.currentTime = ms / 1000;
        v.play().catch(() => {});
    }, []);

    const actions: LineActions = useMemo(() => ({
        seek,
        reassign: (line, label) => update(c => edit.reassign(c, line, label)),
        split: (line, word) => { update(c => edit.split(c, line, word)); setSplitting(null); },
        join: line => update(c => edit.join(c, line)),
        dismiss: line => update(c => edit.dismiss(c, line)),
        toggleSplit: setSplitting,
    }), [seek, update]);

    function nextFlag() {
        const ids = lines.filter(l => flags.has(l.id)).map(l => l.id);
        if (!ids.length) return;
        flagCursor.current = (flagCursor.current + 1) % ids.length;
        document.getElementById(`line-${ids[flagCursor.current]}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    async function accept() {
        if (!review) return;
        const doc = review.docUrl ? " and replaces the text of the Google Doc (Drive keeps the old version in its history)" : "";
        if (!confirm(`Accept this transcript for "${review.title}"? It becomes the official transcript for the next steps${doc}.`)) return;
        setAccepting(true);
        setNotice("");
        try {
            await flush();
            if (pending.current) throw new Error(`Your latest changes could not be saved: ${saveError.current}`);
            const res = await studioFetch<{ docUpdated: boolean; docError: string | null; notesStarted: boolean }>(
                `/api/studio/episodes/${episodeId}/accept`,
                { method: "POST", body: JSON.stringify({ version: version.current }) },
            );
            await load();
            setNotice(res.docError
                ? `⚠️ Transcript accepted, but the Google Doc could not be updated: ${res.docError}`
                : `Transcript accepted${res.docUpdated ? " and the Google Doc updated" : ""}.${res.notesStarted ? " Claude is drafting the show notes (a few minutes)." : ""}`);
        } catch (e) {
            setNotice(`⚠️ ${(e as Error).message}`);
        } finally {
            setAccepting(false);
        }
    }

    if (loading) return <div className="p-8 text-center text-white">Loading...</div>;

    if (!allowed) {
        return (
            <div className="min-h-screen bg-[#130b29] flex items-center justify-center p-4">
                <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-8 max-w-md text-center">
                    <h1 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h1>
                    <p className="text-gray-300">The Podcast Studio is for admins and producers.</p>
                </div>
            </div>
        );
    }

    // Accepted and nothing changed since: the official transcript and the Doc match the page.
    const upToDate = !!review?.accepted && review.accepted.version === savedVersion && saveState === "saved";
    const shown = onlyFlagged ? lines.filter(l => flags.has(l.id)) : lines;
    const saveLabel = { saved: "Draft saved to the database", unsaved: "Unsaved changes…", saving: "Saving draft…", error: "Draft not saved" }[saveState];

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-4 pb-28 sm:p-8 sm:pb-28">
                <div className="max-w-7xl mx-auto flex flex-col gap-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div className="min-w-0">
                            <Link href="/admin/podcast" className="text-sm text-gray-400 hover:text-white">← Podcast Studio</Link>
                            <h1 className="text-2xl font-bold text-amber-400 mt-1 break-words">{review?.title ?? "Speaker review"}</h1>
                            {review && (
                                <p className="text-sm text-gray-400 mt-1">
                                    {[review.recordedAt?.slice(0, 10), minutes(review.durationSeconds)].filter(Boolean).join(" · ")}
                                    {review.accepted && ` · Accepted by ${review.accepted.by} ${ago(review.accepted.at)}`}
                                    {review.docUrl && (
                                        <>
                                            {" · "}
                                            <a href={review.docUrl} target="_blank" rel="noreferrer" className="hover:text-white underline-offset-2 hover:underline">Transcript Doc</a>
                                        </>
                                    )}
                                    {review.accepted && (
                                        <>
                                            {" · "}
                                            <Link href={`/admin/podcast/${episodeId}/notes`} className="text-amber-300 hover:underline">Show notes →</Link>
                                        </>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>

                    <ErrorNote message={error} />
                    {!review && !error && <p className="text-gray-400">Loading transcript…</p>}

                    {review && corrections && (
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start">
                            <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto">
                                {review.videoUrl ? (
                                    <video
                                        ref={video}
                                        src={review.videoUrl}
                                        controls
                                        preload="metadata"
                                        onTimeUpdate={e => setCurrentMs(e.currentTarget.currentTime * 1000)}
                                        className="w-full rounded-xl bg-black aspect-video"
                                    />
                                ) : (
                                    <p className="text-sm text-gray-400">No preview video for this episode.</p>
                                )}
                                <SpeakersPanel
                                    rows={rows}
                                    knownNames={review.knownNames}
                                    onRename={(label, name) => update(c => edit.rename(c, label, name))}
                                    onClip={(label, clip) => update(c => edit.setClip(c, label, clip, rows.find(r => r.label === label)?.typed ?? ""))}
                                    onMerge={(label, into, name) => update(c => {
                                        const merged = edit.merge(c, label, into);
                                        return name ? edit.rename(merged, into, name) : merged;
                                    })}
                                    onUnmerge={label => update(c => edit.unmerge(c, label))}
                                    onAdd={() => update(c => edit.addVoice(c).corrections)}
                                    onSeek={seek}
                                />
                            </div>

                            <section className="flex flex-col gap-2 min-w-0">
                                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 pb-2 border-b border-white/5">
                                    <span>{lines.length} lines</span>
                                    <span className={flags.size ? "text-orange-300" : ""}>
                                        {flags.size} flagged
                                    </span>
                                    {flags.size > 0 && <button onClick={nextFlag} className={secondary}>Next flagged</button>}
                                    <label className="flex items-center gap-1.5">
                                        <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} />
                                        Only flagged
                                    </label>
                                    <label className="flex items-center gap-1.5">
                                        <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
                                        Follow the video
                                    </label>
                                </div>
                                {!shown.length && <p className="text-sm text-gray-500 italic">Nothing to show.</p>}
                                {shown.map(line => {
                                    const flag = flags.get(line.id);
                                    return (
                                        <LineRow
                                            key={line.id}
                                            line={line}
                                            active={line.id === activeId}
                                            splitting={splitting === line.id}
                                            flag={flag}
                                            flagTo={flag ? speakerName(review.voices, corrections, flag.toLabel) : undefined}
                                            voices={voices}
                                            color={colorOf.get(line.label) ?? COLORS[0]}
                                            actions={actions}
                                        />
                                    );
                                })}
                            </section>
                        </div>
                    )}
                </div>
                {/* Always in view: where your changes are, and the button that finishes the review. */}
                {review && (
                    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-[#130b29]/95 backdrop-blur">
                        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className={`text-sm ${saveState === "error" ? "text-red-300" : saveState === "saved" ? "text-green-300" : "text-gray-400"}`}>
                                {saveState === "saved" ? "✓ " : ""}{saveLabel}
                            </span>
                            {saveState === "error" && <button onClick={() => { void flush(); }} className={secondary}>Try again</button>}
                            {notice ? (
                                <span className={`text-sm ${notice.startsWith("⚠️") ? "text-red-300" : "text-green-300"}`}>{notice}</span>
                            ) : (
                                <span className="text-xs text-gray-500">
                                    {unnamed.length
                                        ? `Name every voice to finish: ${unnamed.map(r => r.name).join(", ")}`
                                        : upToDate
                                            ? `Accepted by ${review.accepted!.by}. The official transcript (Cloud Storage) and the Google Doc match this page.`
                                            : review.accepted
                                                ? "Accept the changes to update the official transcript (Cloud Storage) and the Google Doc."
                                                : "Accept when every line has the right speaker, to save the official transcript (Cloud Storage) and update the Google Doc."}
                                </span>
                            )}
                            <button
                                onClick={accept}
                                disabled={accepting || unnamed.length > 0 || upToDate}
                                className={`${primary} ml-auto !text-sm !px-4 !py-2`}
                            >
                                {accepting ? "Accepting…" : upToDate ? "✓ Accepted" : review.accepted ? "Accept changes" : "Accept transcript"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </AuthGuard>
    );
}
