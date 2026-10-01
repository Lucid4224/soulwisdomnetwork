"use client";

// The edit package on the show notes page (docs/specs/009-edit-package.md): everything for the
// Descript edit in one Drive folder, built from the approved notes, and the Descript project
// made from it through Descript's API.

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/components/studio/format";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";
import { failure, useStep, type ReportStep } from "@/components/studio/steps";
import { primary, secondary } from "@/components/studio/ui";
import type { PackageView } from "@/types/studio";


const DESCRIPT_LABEL = {
    queued: "Starting…", importing: "Importing into Descript…", cleaning: "Removing filler words and applying Studio Sound…",
} as const;

// "26 media minutes and 63 AI credits", from the last send.
function cost(d: PackageView["descript"] | undefined) {
    return [d?.mediaMinutes ? `${d.mediaMinutes} media minutes` : "", d?.aiCredits ? `${d.aiCredits} AI credits` : ""].filter(Boolean).join(" and ");
}

export function EditPackage({ episodeId, enabled, upToDate, report, revision }: {
    episodeId: string; enabled: boolean; upToDate: boolean; report?: ReportStep; revision?: number;
}) {
    const [view, setView] = useState<PackageView | null>(null);
    const [error, setError] = useState("");
    const [starting, setStarting] = useState(false);

    const load = useCallback(async () => {
        try {
            setView(await studioFetch<PackageView>(`/api/studio/episodes/${episodeId}/package`));
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, [episodeId]);

    useEffect(() => {
        if (enabled) load();
    }, [enabled, load]);

    const working = view?.status === "queued" || view?.status === "building";
    const d = view?.descript;
    const sending = d?.status === "queued" || d?.status === "importing" || d?.status === "cleaning";
    useEffect(() => {
        if (!working && !sending) return;
        const timer = setInterval(load, 15000);
        return () => clearInterval(timer);
    }, [working, sending, load]);

    async function build() {
        setStarting(true);
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/package`, { method: "POST" });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }

    async function send() {
        const again = Boolean(d?.projectUrl);
        if (again && !confirm(`Send to Descript again?\n\nThis makes a new Descript project from the current edit package. The current project is left as it is, and edits made in it do not carry over.\n\n${cost(d) ? `It uses about as much as last time: ${cost(d)}.` : "It uses the Descript plan\u2019s media minutes and AI credits again."}`)) return;
        setStarting(true);
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/descript`, { method: "POST", body: JSON.stringify({ again }) });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }

    const built = view?.status === "ready";
    const building = working || starting;
    const stale = built && (view.builtFromVersion !== view.approvedVersion || !view.clipsStored);
    const canSend = upToDate && built && !stale && !working && !sending && !starting;
    // A project made from earlier notes, or before the package was last rebuilt, has old clips and images.
    const descriptStale = d?.status === "ready" && (d.builtFromVersion !== view?.approvedVersion
        || (view?.finishedAt != null && d.finishedAt != null && view.finishedAt > d.finishedAt));
    useStep({
        step: "package", failed: view?.status === "failed", done: built && !stale, working,
        summary: working ? "Building the edit package…" : view?.status === "failed" ? failure("The edit package", view.error)
            : built ? (stale ? "Edit package out of date: rebuild it" : `Package built ${ago(view.finishedAt)}`) : "Edit package not built yet",
        key: view ? `${view.status}:${view.finishedAt}:${stale}` : null, report, revision, enabled, load,
    });
    // Reported only; the line above already reloads this section.
    useStep({
        step: "descript", failed: d?.status === "failed", done: d?.status === "ready" && !descriptStale, working: sending,
        summary: sending ? "Sending to Descript…" : d?.status === "failed" ? failure("Sending to Descript", d.error)
            : d?.status === "ready" ? (descriptStale ? "Descript project out of date" : `In Descript since ${ago(d.finishedAt)}`) : built ? "Not sent to Descript yet" : "",
        link: d?.projectUrl ? { label: "Descript", href: d.projectUrl } : null,
        key: d ? `${d.status}:${d.finishedAt}:${descriptStale}` : null, report, enabled: false, load,
    });
    // What to do to bring the changes into Descript, from where things stand.
    const staleNext = !upToDate
        ? "Approve the changes to the show notes, rebuild the edit package, then Send to Descript again."
        : building
            ? "The edit package is being rebuilt; when it is done, Send to Descript again."
            : !built || stale
                ? "Rebuild the edit package, then Send to Descript again."
                : "Send to Descript again to make a new project with them.";

    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-gray-100">Edit package</h3>
            <div className="flex flex-wrap items-center gap-3">
                <button onClick={build} disabled={!upToDate || working || starting} className={built && !stale ? secondary : primary}>
                    {working ? "Building…" : built ? "Rebuild edit package" : "Build edit package"}
                </button>
                {view?.folderUrl && (
                    <a href={view.folderUrl} target="_blank" rel="noreferrer" className="text-sm text-amber-300 hover:underline">
                        Open the Drive folder ↗
                    </a>
                )}
            </div>
            <p className="text-xs text-gray-400">
                {working
                    ? "Cutting the clips and copying files; usually a few minutes. This page updates by itself."
                    : !upToDate
                        ? "Approve the show notes first; the package is built from the approved notes."
                        : built
                            ? <>
                                {`Built ${view.finishedAt ? ago(view.finishedAt) : ""}. ${!view.clipsStored ? "Built before Descript could use it; rebuild once." : stale ? "The notes have been approved again since: rebuild to match, or go back to the notes it was built from." : "Rebuilding replaces the files in place."}`}
                                {view.clipsStored && stale && <> <a href="#changes-since" className="text-amber-300 hover:underline">See what changed</a></>}
                            </>
                            : "The full episode, each “In this episode” clip (tagged “In this episode” with the speaker’s name), each b-roll image as a clip with a slow zoom or pan (and the still), and a notes file, in one Drive folder for Descript."}
            </p>
            {built && view.files.length > 0 && (
                <ul className="text-xs text-gray-400 list-disc pl-5">
                    {view.files.map(f => <li key={f}>{f}</li>)}
                </ul>
            )}
            {built && view.warnings.map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}

            <div id="descript" className="flex flex-col gap-2 border-t border-white/5 pt-5 mt-3 scroll-mt-24">
                <h3 className="text-base font-semibold text-gray-100">Descript project</h3>
                <div className="flex flex-wrap items-center gap-3">
                    <button onClick={send} disabled={!canSend} className={d?.projectUrl && !descriptStale ? secondary : primary}>
                        {sending ? DESCRIPT_LABEL[d!.status as keyof typeof DESCRIPT_LABEL] : d?.projectUrl ? "Send to Descript again" : "Send to Descript"}
                    </button>
                    {d?.projectUrl && (
                        <a href={d.projectUrl} target="_blank" rel="noreferrer" className="text-sm text-amber-300 hover:underline">
                            Open in Descript ↗
                        </a>
                    )}
                </div>
                <p className="text-xs text-gray-400">
                    {sending
                        ? "Descript imports and transcribes the media, then Underlord cleans it up. Allow about as long as the episode; this page updates by itself and you get an email."
                        : building
                            ? "Wait for the edit package to finish building; Descript gets the same files."
                            : !built || stale
                            ? `${built ? "Rebuild" : "Build"} the edit package first; Descript gets the same files.`
                            : d?.status === "ready"
                                ? `Made ${d.finishedAt ? ago(d.finishedAt) : ""}${d.mediaMinutes != null ? ` · ${d.mediaMinutes} media minutes` : ""}${d.aiCredits ? ` · ${d.aiCredits} AI credits` : ""}. Edit it in Descript; that is the final cut.`
                                : "Makes a Descript project: the \u201cIn this episode\u201d clips, the intro, the full episode and the intro again as the outro on one timeline, filler words removed and Studio Sound on, b-roll clips with the movement built in in the media bin. Uses the Descript plan\u2019s media minutes and AI credits."}
                </p>
                {descriptStale && !sending && (
                    <div className="text-sm text-amber-300 flex flex-col gap-1">
                        <p>The show notes or edit package changed after this Descript project was made, so it has the old clips and images. {staleNext}</p>
                        <p className="text-xs text-gray-400">
                            Each send makes a new Descript project: edits made in the current one do not carry over, and it uses
                            {cost(d) ? ` about as much as last time (${cost(d)})` : " the plan\u2019s media minutes and AI credits again"}.
                            The final cut, thumbnails and shorts are then made again from the new project.
                        </p>
                    </div>
                )}
                {d?.status === "ready" && d.agentResponse && <p className="text-xs text-gray-400">Underlord: {d.agentResponse}</p>}
                {d?.status === "ready" && d.warnings.map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}
                {d?.status === "failed" && <ErrorNote title="Sending to Descript failed" message={d.error} />}
            </div>
            <ErrorNote title={error ? undefined : "The edit package failed"} message={error || view?.error} />
        </div>
    );
}
