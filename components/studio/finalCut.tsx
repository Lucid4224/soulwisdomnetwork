"use client";

// The final cut on the show notes page (docs/specs/010-final-cut.md): publishes the edited
// episode from Descript, and shows it with the chapter times moved onto it.

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/components/studio/format";
import { mmss } from "@/lib/showNotes";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";
import { useStep, type ReportStep } from "@/components/studio/steps";
import type { FinalView } from "@/types/studio";

const button = "text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} border-amber-500/40 text-amber-300 hover:bg-amber-500/10`;
const secondary = `${button} border-white/10 text-gray-300 hover:bg-white/10`;

const LABEL = {
    queued: "Starting…",
    publishing: "Rendering in Descript…",
    mastering: "Setting the loudness and saving…",
    retiming: "Moving the chapter times onto the final cut…",
} as const;

export function FinalCut({ episodeId, enabled, report, revision }: { episodeId: string; enabled: boolean; report?: ReportStep; revision?: number }) {
    const [view, setView] = useState<FinalView | null>(null);
    const [error, setError] = useState("");
    const [starting, setStarting] = useState(false);

    const load = useCallback(async () => {
        try {
            setView(await studioFetch<FinalView>(`/api/studio/episodes/${episodeId}/final`));
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, [episodeId]);

    useEffect(() => {
        if (enabled) load();
    }, [enabled, load]);

    const working = !!view?.status && view.status in LABEL;
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(load, 15000);
        return () => clearInterval(timer);
    }, [working, load]);

    async function start() {
        setStarting(true);
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/final`, { method: "POST" });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }

    const ready = view?.status === "ready";
    useStep({ step: "final", failed: view?.status === "failed", done: ready && !view.stale, key: view ? `${view.status}:${view.finishedAt}` : null, report, revision, enabled, load });
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
                <button onClick={start} disabled={!view?.canStart || working || starting} className={ready ? secondary : primary}>
                    {working ? LABEL[view!.status as keyof typeof LABEL] : ready ? "Get the final cut again" : "Get the final cut from Descript"}
                </button>
                {view?.driveUrl && (
                    <a href={view.driveUrl} target="_blank" rel="noreferrer" className="text-sm text-amber-300 hover:underline">
                        Open the final cut ↗
                    </a>
                )}
                {view?.folderUrl && (
                    <a href={view.folderUrl} target="_blank" rel="noreferrer" className="text-sm text-gray-400 hover:underline">
                        04 Final folder ↗
                    </a>
                )}
            </div>
            <p className="text-xs text-gray-500">
                {working
                    ? "Descript renders the “Episode” timeline, then it is downloaded, set to broadcast loudness and transcribed to move the chapter times. Allow about as long as the episode; this page updates by itself and you get an email."
                    : !view?.canStart
                        ? "Send the episode to Descript and finish the edit there first."
                        : ready
                            ? `Made ${view.finishedAt ? ago(view.finishedAt) : ""}${view.durationSeconds ? ` · ${mmss(view.durationSeconds * 1000)}` : ""}${view.loudness ? ` · ${view.loudness.afterLufs} LUFS (was ${view.loudness.beforeLufs})` : ""}${view.coverage != null ? ` · ${Math.round(view.coverage * 100)}% of the original matched` : ""}. After more edits in Descript, get it again.`
                            : "When the edit in Descript is finished: renders the “Episode” timeline at 1080p, sets it to -14 LUFS (what YouTube and Spotify play at), saves it to Drive and moves the chapter and quote times onto it."}
            </p>
            {ready && view.stale && (
                <p className="text-sm text-amber-300">This final cut came from an earlier Descript project or earlier notes. Get it again to match.</p>
            )}
            {ready && view.chapters.length > 0 && (
                <div className="text-xs text-gray-400">
                    <p className="text-gray-300 mb-1">Chapters on the final cut{view.quoteCount ? ` (and ${view.quoteCount} quotes re-timed for shorts)` : ""}:</p>
                    <ul className="flex flex-col gap-0.5">
                        {view.chapters.map(c => (
                            <li key={`${c.originalMs}-${c.title}`}>
                                <span className="font-mono text-gray-200">{mmss(c.startMs)}</span> {c.title}
                                <span className="text-gray-600"> (was {mmss(c.originalMs)})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {ready && view.warnings.map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}
            {view?.status === "failed" && <ErrorNote title="Getting the final cut failed" message={view.error} />}
            <ErrorNote message={error} />
        </div>
    );
}
