"use client";

// Podcast Studio dashboard (docs/specs/006-podcast-studio.md): what is waiting in Drive,
// what the pipeline is doing, and the buttons that move an episode along.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/auth/AuthGuard";
import SetupCheck from "@/components/studio/SetupCheck";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { ago, megabytes, minutes, STAGE_LABEL, usd } from "@/components/studio/format";
import { useAuth } from "@/context/AuthContext";
import { studioFetch } from "@/lib/studioClient";
import type { DriveVideo, EpisodeSummary, Pipeline } from "@/types/studio";

const card = "bg-[#1E1035]/60 border border-white/5 rounded-xl p-3";
const button = "text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} border-amber-500/40 text-amber-300 hover:bg-amber-500/10`;
const secondary = `${button} border-white/10 text-gray-300 hover:bg-white/10`;

const NOTES_LABEL: Record<NonNullable<EpisodeSummary["notesStatus"]>, { text: string; tone: string }> = {
    queued: { text: "waiting to start…", tone: "text-gray-400" },
    generating: { text: "Claude is drafting…", tone: "text-gray-400" },
    ready: { text: "ready for you to review", tone: "text-amber-300" },
    failed: { text: "drafting failed, open to retry", tone: "text-red-300" },
    approved: { text: "approved", tone: "text-green-300" },
};

function Column({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
    return (
        <section className="bg-[#1E1035]/30 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 min-w-0">
            <header>
                <h2 className="font-semibold text-gray-100">
                    {title} <span className="text-gray-500 font-normal">{count}</span>
                </h2>
                {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
            </header>
            {children}
        </section>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="text-sm text-gray-500 italic">{children}</p>;
}

function EpisodeCard({ e, children }: { e: EpisodeSummary; children?: React.ReactNode }) {
    return (
        <div className={card}>
            <p className="font-medium text-sm break-words">{e.title}</p>
            <p className="text-xs text-gray-400 mt-0.5">
                {[e.recordedAt?.slice(0, 10), minutes(e.durationSeconds), e.costUsd ? usd(e.costUsd) : ""].filter(Boolean).join(" · ")}
            </p>
            {children}
        </div>
    );
}

export default function PodcastStudioPage() {
    const { profile, loading } = useAuth();
    const allowed = profile?.role === "admin" || profile?.role === "producer";

    const [data, setData] = useState<Pipeline | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState<string | null>(null);   // which action is running
    const [notice, setNotice] = useState("");
    const dragFrom = useRef<number | null>(null);

    const load = useCallback(async () => {
        try {
            setData(await studioFetch<Pipeline>("/api/studio/pipeline"));
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    const running = !!data && (
        data.runs.some(r => r.status !== "completed")
        || data.episodes.some(e => e.status === "ingesting" || e.status === "transcribing")
    );

    const drafting = !!data?.episodes.some(e => e.notesStatus === "queued" || e.notesStatus === "generating");

    // Refresh often while something is happening, occasionally otherwise.
    useEffect(() => {
        if (loading || !allowed) return;
        load();
        const timer = setInterval(load, running || drafting ? 10_000 : 60_000);
        return () => clearInterval(timer);
    }, [loading, allowed, running, drafting, load]);

    async function act(key: string, fn: () => Promise<string>) {
        setBusy(key);
        setNotice("");
        try {
            setNotice(await fn());
            await load();
        } catch (e) {
            setNotice(`⚠️ ${(e as Error).message}`);
        } finally {
            setBusy(null);
        }
    }

    const queue = (fileId?: string) => act(`queue:${fileId ?? "next"}`, async () => {
        const { queued } = await studioFetch<{ queued: DriveVideo }>("/api/studio/backlog/queue", {
            method: "POST",
            body: JSON.stringify(fileId ? { fileId } : {}),
        });
        return `Moved "${queued.name}" to To Process. Press "Process now" to start it.`;
    });

    const markFinished = (e: EpisodeSummary, isFinished: boolean) => {
        const question = isFinished
            ? `Mark "${e.title}" as finished?\n\nIt moves from Accepted to Finished, and its cost and time are posted on the Usage page. You can move it back from the Finished column.`
            : `Move "${e.title}" back to Accepted?`;
        if (confirm(question)) void setFinished(e, isFinished);
    };

    const setFinished = (e: EpisodeSummary, isFinished: boolean) => act(`finished:${e.id}`, async () => {
        await studioFetch(`/api/studio/episodes/${e.id}/finished`, { method: "POST", body: JSON.stringify({ finished: isFinished }) });
        return isFinished
            ? `"${e.title}" moved to Finished. Its cost and time are posted on the Usage page. Pressed by mistake? Use "Back to Accepted" on it under Finished.`
            : `"${e.title}" moved back to Accepted.`;
    });

    const processNow = (retryFileId?: string) => act(retryFileId ? `retry:${retryFileId}` : "process", async () => {
        await studioFetch("/api/studio/ingest", {
            method: "POST",
            body: JSON.stringify(retryFileId ? { retryFileId } : {}),
        });
        return retryFileId
            ? "Retry started. It usually takes 5–20 minutes."
            : "Processing started. Episodes appear under Processing within a minute or two.";
    });

    async function saveOrder(backlog: DriveVideo[]) {
        setData(d => (d ? { ...d, backlog } : d));
        try {
            await studioFetch("/api/studio/backlog/order", {
                method: "POST",
                body: JSON.stringify({ order: backlog.map(v => v.id) }),
            });
        } catch (e) {
            setNotice(`⚠️ Could not save the order: ${(e as Error).message}`);
            load();
        }
    }

    function move(from: number, to: number) {
        if (!data || from === to || to < 0 || to >= data.backlog.length) return;
        const next = [...data.backlog];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        saveOrder(next);
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

    const by = (status: EpisodeSummary["status"] | EpisodeSummary["status"][]) =>
        (data?.episodes ?? []).filter(e => ([] as string[]).concat(status).includes(e.status));
    const processing = by(["ingesting", "transcribing"]);
    const review = by("awaiting_speaker_review");
    const accepted = by("speakers_confirmed").filter(e => !e.finished);
    const finished = by("speakers_confirmed").filter(e => e.finished).sort((a, b) => b.finished!.at - a.finished!.at);
    const failed = by("failed");
    const lastRun = data?.runs[0];

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-4 sm:p-8">
                <div className="max-w-7xl mx-auto flex flex-col gap-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-amber-400">Podcast Studio</h1>
                            <p className="text-sm text-gray-400 mt-1">
                                {data ? `${usd(data.monthCostUsd)} spent this month · ${usd(data.dayCostUsd)} of the ${usd(data.dailyLimitUsd)} daily limit` : "Loading…"}
                                {lastRun && (
                                    <>
                                        {" · "}
                                        <a href={lastRun.url} target="_blank" rel="noreferrer" className="hover:text-white underline-offset-2 hover:underline">
                                            {lastRun.status !== "completed"
                                                ? "Processing is running…"
                                                : `Last processing run ${lastRun.conclusion === "success" ? "succeeded" : lastRun.conclusion} ${ago(lastRun.createdAt)}`}
                                        </a>
                                    </>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={load} className={secondary}>Refresh</button>
                            {profile?.role === "admin" && (
                                <>
                                    <Link href="/admin/usage" className="text-sm text-gray-400 hover:text-white ml-2">Usage</Link>
                                    <Link href="/admin" className="text-sm text-gray-400 hover:text-white ml-2">← Admin</Link>
                                </>
                            )}
                        </div>
                    </div>

                    <ErrorNote message={error} />
                    {notice && (
                        <p className={`text-sm rounded-lg px-4 py-2 ${notice.startsWith("⚠️") ? "bg-red-900/20 text-red-300" : "bg-green-900/20 text-green-300"}`}>
                            {notice}
                        </p>
                    )}

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <Column title="Backlog" count={data?.backlog.length ?? 0} hint="Drag to set the order. The top one goes next.">
                            <button
                                onClick={() => queue()}
                                disabled={busy !== null || !data?.backlog.length}
                                className={`${primary} self-start`}
                            >
                                {busy === "queue:next" ? "Moving…" : "Queue next"}
                            </button>
                            {data && !data.backlog.length && <Empty>Nothing in 00 Backlog.</Empty>}
                            <ol className="flex flex-col gap-2">
                                {data?.backlog.map((v, i) => (
                                    <li
                                        key={v.id}
                                        draggable
                                        onDragStart={() => { dragFrom.current = i; }}
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={() => { if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null; }}
                                        className={`${card} flex items-center gap-2 cursor-grab active:cursor-grabbing`}
                                    >
                                        <span className="text-gray-500 text-xs w-5 shrink-0">{i + 1}</span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm break-words">{v.name}</p>
                                            <p className="text-xs text-gray-500">{megabytes(v.sizeBytes)}</p>
                                        </div>
                                        <div className="flex flex-col shrink-0">
                                            <button onClick={() => move(i, i - 1)} disabled={i === 0} className="text-gray-400 hover:text-white disabled:opacity-20 px-1" aria-label="Move up">▲</button>
                                            <button onClick={() => move(i, i + 1)} disabled={i === data.backlog.length - 1} className="text-gray-400 hover:text-white disabled:opacity-20 px-1" aria-label="Move down">▼</button>
                                        </div>
                                        <button onClick={() => queue(v.id)} disabled={busy !== null} className={secondary}>
                                            {busy === `queue:${v.id}` ? "…" : "Queue"}
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        </Column>

                        <Column title="To Process" count={data?.toProcess.length ?? 0} hint="Waiting in 01 To Process. Nothing starts on its own: press Process now when you are ready to work on them.">
                            <button
                                onClick={() => processNow()}
                                disabled={busy !== null || running || !data?.toProcess.length}
                                className={`${primary} self-start`}
                                title={data?.toProcess.length ? "" : "Nothing in To Process"}
                            >
                                {busy === "process" ? "Starting…" : running ? "Processing…" : "Process now"}
                            </button>
                            {data && !data.toProcess.length && <Empty>Nothing waiting.</Empty>}
                            {data?.toProcess.map(v => (
                                <div key={v.id} className={card}>
                                    <p className="text-sm break-words">{v.name}</p>
                                    <p className="text-xs text-gray-500">{megabytes(v.sizeBytes)} · added {ago(v.addedAt)}</p>
                                </div>
                            ))}
                        </Column>

                        <Column title="Processing" count={processing.length} hint="Copying, making the preview, transcribing. About 5–20 minutes each.">
                            {!processing.length && <Empty>Nothing processing.</Empty>}
                            {processing.map(e => (
                                <EpisodeCard key={e.id} e={e}>
                                    <p className="text-xs text-amber-300 mt-2">{STAGE_LABEL[e.stage] ?? e.stage}… <span className="text-gray-500">updated {ago(e.updatedAt)}</span></p>
                                    {e.stuck && <p className="text-xs text-red-400 mt-1">⚠️ No progress for over 24 hours.</p>}
                                </EpisodeCard>
                            ))}
                        </Column>

                        <Column title="Needs review" count={review.length} hint="Check the speaker names, then accept the transcript.">
                            {!review.length && <Empty>Nothing to review.</Empty>}
                            {review.map(e => (
                                <EpisodeCard key={e.id} e={e}>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <Link href={`/admin/podcast/${e.id}`} className={primary}>Review speakers</Link>
                                        {e.docUrl && <a href={e.docUrl} target="_blank" rel="noreferrer" className={secondary}>Transcript Doc</a>}
                                    </div>
                                </EpisodeCard>
                            ))}
                        </Column>

                        <Column title="Accepted" count={accepted.length} hint="Speakers confirmed. Ready for the next steps.">
                            {!accepted.length && <Empty>None yet.</Empty>}
                            {accepted.map(e => (
                                <EpisodeCard key={e.id} e={e}>
                                    {e.notesStatus && (
                                        <p className={`text-xs mt-2 ${NOTES_LABEL[e.notesStatus].tone}`}>Show notes: {NOTES_LABEL[e.notesStatus].text}</p>
                                    )}
                                    {(e.stepErrors ?? []).map(s => (
                                        <ErrorNote key={s.step} title={`${s.step} failed`} message={s.message} className="mt-2" />
                                    ))}
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <Link href={`/admin/podcast/${e.id}/notes`} className={e.notesStatus === "ready" ? primary : secondary}>Show notes</Link>
                                        <Link href={`/admin/podcast/${e.id}`} className={secondary}>Open review</Link>
                                        {e.docUrl && <a href={e.docUrl} target="_blank" rel="noreferrer" className={secondary}>Transcript Doc</a>}
                                        <button
                                            onClick={() => markFinished(e, true)}
                                            disabled={busy !== null}
                                            className={`${secondary} ml-auto`}
                                            title="Move it to Finished, when it is on YouTube and its shorts are done"
                                        >
                                            {busy === `finished:${e.id}` ? "Moving…" : "Finished ✓"}
                                        </button>
                                    </div>
                                </EpisodeCard>
                            ))}
                        </Column>

                        <Column title="Failed" count={failed.length} hint="Stopped with an error. Fix the cause, then retry.">
                            {!failed.length && <Empty>No failures.</Empty>}
                            {failed.map(e => (
                                <EpisodeCard key={e.id} e={e}>
                                    <ErrorNote
                                        title={`${STAGE_LABEL[e.error?.stage ?? ""] ?? e.error?.stage ?? "Processing"} failed`}
                                        message={e.error?.message ?? "No reason given"}
                                        className="mt-2"
                                    />
                                    <button onClick={() => processNow(e.id)} disabled={busy !== null || running} className={`${secondary} mt-2`}>
                                        {busy === `retry:${e.id}` ? "Starting…" : "Retry"}
                                    </button>
                                </EpisodeCard>
                            ))}
                        </Column>

                        <Column title="Finished" count={finished.length} hint="Done: on YouTube, shorts scheduled. Press Finished on an accepted episode to move it here.">
                            {!finished.length && <Empty>None yet.</Empty>}
                            {finished.map(e => (
                                <EpisodeCard key={e.id} e={e}>
                                    <p className="text-xs text-emerald-300 mt-2">✓ Finished {ago(e.finished!.at)} by {e.finished!.by}</p>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <Link href={`/admin/podcast/${e.id}/notes`} className={secondary}>Show notes</Link>
                                        {e.youtubeUrl && <a href={e.youtubeUrl} target="_blank" rel="noreferrer" className={secondary}>On YouTube ↗</a>}
                                        <button onClick={() => markFinished(e, false)} disabled={busy !== null} className={`${secondary} ml-auto`}>
                                            {busy === `finished:${e.id}` ? "Moving…" : "Back to Accepted"}
                                        </button>
                                    </div>
                                </EpisodeCard>
                            ))}
                        </Column>
                    </div>

                    <SetupCheck />
                </div>
            </div>
        </AuthGuard>
    );
}
