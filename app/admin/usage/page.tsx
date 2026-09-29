"use client";

// Usage (admins): what each episode cost and how long it took, side by side, and the reports
// the podcast jobs post when an episode starts (what it should take) and finishes (what it
// took). lib/usage.ts does the sums; lib/server/usage.ts gathers the records and GitHub runs.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/auth/AuthGuard";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { ago, usd } from "@/components/studio/format";
import { useAuth } from "@/context/AuthContext";
import { studioFetch } from "@/lib/studioClient";
import type { UsageView } from "@/lib/server/usage";
import type { EpisodeUsage } from "@/lib/usage";

const card = "bg-[#1E1035]/40 border border-white/5 rounded-2xl p-5";
const button = "text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-40";
const th = "px-3 py-2 text-xs font-medium text-gray-400 text-left whitespace-nowrap";
const td = "px-3 py-2 text-sm whitespace-nowrap";

// "3 h 20 min", "45 min", "2.5 days"
function duration(minutes: number | null) {
    if (minutes == null) return "—";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
    return `${(minutes / 1440).toFixed(1)} days`;
}
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const hours = (h: number | null) => (h == null ? null : h * 60);

function Detail({ u }: { u: EpisodeUsage }) {
    return (
        <div className="grid gap-5 md:grid-cols-3 mt-3">
            <div>
                <h3 className="text-sm font-semibold text-gray-200 mb-1">Money: {usd(u.money.totalUsd)}</h3>
                {u.money.byService.map(s => (
                    <p key={s.service} className="text-xs text-gray-300 flex justify-between"><span>{s.service}</span><span>{usd(s.usd)}</span></p>
                ))}
                <div className="border-t border-white/5 mt-2 pt-2">
                    {u.money.items.map(i => (
                        <p key={i.label} className="text-xs text-gray-400 flex justify-between gap-3">
                            <span>{i.label}{i.count > 1 ? ` ×${i.count}` : ""}</span><span>{usd(i.usd)}</span>
                        </p>
                    ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                    Descript plan: {u.descript.aiCredits} AI credits · {u.descript.mediaMinutes} media minutes
                    {u.descript.sends ? ` · ${u.descript.sends} send${u.descript.sends === 1 ? "" : "s"}` : ""}
                    {!u.descript.allSends && u.descript.sends ? " (the last send only; every send is counted from 30 Sept 2026)" : ""}
                </p>
            </div>
            <div>
                <h3 className="text-sm font-semibold text-gray-200 mb-1">Machine time: {duration(u.machine.minutes)}</h3>
                {u.machine.byStep.map(s => (
                    <p key={s.step} className="text-xs text-gray-300 flex justify-between gap-3">
                        <span>{s.step}{s.runs > 1 ? ` (${s.runs} runs)` : ""}</span><span>{duration(s.minutes)}</span>
                    </p>
                ))}
                <p className="text-xs text-gray-500 mt-2">
                    {u.machine.source === "github"
                        ? "Every GitHub Actions run for this episode, retries included. Copy and transcribe is from the episode record."
                        : "From each step's last run in the episode record: earlier retries are not counted. Runs are tied to episodes from 30 Sept 2026."}
                </p>
            </div>
            <div>
                <h3 className="text-sm font-semibold text-gray-200 mb-1">Timeline</h3>
                {u.milestones.map((m, i) => (
                    <p key={m.label} className="text-xs text-gray-300 flex justify-between gap-3">
                        <span>{m.label}</span>
                        <span className="text-gray-400">{when(m.at)}{i ? <span className="text-gray-500"> (+{duration((m.at - u.milestones[i - 1].at) / 60_000)})</span> : null}</span>
                    </p>
                ))}
            </div>
        </div>
    );
}

export default function UsagePage() {
    const { profile, loading } = useAuth();
    const [view, setView] = useState<UsageView | null>(null);
    const [error, setError] = useState("");
    const [posting, setPosting] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setView(await studioFetch<UsageView>("/api/admin/usage"));
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => {
        if (!loading && profile?.role === "admin") load();
    }, [loading, profile, load]);

    async function post(episodeId: string) {
        setPosting(episodeId);
        try {
            await studioFetch("/api/admin/usage", { method: "POST", body: JSON.stringify({ episodeId }) });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setPosting(null);
        }
    }

    if (loading) return <div className="p-8 text-center text-white">Loading...</div>;
    if (profile?.role !== "admin") {
        return (
            <div className="min-h-screen bg-[#130b29] flex items-center justify-center p-4">
                <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-8 max-w-md text-center">
                    <h1 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h1>
                    <p className="text-gray-300">Usage is for admins.</p>
                </div>
            </div>
        );
    }

    const episodes = view?.episodes ?? [];
    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-4 sm:p-8">
                <div className="max-w-6xl mx-auto flex flex-col gap-6">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h1 className="text-3xl font-bold text-amber-400">Usage</h1>
                            <p className="text-sm text-gray-400 mt-1">What each episode cost and how long it took, from the video arriving to the episode on YouTube.</p>
                        </div>
                        <div className="flex gap-3 text-sm">
                            <button onClick={load} className={button}>Refresh</button>
                            <Link href="/admin/podcast" className="text-gray-400 hover:text-white">Podcast Studio</Link>
                            <Link href="/admin" className="text-gray-400 hover:text-white">← Admin</Link>
                        </div>
                    </div>

                    <ErrorNote message={error} />
                    {view?.runsError && <ErrorNote tone="warning" title="GitHub could not be asked for run times" message={view.runsError} />}
                    {!view && !error && <p className="text-gray-400">Loading…</p>}

                    {view && (
                        <section className={card}>
                            <h2 className="font-semibold mb-1">Episodes side by side</h2>
                            <p className="text-xs text-gray-500 mb-3">
                                Money is what the pipeline pays per use: Anthropic (Claude), OpenAI images and AssemblyAI transcripts. Descript is covered by
                                its plan, so its AI credits and media minutes are shown instead. GitHub Actions is free for this public repository.
                                Machine time is the jobs running; the rest of the elapsed time is people reviewing, editing in Descript and waiting.
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead className="border-b border-white/10">
                                        <tr>
                                            <th className={th}>Episode</th><th className={th}>Length</th><th className={th}>Start → on YouTube</th>
                                            <th className={th}>Machine time</th><th className={th}>Money</th><th className={th}>Per episode minute</th>
                                            <th className={th}>Descript credits</th><th className={th}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {episodes.map(u => (
                                            <tr key={u.episodeId} className="border-b border-white/5">
                                                <td className={`${td} max-w-[16rem] truncate`} title={u.title}>
                                                    <Link href={`/admin/podcast/${u.episodeId}/notes`} className="hover:text-amber-300">{u.title}</Link>
                                                </td>
                                                <td className={td}>{u.lengthMinutes != null ? `${Math.round(u.lengthMinutes)} min` : "—"}</td>
                                                <td className={td}>{u.elapsedHours != null ? duration(hours(u.elapsedHours)) : <span className="text-gray-500">not on YouTube yet</span>}</td>
                                                <td className={td}>{duration(u.machine.minutes)}{u.machine.source === "records" && <span className="text-gray-500"> *</span>}</td>
                                                <td className={`${td} font-semibold`}>{usd(u.money.totalUsd)}</td>
                                                <td className={td}>{u.usdPerEpisodeMinute != null ? `$${u.usdPerEpisodeMinute.toFixed(3)}` : "—"}</td>
                                                <td className={td}>{u.descript.aiCredits || "—"}</td>
                                                <td className={td}>
                                                    <button onClick={() => post(u.episodeId)} disabled={posting !== null} className={button}>
                                                        {posting === u.episodeId ? "Posting…" : "Post analysis"}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {episodes.some(u => u.machine.source === "records") && (
                                <p className="text-xs text-gray-500 mt-2">* From each step&apos;s last run only; runs are tied to episodes from 30 Sept 2026.</p>
                            )}
                            {!episodes.length && <p className="text-sm text-gray-500 italic">No episodes past speaker review yet.</p>}
                            {episodes.map(u => (
                                <details key={u.episodeId} className="border-t border-white/5 mt-3 pt-3">
                                    <summary className="cursor-pointer text-sm text-gray-200">{u.title}: breakdown</summary>
                                    <Detail u={u} />
                                </details>
                            ))}
                        </section>
                    )}

                    {view && (
                        <section className={card}>
                            <h2 className="font-semibold mb-1">Reports</h2>
                            <p className="text-xs text-gray-500 mb-3">
                                Posted when an episode starts (its transcript is ready: what it should take, from the finished episodes) and when it goes
                                on YouTube (what it took). &ldquo;Post analysis&rdquo; above adds one by hand.
                            </p>
                            {!view.reports.length && <p className="text-sm text-gray-500 italic">No reports yet.</p>}
                            <ol className="flex flex-col gap-3">
                                {view.reports.map(r => (
                                    <li key={r.id} className="border border-white/5 rounded-xl p-3">
                                        <p className="text-sm">
                                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mr-2 ${r.kind === "finished" ? "bg-emerald-900/50 text-emerald-300" : "bg-sky-900/50 text-sky-300"}`}>
                                                {r.kind === "finished" ? "Finished" : "Started"}
                                            </span>
                                            <span className="font-medium">{r.title}</span>
                                            <span className="text-xs text-gray-500"> · {when(r.at)} ({ago(r.at)})</span>
                                        </p>
                                        {r.kind === "started" && r.projection ? (
                                            <p className="text-sm text-gray-300 mt-1">
                                                {r.usage.lengthMinutes ? `${Math.round(r.usage.lengthMinutes)} minutes. ` : ""}
                                                Expect about <b>{usd(r.projection.usd)}</b>, {duration(r.projection.machineMinutes)} of machine time and{" "}
                                                {r.projection.aiCredits} Descript AI credits
                                                {r.projection.elapsedHours != null ? `, and about ${duration(hours(r.projection.elapsedHours))} from start to YouTube` : ""},
                                                {" "}going by {r.projection.basedOn} finished episode{r.projection.basedOn === 1 ? "" : "s"}.
                                            </p>
                                        ) : (
                                            <p className="text-sm text-gray-300 mt-1">
                                                <b>{usd(r.usage.money.totalUsd)}</b>
                                                {r.usage.money.byService.length ? ` (${r.usage.money.byService.map(s => `${s.service} ${usd(s.usd)}`).join(", ")})` : ""}
                                                {" · "}{duration(r.usage.machine.minutes)} of machine time
                                                {r.usage.elapsedHours != null ? ` · ${duration(hours(r.usage.elapsedHours))} from start to YouTube` : ""}
                                                {" · "}{r.usage.descript.aiCredits} Descript AI credits
                                            </p>
                                        )}
                                        <details className="mt-1">
                                            <summary className="cursor-pointer text-xs text-gray-400">Breakdown at the time</summary>
                                            <Detail u={r.usage} />
                                        </details>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}
                </div>
            </div>
        </AuthGuard>
    );
}
