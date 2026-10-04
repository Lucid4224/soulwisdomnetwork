"use client";

// The final cut on the show notes page (docs/specs/010-final-cut.md): publishes the edited
// episode from Descript, and shows it with the chapter times moved onto it.

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/components/studio/format";
import { mmss } from "@/lib/showNotes";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";
import { failure, useStep, type ReportStep } from "@/components/studio/steps";
import { primary, secondary } from "@/components/studio/ui";
import type { FinalView } from "@/types/studio";


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
    // Studio settings: the Editor Light render makes the final cut, so there is nothing to get from Descript here.
    const editorLight = view?.source === "editorLight";
    useStep({
        step: "final", failed: view?.status === "failed", done: ready && !view.stale, working,
        summary: working ? LABEL[view!.status as keyof typeof LABEL] : view?.status === "failed" ? failure("Getting the final cut", view.error)
            : ready ? [view.stale ? "Out of date: get it again" : `Made ${ago(view.finishedAt)}`, view.durationSeconds ? mmss(view.durationSeconds * 1000) : "", view.loudness ? `${view.loudness.afterLufs} LUFS` : ""].filter(Boolean).join(" · ")
                : editorLight ? "Made by “Render this edit” (Editor Light)"
                    : view?.canStart ? "Ready when the Descript edit is finished" : "Waiting for the Descript project",
        link: view?.driveUrl ? { label: "Final cut", href: view.driveUrl } : view?.videoUrl ? { label: "Final cut", href: view.videoUrl } : null,
        key: view ? `${view.status}:${view.finishedAt}` : null, report, revision, enabled, load,
    });
    return (
        <div className="flex flex-col gap-2">
            {view?.status === "failed" && <ErrorNote title="Getting the final cut failed" message={view.error} />}
            <div className="flex flex-wrap items-center gap-3">
                {!editorLight && (
                    <button onClick={start} disabled={!view?.canStart || working || starting} className={ready ? secondary : primary}>
                        {working ? LABEL[view!.status as keyof typeof LABEL] : ready ? "Get the final cut again" : "Get the final cut from Descript"}
                    </button>
                )}
                {!view?.driveUrl && view?.videoUrl && (
                    <a href={view.videoUrl} target="_blank" rel="noreferrer" className="text-sm text-amber-300 hover:underline">
                        Watch or download the final cut ↗
                    </a>
                )}
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
            <p className="text-xs text-gray-400">
                {editorLight
                    ? ready
                        ? `Made by the Editor Light render ${view.finishedAt ? ago(view.finishedAt) : ""}${view.durationSeconds ? ` · ${mmss(view.durationSeconds * 1000)}` : ""}. After more edits, use “Render this edit” again.`
                        : "The Studio settings make the final cut from the Editor Light render: edit in “Edit here instead”, then press “Render this edit”."
                    : working
                    ? "Descript renders the “Episode” timeline, then it is downloaded, set to broadcast loudness and transcribed to move the chapter times. Allow about as long as the episode; this page updates by itself and you get an email."
                    : !view?.canStart
                        ? "Send the episode to Descript and finish the edit there first."
                        : ready
                            ? `Made ${view.finishedAt ? ago(view.finishedAt) : ""}${view.durationSeconds ? ` · ${mmss(view.durationSeconds * 1000)}` : ""}${view.loudness ? ` · ${view.loudness.afterLufs} LUFS (was ${view.loudness.beforeLufs})` : ""}${view.coverage != null ? ` · ${Math.round(view.coverage * 100)}% of the original matched` : ""}. After more edits in Descript, get it again.`
                            : "When the edit in Descript is finished: renders the “Episode” timeline at 1080p, sets it to -14 LUFS (what YouTube and Spotify play at), saves it to Drive and moves the chapter and quote times onto it."}
            </p>
            {ready && view.stale && (
                <p className="text-sm text-amber-300">{editorLight
                    ? "This final cut came from an earlier edit or earlier notes. Render the edit again to match."
                    : "This final cut came from an earlier Descript project or earlier notes. Get it again to match."}</p>
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
            <ErrorNote message={error} />
        </div>
    );
}
