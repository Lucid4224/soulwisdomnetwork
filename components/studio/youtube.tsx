"use client";

// The YouTube upload on the show notes page (docs/specs/012-youtube-upload.md): previews exactly
// what is sent, starts the upload after Checkpoint D, and updates the same video later.

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/components/studio/format";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";
import { failure, useStep, type ReportStep } from "@/components/studio/steps";
import { primary, secondary } from "@/components/studio/ui";
import { YOUTUBE_CATEGORY_LABEL } from "@/lib/youtube";
import type { YoutubeView } from "@/types/studio";


const LABEL = {
    queued: "Starting…",
    uploading: "Uploading to YouTube…",
    processing: "Adding the thumbnail and captions…",
} as const;

export function Youtube({ episodeId, enabled, report, revision }: { episodeId: string; enabled: boolean; report?: ReportStep; revision?: number }) {
    const [view, setView] = useState<YoutubeView | null>(null);
    const [error, setError] = useState("");
    const [starting, setStarting] = useState(false);
    const base = `/api/studio/episodes/${episodeId}/youtube`;

    const load = useCallback(async () => {
        try {
            setView(await studioFetch<YoutubeView>(base));
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, [base]);

    useEffect(() => {
        if (enabled) load();
    }, [enabled, load]);

    const working = !!view?.status && view.status in LABEL;
    const privacy = view?.privacyStatus ? `${view.privacyStatus[0].toUpperCase()}${view.privacyStatus.slice(1)}` : "";
    useStep({
        step: "youtube", failed: view?.status === "failed", done: !!view?.videoId, working,
        summary: working ? LABEL[view!.status as keyof typeof LABEL] : view?.status === "failed" ? failure("The YouTube upload", view.error)
            : view?.videoId ? `${privacy || "On"} on YouTube${view.detailsOutdated || view.finalOutdated ? " (needs an update)" : ""}` : view && !view.blocker ? "Ready to upload" : "",
        link: view?.url ? { label: "YouTube", href: view.url } : null,
        key: view ? `${view.status}:${view.finishedAt}:${view.videoId}:${view.blocker}` : null,
        report, revision, enabled, load,
    });
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(load, 15000);
        return () => clearInterval(timer);
    }, [working, load]);

    async function start() {
        setStarting(true);
        try {
            await studioFetch(base, { method: "POST" });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }

    async function forget() {
        if (!confirm("Only do this after deleting the video in YouTube Studio. The next upload will make a new video. Forget this upload?")) return;
        try {
            await studioFetch(base, { method: "DELETE" });
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    }

    const uploaded = !!view?.videoId;
    const p = view?.preview;
    return (
        <div className="flex flex-col gap-3">
            {view?.status === "failed" && <ErrorNote title="The YouTube upload failed" message={view.error} />}
            <div className="flex flex-wrap items-center gap-3">
                <button onClick={start} disabled={!!view?.blocker || working || starting} className={uploaded ? secondary : primary}>
                    {working ? LABEL[view!.status as keyof typeof LABEL] : uploaded ? "Update on YouTube" : "Upload to YouTube"}
                </button>
                {view?.url && (
                    <a href={view.url} target="_blank" rel="noreferrer" className="text-sm text-amber-300 hover:underline">Watch on YouTube ↗</a>
                )}
                {view?.videoId && (
                    <a href={`https://studio.youtube.com/video/${view.videoId}/edit`} target="_blank" rel="noreferrer" className="text-sm text-gray-400 hover:underline">
                        YouTube Studio ↗
                    </a>
                )}
            </div>
            <p className="text-xs text-gray-400">
                {working
                    ? "The final cut goes up first, then the thumbnail and captions. About 10-20 minutes; this page updates by itself and you get an email."
                    : view?.blocker
                        ? view.blocker
                        : uploaded
                            ? `${view.privacyStatus ? `${view.privacyStatus[0].toUpperCase()}${view.privacyStatus.slice(1)} on YouTube` : "On YouTube"}${view.finishedAt ? `, last sent ${ago(view.finishedAt)}` : ""}. “Update on YouTube” resends the title, description, tags, thumbnail and captions to the same video and keeps its visibility.`
                            : "Uploads the final cut with the details below, the approved thumbnail and captions from the final cut. It asks for Unlisted; until YouTube's API audit passes, YouTube keeps it Private."}
            </p>
            {view?.detailsOutdated && <p className="text-sm text-amber-300">The episode was approved again since the last upload. “Update on YouTube” sends the new details.</p>}
            {view?.finalOutdated && (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-amber-300">The video on YouTube is from an earlier final cut. To replace it, delete it in YouTube Studio, then:</p>
                    <button onClick={forget} disabled={working} className={secondary}>Forget this upload</button>
                </div>
            )}
            {view?.warnings.map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}

            {p && (
                <details className="text-xs text-gray-400">
                    <summary className="cursor-pointer text-gray-300">What is sent to YouTube</summary>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                        <dt className="text-gray-500">Title</dt><dd className="text-gray-200">{p.title}</dd>
                        <dt className="text-gray-500">Visibility</dt><dd>{p.privacyStatus} (Private until the API audit passes)</dd>
                        <dt className="text-gray-500">Category</dt><dd>{YOUTUBE_CATEGORY_LABEL}</dd>
                        <dt className="text-gray-500">Altered or synthetic</dt><dd>{p.containsSyntheticMedia ? "Yes (AI b-roll)" : "No"}</dd>
                        <dt className="text-gray-500">Made for kids</dt><dd>No</dd>
                        <dt className="text-gray-500">Tags</dt><dd>{p.tags.join(", ")}</dd>
                        <dt className="text-gray-500">Description</dt>
                        <dd><pre className="whitespace-pre-wrap font-sans text-gray-300 bg-[#130b29] border border-white/5 rounded-lg p-3">{p.description}</pre></dd>
                    </dl>
                </details>
            )}
            <ErrorNote message={error} />
        </div>
    );
}
