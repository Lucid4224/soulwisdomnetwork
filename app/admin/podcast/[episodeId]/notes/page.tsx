"use client";

// Checkpoint B (spec 005 step 6; docs/specs/007-show-notes.md): review and edit the show
// notes Claude drafted from the accepted transcript, then approve them. Edits save as you go.
// The rest of the episode's production follows on the same page, in six foldable stages
// (components/studio/steps.ts): the one that needs the producer opens by itself, the others
// fold to a one-line summary.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { BrollImageView, useBroll } from "@/components/studio/broll";
import { EditPackage } from "@/components/studio/editPackage";
import { FinalCut } from "@/components/studio/finalCut";
import { Shorts } from "@/components/studio/shorts";
import { Thumbnails } from "@/components/studio/thumbnails";
import { Youtube } from "@/components/studio/youtube";
import { ago, minutes } from "@/components/studio/format";
import { Part, Stage, StepTracker, type TrackedStage } from "@/components/studio/Stage";
import { failure, STAGES, stageStatus, type StageId, type StepId, type StepState, flowFor, labelIn, nextStep, stageIn } from "@/components/studio/steps";
import { Journey } from "@/components/studio/Journey";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { field, hint as small, primary, secondary } from "@/components/studio/ui";
import { useAutosave } from "@/components/studio/useAutosave";
import { useAuth } from "@/context/AuthContext";
import { BROLL_STYLE_IDS, BROLL_STYLES, BROLL_USD_PER_IMAGE, type BrollStyle } from "@/lib/broll";
import { chooseDescription, locate, mmss, notesChanges, sameNotes, youtubeDescription, type ShowNotes, type TeaserClip } from "@/lib/showNotes";
import { meetingDocx } from "@/lib/meetingDoc";
import { TranscriptDownloads, WritingExtras } from "@/components/studio/extras";
import { Translations } from "@/components/studio/translations";
import { studioFetch } from "@/lib/studioClient";
import type { EpisodeNotesView } from "@/types/studio";
import { EditorLightStage } from "@/components/studio/editorLight";
import type { SettingsView } from "@/lib/server/studioSettings";
import type { StudioSettings } from "@/lib/studioSettings";

type NotesView = NonNullable<EpisodeNotesView["notes"]>;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function parseTime(text: string): number | null {
    const parts = text.trim().split(":").map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
    return parts.reduce((total, n) => total * 60 + n, 0) * 1000;
}

// Edits a time as m:ss; commits on blur so half-typed times are not saved.
function TimeInput({ ms, onChange }: { ms: number; onChange: (ms: number) => void }) {
    const [text, setText] = useState(mmss(ms));
    return (
        <input
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => {
                const parsed = parseTime(text);
                if (parsed === null) setText(mmss(ms));
                else onChange(parsed);
            }}
            className="w-20 bg-[#130b29] border border-white/10 rounded px-2 py-1 text-xs font-mono"
            aria-label="Time (m:ss)"
        />
    );
}

// Shown where a step needs the approved notes and the page has changes not yet approved.
function NeedsApproval({ what, approved, busy, onApprove, onDiscard }: {
    what: string; approved: boolean; busy: boolean; onApprove: () => void; onDiscard: () => void;
}) {
    return (
        <div role="status" className="rounded-lg border-2 border-amber-500/70 bg-amber-950/50 px-4 py-3 flex flex-wrap items-center gap-3">
            <p className="text-sm font-bold text-amber-200 flex-1 min-w-[14rem]">
                ⚠️ {approved ? `Approve your recent changes in order to ${what}.` : `Approve the show notes in order to ${what}.`}
                <span className="block text-xs font-normal text-amber-100/80 mt-0.5">
                    The next steps use the approved notes, so edits count once they are approved.
                </span>
            </p>
            <span className="flex flex-wrap gap-2">
                {approved && <button onClick={onDiscard} disabled={busy} className={secondary}>Discard changes</button>}
                <button onClick={onApprove} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-amber-500 text-black font-semibold hover:bg-amber-400 disabled:opacity-40">
                    {approved ? "Approve changes" : "Approve show notes"}
                </button>
            </span>
        </div>
    );
}

// "the edit package, final cut and episode approval"
const listed = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// What changed between two versions of the notes (notesChanges in lib/showNotes.ts).
function Changes({ changes, none }: { changes: { part: string; detail: string }[]; none: string }) {
    return (
        <ul className="text-sm text-gray-200 list-disc pl-5 flex flex-col gap-0.5 break-words">
            {changes.length
                ? changes.map(c => <li key={c.part}><span className="font-semibold">{c.part}</span>: {c.detail}</li>)
                : <li>{none}</li>}
        </ul>
    );
}

// The later steps that record which approved notes they were made from, and where they show.
const MADE_FROM: Record<NonNullable<NotesView["madeFrom"]>["steps"][number], { label: string; stage: StageId }> = {
    package: { label: "edit package", stage: "package" },
    descript: { label: "Descript project", stage: "package" },
    final: { label: "final cut", stage: "final" },
    approval: { label: "episode approval", stage: "thumbnail" },
};

// Shown in the first stage made from earlier approved notes, where the choice to make it again
// is: what the newer approval changed, and the way back to the notes it was made from
// (restoreApproval in lib/server/notes.ts).
function ChangedSince({ madeFrom, approved, changes, busy, onRestore }: {
    madeFrom: NonNullable<NotesView["madeFrom"]>; approved: NonNullable<NotesView["approved"]>;
    changes: { part: string; detail: string }[] | null; busy: boolean; onRestore: () => void;
}) {
    const steps = listed(madeFrom.steps.map(s => MADE_FROM[s].label));
    return (
        <div id="changes-since" role="status" className="scroll-mt-28 rounded-lg border border-sky-500/40 bg-sky-950/30 px-4 py-3 flex flex-col gap-2">
            <p className="text-sm font-semibold text-sky-200">
                The show notes were approved again after the {steps} {madeFrom.steps.length > 1 ? "were" : "was"} made
            </p>
            {changes ? (
                <>
                    <p className={small}>
                        {madeFrom.steps.length > 1 ? "They were" : "It was"} made from the notes approved{madeFrom.by && ` by ${madeFrom.by}`}{madeFrom.at ? ` ${ago(madeFrom.at)}` : ""}.
                        The approval by {approved.by} {ago(approved.at)} changed:
                    </p>
                    <Changes changes={changes} none="Nothing in the notes themselves" />
                    <p className={small}>Make again what these changes affect, or, if they were a mistake, go back to the notes the {steps} {madeFrom.steps.length > 1 ? "were" : "was"} made from.</p>
                    <div><button onClick={onRestore} disabled={busy} className={secondary}>Go back to those notes</button></div>
                </>
            ) : (
                <>
                    <p className={small}>
                        Those notes were approved before the Studio kept earlier approvals, so it cannot show what changed.
                        If the change was a mistake, put the show notes back the way they were, then press the button: the {steps} count as made from them again.
                    </p>
                    <div><button onClick={onRestore} disabled={busy} className={secondary}>Use these notes for the {steps}</button></div>
                </>
            )}
        </div>
    );
}

// Anchors in older links and emails, and the parts inside a stage, open the stage they are in.
const ANCHOR_STAGE: Record<string, StageId> = { descript: "package", youtube: "thumbnail" };
const stageFor = (anchor: string): StageId | undefined =>
    STAGES.find(s => s.id === anchor)?.id ?? ANCHOR_STAGE[anchor] ?? (anchor.startsWith("notes-") ? "notes" : undefined);

const sameStep = (a: StepState | undefined, b: StepState) => !!a && a.done === b.done && a.failed === b.failed && a.working === b.working
    && a.summary === b.summary && a.key === b.key && a.link?.href === b.link?.href && a.link?.label === b.link?.label;

export default function ShowNotesPage() {
    const { episodeId } = useParams<{ episodeId: string }>();
    const { profile, loading } = useAuth();
    const allowed = profile?.role === "admin" || profile?.role === "producer";

    const [view, setView] = useState<EpisodeNotesView | null>(null);
    const [notes, setNotes] = useState<ShowNotes | null>(null);
    // Studio settings (lib/studioSettings.ts): the description lines, and whether Editor Light makes the final cut.
    const [settings, setSettings] = useState<StudioSettings | null>(null);
    useEffect(() => {
        studioFetch<SettingsView>("/api/studio/settings").then(v => setSettings(v.settings)).catch(() => {});
    }, []);
    const [loadedAt, setLoadedAt] = useState(0);   // remounts free-text list fields after a reload
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [redraftDirection, setRedraftDirection] = useState("");
    const [redraftOnly, setRedraftOnly] = useState<"all" | "description" | "titles">("all");
    const video = useRef<HTMLVideoElement>(null);

    const save = useCallback(async (value: ShowNotes, version: number) => {
        const res = await studioFetch<{ version: number }>(`/api/studio/episodes/${episodeId}/notes`, {
            method: "PUT",
            body: JSON.stringify({ notes: value, version }),
        });
        return res.version;
    }, [episodeId]);
    const autosave = useAutosave(save);
    const { reset, change, flush } = autosave;
    const broll = useBroll(episodeId, !loading && allowed);

    // Where each step stands, reported by its section (components/studio/steps.ts). When one
    // changes after the first report (a job finished, something approved), every section fetches
    // its view again, so the next step shows as soon as it is possible.
    const [steps, setSteps] = useState<Partial<Record<StepId, StepState>>>({});
    const [revision, setRevision] = useState(0);
    const stepKeys = useRef<Partial<Record<StepId, string>>>({});
    const report = useCallback((step: StepId, state: StepState) => {
        setSteps(all => (sameStep(all[step], state) ? all : { ...all, [step]: state }));
        const before = stepKeys.current[step];
        stepKeys.current[step] = state.key;
        if (before !== undefined && before !== state.key) setRevision(r => r + 1);
    }, []);
    // The steps follow who makes the final cut (Descript or Editor Light).
    const flow = flowFor(settings?.finalSource);
    const lightFlow = settings?.finalSource === "editorLight";
    const next = nextStep(flow, steps);
    const nextStage = next ? stageIn(flow, next)?.id : undefined;
    const stages = flow.stages.map((s, i) => {
        const status = stageStatus(s.steps, steps, next);
        const states = s.steps.map(id => steps[id]);
        const failedStep = s.steps.find(id => steps[id]?.failed);
        const detail = status === "next" && next ? `Next: ${labelIn(flow, next)}`
            : status === "failed" && failedStep ? `${labelIn(flow, failedStep)} failed`
                : status === "working" ? states.find(x => x?.working)?.summary ?? "" : "";
        return {
            ...s, n: i + 1, status, detail,
            summary: states.map(x => x?.summary).filter(Boolean).join(" · "),
            links: states.flatMap(x => (x?.link ? [x.link] : [])),
        };
    });

    // Which stages are unfolded. Once every step has reported (or after a few seconds), the stage
    // that needs the producer opens, and any that failed. After that a stage opens by itself the
    // first time it becomes the next one, and each time it fails anew; it never folds by itself,
    // and one the producer folded stays folded when the next step moves back and forth.
    const [open, setOpen] = useState<Partial<Record<StageId, boolean>>>({});
    const [waited, setWaited] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setWaited(true), 5000);
        return () => clearTimeout(timer);
    }, []);
    const settled = waited || flow.steps.every(([id]) => steps[id]);
    const reasons = settled ? [
        ...(nextStage ? [`next:${nextStage}`] : []),
        ...stages.filter(s => s.status === "failed").map(s => `failed:${s.id}:${s.steps.map(id => steps[id]?.key).join("|")}`),
    ] : [];
    const [opened, setOpened] = useState<string[]>([]);
    const fresh = reasons.filter(r => !opened.includes(r));
    if (fresh.length) {
        setOpened(o => [...o, ...fresh]);
        setOpen(o => ({ ...o, ...Object.fromEntries(fresh.map(r => [r.split(":")[1], true])) }));
    }
    const toggle = (id: StageId) => setOpen(o => ({ ...o, [id]: !o[id] }));
    const setAll = (value: boolean) => setOpen(Object.fromEntries(flow.stages.map(s => [s.id, value])));

    // Opens the stage an anchor is in and scrolls to it once it is showing.
    const scrollTarget = useRef<string | null>(null);
    const [scrollRequest, setScrollRequest] = useState(0);
    const go = useCallback((anchor: string) => {
        // Otherwise the stage the anchor is in, for parts shown in whichever stage needs them.
        const stage = stageFor(anchor) ?? document.getElementById(anchor)?.closest("section")?.id as StageId | undefined;
        if (!stage) return;
        setOpen(o => (o[stage] ? o : { ...o, [stage]: true }));
        scrollTarget.current = anchor;
        setScrollRequest(r => r + 1);
    }, []);
    useEffect(() => {
        const anchor = scrollTarget.current;
        if (!anchor) return;
        scrollTarget.current = null;
        document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (location.hash !== `#${anchor}`) history.replaceState(null, "", `#${anchor}`);
    }, [scrollRequest]);
    // A link to a stage (#thumbnail, from an email or bookmark) opens it once every section has
    // loaded, so the stages above it have their final height when it scrolls.
    const openedHash = useRef(false);
    const pageReady = settled && !!notes;
    useEffect(() => {
        if (!pageReady || openedHash.current) return;
        openedHash.current = true;
        if (location.hash.length > 1) go(location.hash.slice(1));
    }, [pageReady, go]);
    useEffect(() => {
        const onHash = () => go(location.hash.slice(1));
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, [go]);

    const load = useCallback(async () => {
        try {
            const data = await studioFetch<EpisodeNotesView>(`/api/studio/episodes/${episodeId}/notes`);
            setView(data);
            const draft = data.notes?.draft;
            // Belt and braces for drafts older than teaser clips and hashtags.
            setNotes(draft ? {
                ...draft,
                teaserClips: draft.teaserClips ?? [],
                hashtags: draft.hashtags ?? [],
                broll: (draft.broll ?? []).map(b => ({ ...b, style: b.style ?? "photo" })),
            } : null);
            reset(data.notes?.version ?? 0);
            setLoadedAt(Date.now());
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, [episodeId, reset]);

    useEffect(() => {
        if (!loading && allowed) load();
    }, [loading, allowed, load]);

    // While Claude is drafting, check back every few seconds.
    const drafting = view?.notes?.status === "queued" || view?.notes?.status === "generating";
    useEffect(() => {
        if (!drafting) return;
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, [drafting, load]);

    function edit(fn: (n: ShowNotes) => ShowNotes) {
        if (!notes) return;
        const next = fn(notes);
        setNotes(next);
        setNotice("");
        change(next);
    }

    const queue = useRef<TeaserClip[]>([]);
    const stopAt = useRef<number | null>(null);
    const seek = (ms: number) => {
        const v = video.current;
        if (!v) return;
        queue.current = [];
        stopAt.current = null;
        v.currentTime = ms / 1000;
        v.play().catch(() => {});
    };
    const now = () => Math.round((video.current?.currentTime ?? 0) * 1000);

    // Plays clips one after another, stopping at each clip's end.
    const playClips = (clips: TeaserClip[]) => {
        if (!clips[0]) return;
        seek(clips[0].startMs);
        queue.current = clips.slice(1);
        stopAt.current = clips[0].endMs;
    };
    const onTime = () => {
        const v = video.current;
        if (!v || stopAt.current === null || v.currentTime * 1000 < stopAt.current) return;
        const next = queue.current.shift();
        if (next) {
            stopAt.current = next.endMs;
            v.currentTime = next.startMs / 1000;
        } else {
            stopAt.current = null;
            v.pause();
        }
    };

    const findInTranscript = (text: string) => (view?.words.length ? locate(text, view.words) : true);

    // New text for a quote or clip, with times and speaker taken from the transcript when
    // the words are found there.
    const anchored = (text: string, nearMs: number, withEnd: boolean) => {
        const found = view?.words.length ? locate(text, view.words, nearMs) : null;
        if (!found) return { text };
        // Keep what the person typed; only the times and speaker come from the transcript.
        const { startMs, endMs, speaker } = found;
        return withEnd ? { text, startMs, endMs, speaker } : { text, startMs, speaker };
    };

    const inTeaser = (q: TeaserClip) => notes?.teaserClips.some(c => c.startMs === q.startMs && c.endMs === q.endMs) ?? false;
    function addQuoteToTeaser(q: TeaserClip) {
        edit(n => ({ ...n, teaserClips: [...n.teaserClips, { ...q }] }));
        setNotice(`Added to the “In this episode” clips (${((q.endMs - q.startMs) / 1000).toFixed(0)}s). Trim it there.`);
    }

    // The sentence being spoken at the video's current time.
    const lineAtVideo = (maxWords: number) => {
        const spoken = view?.words ?? [];
        const t = now();
        let i = spoken.findIndex(w => w.end >= t);
        if (i < 0) return null;
        const ends = (w: { text: string }) => /[.?!]["')\]]*$/.test(w.text);
        while (i > 0 && !ends(spoken[i - 1]) && spoken[i - 1].speaker === spoken[i].speaker && t - spoken[i - 1].start < 15000) i--;
        let j = i;
        while (j + 1 < spoken.length && j - i + 1 < maxWords && !ends(spoken[j]) && spoken[j + 1].speaker === spoken[i].speaker) j++;
        const picked = spoken.slice(i, j + 1);
        return { text: picked.map(w => w.text).join(" "), startMs: picked[0].start, endMs: picked[picked.length - 1].end, speaker: picked[0].speaker };
    };

    function editClip(i: number, patch: Partial<TeaserClip>) {
        edit(n => ({ ...n, teaserClips: n.teaserClips.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
    }
    function moveClip(i: number, by: number) {
        edit(n => {
            const clips = [...n.teaserClips];
            const [c] = clips.splice(i, 1);
            clips.splice(i + by, 0, c);
            return { ...n, teaserClips: clips };
        });
    }
    function addClip() {
        const line = lineAtVideo(25);
        if (!line) return setNotice("⚠️ Move the video to the line you want first.");
        edit(n => ({ ...n, teaserClips: [...n.teaserClips, line] }));
    }
    function editQuote(i: number, patch: Partial<ShowNotes["quotes"][number]>) {
        edit(n => ({ ...n, quotes: n.quotes.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
    }
    function addQuote() {
        const line = lineAtVideo(40);
        if (!line) return setNotice("⚠️ Move the video to the line you want first.");
        edit(n => ({ ...n, quotes: [...n.quotes, line].sort((a, b) => a.startMs - b.startMs) }));
    }

    async function run(fn: () => Promise<string>) {
        setBusy(true);
        setNotice("");
        try {
            setNotice(await fn());
        } catch (e) {
            setNotice(`⚠️ ${(e as Error).message}`);
        } finally {
            setBusy(false);
        }
    }

    const draft = (force: boolean) => run(async () => {
        if (view?.notes?.draft && !confirm("Draft new show notes? Claude's new draft replaces everything on this page, including your edits.")) return "";
        await studioFetch(`/api/studio/episodes/${episodeId}/notes/generate`, { method: "POST", body: JSON.stringify({ force }) });
        await load();
        return "Claude is drafting the show notes. This usually takes two to five minutes.";
    });

    const approve = () => run(async () => {
        if (!(await flush())) throw new Error(`Your latest changes could not be saved: ${autosave.lastError.current}`);
        await studioFetch(`/api/studio/episodes/${episodeId}/notes/approve`, {
            method: "POST",
            body: JSON.stringify({ version: autosave.version.current }),
        });
        await load();
        return "Show notes approved.";
    });

    const discard = () => run(async () => {
        if (!confirm("Discard the changes that are not approved? The show notes go back to the approved ones.")) return "";
        await flush();
        await studioFetch(`/api/studio/episodes/${episodeId}/notes/discard`, {
            method: "POST",
            body: JSON.stringify({ version: autosave.version.current }),
        });
        await load();
        return "Changes discarded: these are the approved show notes.";
    });

    // Back to the approval a later step was made from (see restoreApproval in lib/server/notes.ts).
    const restore = (to: number, kept: boolean) => run(async () => {
        const question = kept
            ? "Go back to the show notes those steps were made from? They replace the notes on this page, and the approval you are undoing is kept."
            : "Use the show notes as they are on this page for those steps? Only do this if you have put the notes back the way they were.";
        if (!confirm(question)) return "";
        if (!(await flush())) throw new Error(`Your latest changes could not be saved: ${autosave.lastError.current}`);
        await studioFetch(`/api/studio/episodes/${episodeId}/notes/restore`, {
            method: "POST",
            body: JSON.stringify({ version: autosave.version.current, to }),
        });
        await load();
        return "Done: the later steps are up to date with the approved show notes again.";
    });

    // The notes and b-roll steps, from this page's own state.
    const notesKey = view?.notes ? `${view.notes.status}:${view.notes.approved?.version}` : null;
    const notesApproved = view?.notes?.approved;
    // By content, not version: an edit typed and then undone needs no approval.
    const pendingChanges = useMemo(() => (notes && notesApproved && !sameNotes(notes, notesApproved.notes) ? notesChanges(notesApproved.notes, notes) : null),
        [notes, notesApproved]);
    const notesChanged = pendingChanges !== null;
    const madeFrom = view?.notes?.madeFrom ?? null;
    const sinceMade = useMemo(() => (madeFrom?.notes && notesApproved ? notesChanges(madeFrom.notes, notesApproved.notes) : null), [madeFrom, notesApproved]);
    const chosenTitle = notes?.titles[notes.chosenTitle] ?? "";
    const notesSummary = view?.notes?.status === "queued" || view?.notes?.status === "generating" ? "Claude is drafting the show notes…"
        : view?.notes?.status === "failed" ? failure("Drafting", view.notes.error)
            : !notes ? "Not drafted yet"
                : [chosenTitle && `“${chosenTitle}”`, !notesApproved ? "Ready to review and approve" : notesChanged ? "Changes not approved yet" : `Approved by ${notesApproved.by} ${ago(notesApproved.at)}`]
                    .filter(Boolean).join(" · ");
    useEffect(() => {
        if (notesKey === null) return;
        const status = view?.notes?.status;
        // Changes not yet approved are the producer's to approve (or undo) before anything else.
        report("notes", {
            done: !!view?.notes?.approved && !notesChanged, failed: status === "failed", working: status === "queued" || status === "generating",
            summary: notesSummary, link: null, key: notesKey,
        });
    }, [notesKey, notesSummary, notesChanged, view, report]);
    const brollPending = notes ? notes.broll.filter((b, i) => {
        const image = broll.image(i);
        return image?.idea !== b.idea.trim() || image.style !== b.style;
    }).length : null;
    const brollImages = broll.view?.images.length ?? 0;
    const brollSpent = broll.view?.images.reduce((t, i) => t + i.usd, 0) ?? 0;
    const brollSummary = broll.working ? "Generating images…"
        : broll.view?.status === "failed" ? failure("Some images", broll.view.error)
        : !notes?.broll.length ? "No b-roll ideas"
            : brollPending ? `${brollPending} of ${notes.broll.length} ideas need an image`
                : `${brollImages} image${brollImages === 1 ? "" : "s"} ready · $${brollSpent.toFixed(2)}`;
    // Keyed on the images, not the ideas, so typing an idea does not refresh every section.
    const brollKey = broll.view ? `${broll.view.status}:${broll.view.images.map(i => i.createdAt).join(",")}` : null;
    useEffect(() => {
        if (brollPending === null || brollKey === null) return;
        report("broll", {
            done: !broll.working && !!view?.notes?.approved && brollPending === 0, failed: !broll.working && broll.view?.status === "failed",
            working: broll.working || broll.starting, summary: brollSummary, link: null, key: broll.working ? "working" : brollKey,
        });
    }, [brollPending, brollKey, brollSummary, broll.working, broll.starting, broll.view?.status, view, report]);

    const copyDescription = () => {
        if (!notes) return;
        void navigator.clipboard.writeText(youtubeDescription(notes, settings ?? undefined));
        setNotice("Full description copied.");
    };

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

    const status = view?.notes?.status;
    const approved = view?.notes?.approved;
    const sinceStage = madeFrom ? MADE_FROM[madeFrom.steps[0]].stage : null;
    const changedSince = madeFrom && approved && (
        <ChangedSince madeFrom={madeFrom} approved={approved} changes={sinceMade} busy={busy || drafting}
            onRestore={() => restore(madeFrom.version, !!madeFrom.notes)} />
    );
    const upToDate = status === "approved" && !!approved && !notesChanged;
    // A meeting: the format says so, or the notes have decisions or action items.
    const meeting = settings?.format === "meeting" || (notes?.decisions?.length ?? 0) > 0 || (notes?.actionItems?.length ?? 0) > 0;
    // Images are made from the approved ideas, so only offered when the page shows exactly those.
    const brollChanged = brollPending ?? 0;
    const brollBlocked = !upToDate || broll.working || broll.starting;
    const saveLabel = { saved: "✓ Saved", unsaved: "Unsaved changes…", saving: "Saving…", error: "Not saved" }[autosave.saveState];
    const teaserSeconds = notes ? Math.round(notes.teaserClips.reduce((t, c) => t + c.endMs - c.startMs, 0) / 1000) : 0;
    const noteParts: [string, string, string?][] = notes ? [
        ["notes-title", "Title"],
        ["notes-teaser", "In this episode", `${notes.teaserClips.length} · ${teaserSeconds}s`],
        ["notes-description", "Description"],
        ["notes-summary", "Summary"],
        ...(settings?.format === "meeting" || (notes.decisions?.length ?? 0) > 0 || (notes.actionItems?.length ?? 0) > 0
            ? [["notes-meeting", "Decisions and actions", `${notes.actionItems?.length ?? 0}`] as [string, string, string?]]
            : []),
        ["notes-chapters", "Chapters", `${notes.chapters.length}`],
        ["notes-quotes", "Key quotes", `${notes.quotes.length}`],
        ["notes-tags", "Tags"],
        ["notes-extras", "Social posts"],
        ["notes-downloads", "Downloads"],
    ] : [];
    const stageProps = (id: StageId) => {
        const s = stages.find(x => x.id === id) ?? { ...STAGES.find(x => x.id === id)!, n: 0, status: "waiting" as const, summary: "", links: [] };
        return {
            id, n: s.n, title: s.title, checkpoint: "checkpoint" in s ? s.checkpoint : undefined,
            status: s.status, summary: s.summary, links: s.links, open: !!open[id], onToggle: () => toggle(id),
        };
    };
    const tracked: TrackedStage[] = stages.map(({ id, n, title, status, detail }) => ({ id, n, title, status, detail }));
    const doneCount = stages.filter(s => s.status === "done").length;
    const on = !loading && allowed;

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-4 pb-32 sm:p-8 sm:pb-32">
                <div className="max-w-7xl mx-auto flex flex-col gap-6">
                    <div>
                        <Link href="/admin/podcast" className="text-sm text-gray-400 hover:text-white">← Podcast Studio</Link>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 mt-3">Show notes and production</p>
                        <h1 className="text-2xl sm:text-3xl font-bold text-amber-400 mt-1 break-words">{view?.title ?? "Show notes"}</h1>
                        {view && (
                            <p className="text-sm text-gray-400 mt-1">
                                {[view.recordedAt?.slice(0, 10), minutes(view.durationSeconds)].filter(Boolean).join(" · ")}
                                {view.notes?.generatedAt && ` · Drafted by Claude ${ago(view.notes.generatedAt)}`}
                                {" · "}
                                <Link href={`/admin/podcast/${episodeId}`} className="hover:text-white hover:underline">Speaker review</Link>
                            </p>
                        )}
                        {view && (
                            <div className="mt-3"><Journey episodeId={episodeId} source={settings?.finalSource} state={{ accepted: view.transcriptAccepted, notesApproved: !!steps.notes?.done, finalReady: !!steps.final?.done, published: !!steps.youtube?.done, shortsScheduled: !!steps.shorts?.done }} /></div>
                        )}
                    </div>

                    <ErrorNote message={error} />
                    {!view && !error && <p className="text-gray-400">Loading…</p>}

                    {view && !view.transcriptAccepted && (
                        <p className="text-sm text-gray-300">
                            Show notes are drafted from the accepted transcript.{" "}
                            <Link href={`/admin/podcast/${episodeId}`} className="text-amber-300 hover:underline">Review and accept the speakers first.</Link>
                        </p>
                    )}

                    {view?.transcriptAccepted && !notes && (
                        <div className="bg-[#1E1035]/40 border border-white/5 rounded-2xl p-6 flex flex-col gap-3 items-start">
                            {drafting ? (
                                <p className="text-gray-300">Claude is drafting the show notes. This usually takes two to five minutes; this page updates by itself.</p>
                            ) : (
                                <>
                                    {status === "failed" && <ErrorNote title="Drafting failed" message={view.notes?.error ?? "No reason given"} />}
                                    <p className="text-gray-300">No show notes yet.</p>
                                    <button onClick={() => draft(false)} disabled={busy} className={primary}>Draft show notes</button>
                                </>
                            )}
                        </div>
                    )}

                    {view && notes && (
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] items-start">
                            <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto lg:pr-1">
                                {view.videoUrl && (
                                    <video ref={video} src={view.videoUrl} controls preload="metadata" onTimeUpdate={onTime} className="w-full rounded-xl bg-black aspect-video" />
                                )}
                                <p className={small}>
                                    Click ▶ beside a clip, chapter, quote or b-roll idea to check it against the video.
                                    &ldquo;Add at video time&rdquo; uses where the video is paused.
                                </p>
                                <div className="hidden lg:block border-t border-white/5 pt-4">
                                    <StepTracker stages={tracked} onGo={go} />
                                </div>
                            </div>

                            <div className="flex flex-col gap-4 min-w-0">
                                <div className="flex flex-wrap items-center justify-between gap-2 -mb-1">
                                    <p className="text-sm text-gray-400">
                                        {next
                                            ? <span className="lg:hidden">{doneCount} of {stages.length} stages done</span>
                                            : <span className="text-emerald-300 font-medium">✓ Every stage is done: the episode is on YouTube and its shorts are scheduled.</span>}
                                    </p>
                                    <div className="flex items-center gap-1 text-xs">
                                        <button onClick={() => setAll(true)} className="px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-white/5">Expand all</button>
                                        <span aria-hidden className="text-gray-600">·</span>
                                        <button onClick={() => setAll(false)} className="px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-white/5">Collapse all</button>
                                    </div>
                                </div>

                                <Stage {...stageProps("notes")} intro="Check what Claude drafted against the video, edit anything, then approve at the bottom of the page. Changes save as you type.">
                                    {drafting && <p className="text-sm font-semibold text-sky-200">Claude is drafting new notes; they will replace these when ready.</p>}
                                    {status === "failed" && <ErrorNote title="The last redraft failed" message={view.notes?.error} />}
                                    {pendingChanges && approved && (
                                        <div role="status" className="rounded-lg border border-amber-500/50 bg-amber-950/30 px-4 py-3 flex flex-col gap-2">
                                            <p className="text-sm font-semibold text-amber-200">Changes not approved yet</p>
                                            <Changes changes={pendingChanges} none="Small edits" />
                                            <p className={small}>The next steps use the approved notes ({approved.by}, {ago(approved.at)}) until you approve these.</p>
                                            <div className="flex flex-wrap gap-2">
                                                <button onClick={approve} disabled={busy || drafting} className={primary}>Approve changes</button>
                                                <button onClick={discard} disabled={busy || drafting} className={secondary}>Discard changes</button>
                                            </div>
                                        </div>
                                    )}
                                    <nav aria-label="Parts of the show notes"
                                        className="sticky top-[65px] z-20 -mx-4 sm:-mx-5 -mt-2 px-4 sm:px-5 py-2 bg-[#180d2f]/95 backdrop-blur border-b border-white/5 flex gap-1.5 overflow-x-auto">
                                        {noteParts.map(([anchor, label, count]) => (
                                            <a key={anchor} href={`#${anchor}`} onClick={e => { e.preventDefault(); go(anchor); }}
                                                className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-white/10 text-gray-300 hover:border-amber-400/50 hover:text-amber-200 whitespace-nowrap">
                                                {label}{count && <span className="text-gray-500"> · {count}</span>}
                                            </a>
                                        ))}
                                    </nav>
                                    <div className="flex flex-col">
                                        <Part id="notes-title" title="Title" hint="Pick one; edit any of them. Under 70 characters shows in full on YouTube.">
                                            {notes.titles.map((t, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <input
                                                        type="radio"
                                                        name="title"
                                                        checked={notes.chosenTitle === i}
                                                        onChange={() => edit(n => ({ ...n, chosenTitle: i }))}
                                                        aria-label={`Use title ${i + 1}`}
                                                    />
                                                    <input
                                                        value={t}
                                                        onChange={e => edit(n => ({ ...n, titles: n.titles.map((x, j) => (j === i ? e.target.value : x)) }))}
                                                        className={field}
                                                    />
                                                    <span className={`${small} w-10 text-right ${t.length > 70 ? "text-orange-300" : ""}`}>{t.length}</span>
                                                </div>
                                            ))}
                                            <button onClick={() => edit(n => ({ ...n, titles: [...n.titles, ""] }))} className={`${secondary} self-start`}>+ Add a title</button>
                                        </Part>

                                        <Part id="notes-teaser" title="“In this episode” clips"
                                            hint="Played in order at the start, tagged “In this episode” with the speaker’s name. Leave them wanting more: end on a question or cut before the answer."
                                            aside={notes.teaserClips.length > 0 && (
                                                <span className="flex items-center gap-3">
                                                    <span className={`text-xs ${teaserSeconds < 20 || teaserSeconds > 40 ? "text-orange-300" : "text-gray-400"}`}>{teaserSeconds}s in total; aim for 20–40</span>
                                                    <button onClick={() => playClips(notes.teaserClips)} className={secondary}>▶ Play the teaser</button>
                                                </span>
                                            )}>
                                            {!notes.teaserClips.length && (
                                                <p className={small}>No clips yet. Add them from the video below, or draft again with Claude.</p>
                                            )}
                                            {notes.teaserClips.map((c, i) => (
                                                <div key={`${i}-${c.startMs}-${c.endMs}`} className="flex flex-col gap-1.5 border-l-2 border-amber-500/40 pl-3">
                                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                                        <span className="text-gray-500 w-4">{i + 1}</span>
                                                        <button onClick={() => playClips([c])} className="text-gray-400 hover:text-amber-300" title="Play this clip">▶</button>
                                                        <TimeInput ms={c.startMs} onChange={ms => editClip(i, { startMs: ms })} />
                                                        <span className="text-gray-500">to</span>
                                                        <TimeInput ms={c.endMs} onChange={ms => editClip(i, { endMs: ms })} />
                                                        <span className="text-gray-300">{c.speaker}</span>
                                                        <span className="text-gray-500">{((c.endMs - c.startMs) / 1000).toFixed(1)}s</span>
                                                        <span className="ml-auto flex gap-2">
                                                            <button onClick={() => moveClip(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-white disabled:opacity-30" title="Earlier">▲</button>
                                                            <button onClick={() => moveClip(i, 1)} disabled={i === notes.teaserClips.length - 1} className="text-gray-400 hover:text-white disabled:opacity-30" title="Later">▼</button>
                                                            <button onClick={() => edit(n => ({ ...n, teaserClips: n.teaserClips.filter((_, j) => j !== i) }))} className="text-gray-500 hover:text-red-300">Remove</button>
                                                        </span>
                                                    </div>
                                                    <textarea value={c.text} onChange={e => editClip(i, anchored(e.target.value, c.startMs, true))} rows={2} className={field} />
                                                    {!findInTranscript(c.text) && (
                                                        <p className="text-xs text-orange-300">Not found word for word in the transcript, so the times were not updated. Check the words or set the times by hand.</p>
                                                    )}
                                                </div>
                                            ))}
                                            <button onClick={() => addClip()} disabled={!view.words.length} className={`${secondary} self-start`}>
                                                + Add the line at video time
                                            </button>
                                        </Part>

                                        <Part id="notes-description" title="YouTube description" hint="Hook and keywords in the first two lines: that is all YouTube shows before “more”.">
                                            <textarea value={notes.description} onChange={e => edit(n => ({ ...n, description: e.target.value }))} rows={8} className={field} />
                                            {notes.descriptionOptions?.length > 0 && (
                                                <details open className="text-sm">
                                                    <summary className="cursor-pointer text-gray-300">Other descriptions to choose from ({notes.descriptionOptions.length})</summary>
                                                    <div className="mt-2 flex flex-col gap-2">
                                                        {notes.descriptionOptions.map((opt, i) => (
                                                            <div key={i} className="flex flex-col gap-1 border border-white/5 rounded p-2">
                                                                <p className="text-gray-300 whitespace-pre-wrap">{opt}</p>
                                                                <button onClick={() => edit(n => chooseDescription(n, i))} className={`${secondary} self-start`}>Use this one</button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            )}
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Hashtags (three; YouTube shows them above the title)</span>
                                                <input
                                                    key={loadedAt}
                                                    defaultValue={notes.hashtags.join(" ")}
                                                    onChange={e => {
                                                        const list = e.target.value.split(/[\s,]+/).filter(Boolean).map(h => (h.startsWith("#") ? h : `#${h}`));
                                                        edit(n => ({ ...n, hashtags: list }));
                                                    }}
                                                    className={field}
                                                />
                                            </label>
                                            <details className="text-sm">
                                                <summary className="cursor-pointer text-gray-300">Preview the full description as it goes on YouTube</summary>
                                                <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-300 bg-[#130b29] border border-white/5 rounded-lg p-3">{youtubeDescription(notes, settings ?? undefined)}</pre>
                                            </details>
                                            <div className="flex items-center gap-3">
                                                <p className={small}>{words(notes.description)} words, plus the site link, chapters, subscribe line and hashtags</p>
                                                <button onClick={copyDescription} className={secondary}>Copy full description</button>
                                            </div>
                                        </Part>

                                        <Part id="notes-summary" title="Summary" hint="For the episode page on the website.">
                                            <textarea value={notes.summary} onChange={e => edit(n => ({ ...n, summary: e.target.value }))} rows={6} className={field} />
                                        </Part>

                                        {(settings?.format === "meeting" || (notes.decisions?.length ?? 0) > 0 || (notes.actionItems?.length ?? 0) > 0) && (
                                            <Part id="notes-meeting" title="Decisions and action items" hint="What was decided, and who does what by when.">
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-gray-400">Decisions, one per line</span>
                                                    <textarea
                                                        key={loadedAt}
                                                        defaultValue={(notes.decisions ?? []).join("\n")}
                                                        onChange={e => {
                                                            const list = e.target.value.split("\n").map(d => d.trim()).filter(Boolean);
                                                            edit(n => ({ ...n, decisions: list }));
                                                        }}
                                                        rows={Math.max(2, (notes.decisions ?? []).length)}
                                                        className={field}
                                                    />
                                                </label>
                                                <div className="flex flex-col gap-2">
                                                    <span className="text-xs text-gray-400">Action items</span>
                                                    {(notes.actionItems ?? []).map((item, i) => (
                                                        <div key={i} className="flex flex-wrap items-center gap-2">
                                                            <input
                                                                aria-label="Task"
                                                                value={item.task}
                                                                onChange={e => edit(n => ({ ...n, actionItems: (n.actionItems ?? []).map((a, j) => j === i ? { ...a, task: e.target.value } : a) }))}
                                                                className={field}
                                                                placeholder="What to do"
                                                            />
                                                            <input
                                                                aria-label="Owner"
                                                                value={item.owner}
                                                                onChange={e => edit(n => ({ ...n, actionItems: (n.actionItems ?? []).map((a, j) => j === i ? { ...a, owner: e.target.value } : a) }))}
                                                                className={`${field} w-32`}
                                                                placeholder="Owner"
                                                            />
                                                            <input
                                                                aria-label="Due"
                                                                value={item.due}
                                                                onChange={e => edit(n => ({ ...n, actionItems: (n.actionItems ?? []).map((a, j) => j === i ? { ...a, due: e.target.value } : a) }))}
                                                                className={`${field} w-32`}
                                                                placeholder="Due"
                                                            />
                                                            <button
                                                                onClick={() => edit(n => ({ ...n, actionItems: (n.actionItems ?? []).filter((_, j) => j !== i) }))}
                                                                className="text-gray-500 hover:text-red-300"
                                                                aria-label="Remove action item"
                                                            >✕</button>
                                                        </div>
                                                    ))}
                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <button onClick={() => edit(n => ({ ...n, actionItems: [...(n.actionItems ?? []), { task: "", owner: "", due: "" }] }))} className={`${secondary} self-start`}>+ Add an action item</button>
                                                        <button
                                                            onClick={() => {
                                                                if (!view) return;
                                                                const title = notes.titles[notes.chosenTitle] ?? view.title;
                                                                const date = view.recordedAt ? view.recordedAt.slice(0, 10) : null;
                                                                const bytes = meetingDocx({
                                                                    title, date, summary: notes.summary,
                                                                    decisions: notes.decisions ?? [], actionItems: notes.actionItems ?? [],
                                                                    chapters: notes.chapters,
                                                                });
                                                                const blob = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
                                                                const url = URL.createObjectURL(blob);
                                                                const a = document.createElement("a");
                                                                a.href = url;
                                                                a.download = `${title.replace(/[\\/:*?"<>|]/g, "-")} - meeting notes.docx`;
                                                                a.click();
                                                                URL.revokeObjectURL(url);
                                                            }}
                                                            className={secondary}
                                                        >Download meeting notes (Word)</button>
                                                    </div>
                                                </div>
                                            </Part>
                                        )}

                                        <Part id="notes-chapters" title="Chapters" hint="YouTube needs the first at 0:00, at least three, each 10 seconds or longer.">
                                            {notes.chapters.map((c, i) => (
                                                <div key={`${i}-${c.startMs}`} className="flex items-center gap-2">
                                                    <button onClick={() => seek(c.startMs)} className="text-gray-400 hover:text-amber-300" title="Play from here">▶</button>
                                                    <TimeInput ms={c.startMs} onChange={ms => edit(n => ({
                                                        ...n,
                                                        chapters: n.chapters.map((x, j) => (j === i ? { ...x, startMs: ms } : x)).sort((a, b) => a.startMs - b.startMs),
                                                    }))} />
                                                    <input
                                                        value={c.title}
                                                        onChange={e => edit(n => ({ ...n, chapters: n.chapters.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))}
                                                        className={field}
                                                    />
                                                    <button onClick={() => edit(n => ({ ...n, chapters: n.chapters.filter((_, j) => j !== i) }))} className="text-gray-500 hover:text-red-300" title="Remove">✕</button>
                                                </div>
                                            ))}
                                            <button
                                                onClick={() => edit(n => ({ ...n, chapters: [...n.chapters, { startMs: now(), title: "" }].sort((a, b) => a.startMs - b.startMs) }))}
                                                className={`${secondary} self-start`}
                                            >
                                                + Add at video time
                                            </button>
                                        </Part>

                                        <Part id="notes-quotes" title="Key quotes"
                                            hint={`Word for word, up to two minutes each. Raw material for shorts and social posts; delete the ones you don't want.${notes.quotes.length ? ` ${notes.quotes.length} quotes from ${new Set(notes.quotes.map(q => q.speaker)).size} speakers.` : ""}`}>
                                            {notes.quotes.map((q, i) => (
                                                <div key={i} className="flex flex-col gap-1.5 border-l-2 border-amber-500/30 pl-3">
                                                    <textarea
                                                        value={q.text}
                                                        onChange={e => editQuote(i, anchored(e.target.value, q.startMs, true))}
                                                        rows={Math.min(8, Math.max(2, Math.ceil(q.text.length / 110)))}
                                                        className={field}
                                                    />
                                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                                        <button onClick={() => playClips([q])} className="text-gray-400 hover:text-amber-300" title="Play this quote">
                                                            ▶ {mmss(q.startMs)}{q.endMs > q.startMs ? `–${mmss(q.endMs)}` : ""}
                                                        </button>
                                                        <span className="text-gray-300">{q.speaker}</span>
                                                        {q.endMs > q.startMs && <span className="text-gray-500">{Math.round((q.endMs - q.startMs) / 1000)}s</span>}
                                                        {inTeaser(q) ? (
                                                            <span className="text-green-300">✓ In the teaser</span>
                                                        ) : (
                                                            <button onClick={() => addQuoteToTeaser(q)} className="text-amber-300 hover:underline">+ Add to “In this episode”</button>
                                                        )}
                                                        {!findInTranscript(q.text) && (
                                                            <span className="text-orange-300">Not found word for word in the transcript: check it.</span>
                                                        )}
                                                        <button onClick={() => edit(n => ({ ...n, quotes: n.quotes.filter((_, j) => j !== i) }))} className="ml-auto text-gray-500 hover:text-red-300">Remove</button>
                                                    </div>
                                                </div>
                                            ))}
                                            <button onClick={() => addQuote()} disabled={!view.words.length} className={`${secondary} self-start`}>
                                                + Add the line at video time
                                            </button>
                                            <p className={small}>Pause the video where the quote starts, add it, then trim the words to the quote.</p>
                                        </Part>

                                        <Part id="notes-tags" title="Tags, themes and topics" hint="Separate with commas.">
                                            {(["tags", "themes", "topics"] as const).map(key => (
                                                <label key={key} className="flex flex-col gap-1">
                                                    <span className="text-xs text-gray-400 capitalize">{key}</span>
                                                    {/* Uncontrolled: commas and spaces stay as typed; the list is saved trimmed. */}
                                                    <textarea
                                                        key={loadedAt}
                                                        defaultValue={notes[key].join(", ")}
                                                        onChange={e => {
                                                            const list = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
                                                            edit(n => ({ ...n, [key]: list }));
                                                        }}
                                                        rows={2}
                                                        className={field}
                                                    />
                                                </label>
                                            ))}
                                        </Part>

                                        {/* Social posts and follow-up email from the approved notes */}
                                        <Part id="notes-extras" title={meeting ? "Social posts and follow-up email" : "Social posts"}
                                            hint="Claude writes a LinkedIn post, an Instagram caption and a post for X from the approved notes, each ready to copy.">
                                            {upToDate
                                                ? <WritingExtras episodeId={episodeId} meeting={meeting} />
                                                : <p className={small}>Approve the show notes first; the posts are written from them.</p>}
                                        </Part>

                                        {/* The accepted transcript as Word, plain text and captions */}
                                        <Part id="notes-downloads" title="Transcript downloads" hint="The accepted transcript, with times from the original recording.">
                                            <TranscriptDownloads title={view.title} words={view.words} />
                                        </Part>
                                    </div>
                                    <div className="flex flex-col gap-3 border-t border-white/5 pt-4">
                                        <p className="text-xs text-gray-400 leading-relaxed rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                                            <span className="font-semibold text-gray-200">Changing the notes after sending to Descript?</span> Say, more &ldquo;In this episode&rdquo; clips:
                                            edit them here, approve the changes, rebuild the edit package, then send to Descript again.
                                        </p>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-sm text-gray-200">Draft again with Claude</label>
                                            <textarea
                                                aria-label="Direction for Claude"
                                                maxLength={1000}
                                                rows={2}
                                                value={redraftDirection}
                                                onChange={e => setRedraftDirection(e.target.value)}
                                                className={field}
                                                placeholder={'Your direction (optional), e.g. \u201CWarmer and shorter, and lead with the budget decision.\u201D'}
                                            />
                                            <select
                                                aria-label="What to draft again"
                                                value={redraftOnly}
                                                onChange={e => setRedraftOnly(e.target.value as "all" | "description" | "titles")}
                                                className={`${field} w-48`}
                                            >
                                                <option value="all">Everything</option>
                                                <option value="description">Only the description</option>
                                                <option value="titles">Only the titles</option>
                                            </select>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <button
                                                    onClick={() => {
                                                        if (redraftOnly === "all" && view?.notes?.draft &&
                                                            !confirm("Draft everything again? Claude's new draft replaces everything in this stage, including your edits.")) return;
                                                        void run(async () => {
                                                            await flush();
                                                            await studioFetch(`/api/studio/episodes/${episodeId}/notes/generate`, {
                                                                method: "POST",
                                                                body: JSON.stringify({ force: true, instruction: redraftDirection, only: redraftOnly }),
                                                            });
                                                            setRedraftDirection("");
                                                            await load();
                                                            return redraftOnly === "all"
                                                                ? "Claude is drafting the show notes again. This usually takes two to five minutes."
                                                                : `Claude is rewriting the ${redraftOnly === "description" ? "description" : "titles"}. Everything else stays as it is. This usually takes two to five minutes.`;
                                                        });
                                                    }}
                                                    disabled={busy || drafting}
                                                    className={secondary}
                                                >Draft again</button>
                                                <span className={small}>
                                                    {redraftOnly === "all"
                                                        ? "Everything is replaced: Claude's new draft replaces everything in this stage, including your edits."
                                                        : `Only the ${redraftOnly === "description" ? "description" : "titles"} is replaced; everything else stays as you left it.`}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </Stage>

                                <Stage {...stageProps("broll")} intro="Images made by AI from the approved ideas. The edit package turns each into a clip with a slow zoom or pan, and they go to Descript with the episode, in its media bin.">
                                    {notes.broll.map((b, i) => (
                                        <div key={`${i}-${b.startMs}`} className="flex flex-col gap-1.5 border-l-2 border-sky-500/30 pl-3">
                                            <div className="flex items-center gap-2 text-xs">
                                                <button onClick={() => seek(b.startMs)} className="text-gray-400 hover:text-amber-300" title="Play from here">▶</button>
                                                <TimeInput ms={b.startMs} onChange={ms => edit(n => ({ ...n, broll: n.broll.map((x, j) => (j === i ? { ...x, startMs: ms } : x)) }))} />
                                                <span className="text-gray-400">for</span>
                                                <input
                                                    type="number"
                                                    min={3}
                                                    max={15}
                                                    value={b.durationSeconds}
                                                    onChange={e => edit(n => ({ ...n, broll: n.broll.map((x, j) => (j === i ? { ...x, durationSeconds: Number(e.target.value) || 3 } : x)) }))}
                                                    className="w-16 bg-[#130b29] border border-white/10 rounded px-2 py-1"
                                                />
                                                <span className="text-gray-400">seconds</span>
                                                <select
                                                    value={b.style}
                                                    onChange={e => edit(n => ({ ...n, broll: n.broll.map((x, j) => (j === i ? { ...x, style: e.target.value as BrollStyle } : x)) }))}
                                                    className="bg-[#130b29] border border-white/10 rounded px-2 py-1"
                                                    aria-label="Image style"
                                                    title="Photoreal for everyday things and places; Digital for spiritual and otherworldly moments"
                                                >
                                                    {BROLL_STYLE_IDS.map(id => <option key={id} value={id}>{BROLL_STYLES[id].label}</option>)}
                                                </select>
                                                <button onClick={() => edit(n => ({ ...n, broll: n.broll.filter((_, j) => j !== i) }))} className="ml-auto text-gray-500 hover:text-red-300">Remove</button>
                                            </div>
                                            <textarea
                                                value={b.idea}
                                                onChange={e => edit(n => ({ ...n, broll: n.broll.map((x, j) => (j === i ? { ...x, idea: e.target.value } : x)) }))}
                                                rows={2}
                                                className={field}
                                            />
                                            <p className={small}>{b.why}</p>
                                            <BrollImageView broll={broll} index={i} idea={b.idea} style={b.style} />
                                            {broll.image(i) && (
                                                <button
                                                    onClick={() => broll.generate(i)}
                                                    disabled={brollBlocked}
                                                    className={`${secondary} self-start`}
                                                    title={upToDate ? "Make a new image for this idea" : "Approve your recent changes first"}
                                                >
                                                    Regenerate this image
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => edit(n => ({ ...n, broll: [...n.broll, { startMs: now(), durationSeconds: 6, idea: "", why: "Added by hand", style: "photo" }] }))}
                                        className={`${secondary} self-start`}
                                    >
                                        + Add at video time
                                    </button>
                                    <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-3">
                                        <button
                                            onClick={() => broll.generate(null)}
                                            disabled={brollBlocked || brollChanged === 0}
                                            className={primary}
                                        >
                                            {broll.working ? "Generating images…" : brollChanged === 0 && notes.broll.length
                                                ? "✓ All images generated"
                                                : `Generate ${brollChanged === notes.broll.length ? "b-roll images" : `${brollChanged} new image${brollChanged === 1 ? "" : "s"}`}`}
                                        </button>
                                        <span className={small}>
                                            {broll.working
                                                ? "About a minute per image; this page updates by itself."
                                                : !upToDate
                                                    ? ""
                                                    : brollChanged
                                                        ? `About $${(brollChanged * BROLL_USD_PER_IMAGE).toFixed(2)} with OpenAI's image model. Ideas that already have an image are left alone.`
                                                        : ""}
                                        </span>
                                    </div>
                                    {!upToDate && !broll.working && (
                                        <NeedsApproval what="generate images" approved={!!approved} busy={busy || drafting} onApprove={approve} onDiscard={discard} />
                                    )}
                                    {(broll.error || broll.view?.error) && (
                                        <ErrorNote title={broll.error ? undefined : "Some b-roll images failed"} message={broll.error || broll.view?.error} />
                                    )}
                                </Stage>

                                {!lightFlow && (
                                    <Stage {...stageProps("package")} intro="Everything for the edit, built from the approved notes, then made into a Descript project. Descript has the final say: the edit happens there.">
                                        {sinceStage === "package" && changedSince}
                                        {!upToDate && (
                                            <NeedsApproval what="build the edit package" approved={!!approved} busy={busy || drafting} onApprove={approve} onDiscard={discard} />
                                        )}
                                        <EditPackage episodeId={episodeId} enabled={on} upToDate={upToDate} report={report} revision={revision} />
                                        {/* With Editor Light set in the Studio settings it has its own stage below; this preview shows
                                            only with the env switch and the view loaded. */}
                                        {process.env.NEXT_PUBLIC_EDITOR_LIGHT === '1' && view && (
                                            <Part title="Edit here instead (preview)"
                                                aside={<Link href={`/admin/podcast/${episodeId}/edit`} className="text-sm text-amber-300 hover:underline">Open the full-page editor →</Link>}>
                                                <EditorLightStage
                                                    episodeId={episodeId}
                                                    words={view.words}
                                                    videoUrl={view.videoUrl ?? ''}
                                                />
                                            </Part>
                                        )}
                                    </Stage>
                                )}

                                <Stage {...stageProps("final")} intro={lightFlow
                                    ? "Cut the episode here: click words to remove them, preview the cut, then render it. The render is the final cut, set to broadcast loudness, with the chapter times moved onto it."
                                    : "When the edit in Descript is finished: the finished edit, published from Descript, set to broadcast loudness and saved to Drive, with the chapter times moved onto it."}>
                                    {sinceStage === "final" && changedSince}
                                    {lightFlow && view && (
                                        <Part title="Edit"
                                            aside={<Link href={`/admin/podcast/${episodeId}/edit`} className="text-sm text-amber-300 hover:underline">Open the full-page editor →</Link>}>
                                            <EditorLightStage
                                                episodeId={episodeId}
                                                words={view.words}
                                                videoUrl={view.videoUrl ?? ''}
                                            />
                                        </Part>
                                    )}
                                    <FinalCut episodeId={episodeId} enabled={on} report={report} revision={revision} />
                                </Stage>

                                <Stage {...stageProps("thumbnail")} intro="Thumbnails drive more views than anything else, so a person always picks one. Approving the episode clears it for YouTube.">
                                    {sinceStage === "thumbnail" && changedSince}
                                    <div className="flex flex-col">
                                        <Part id="thumbnail-options" title="Thumbnail and approval">
                                            <Thumbnails episodeId={episodeId} enabled={on} report={report} revision={revision} />
                                        </Part>
                                        <Part id="youtube" title="YouTube upload" hint="The approved episode, with the final cut's chapters, the approved thumbnail, captions and the AI disclosure.">
                                            <Youtube episodeId={episodeId} enabled={on} report={report} revision={revision} />
                                        </Part>
                                        {/* Part I: the captions, title and description in other languages, for viewers beyond English. */}
                                        <Part id="translations" title="Captions in other languages" hint="Claude translates the final cut's captions, title and description; YouTube shows each viewer their own language.">
                                            <Translations episodeId={episodeId} />
                                        </Part>
                                    </div>
                                </Stage>

                                <Stage {...stageProps("shorts")} intro="Vertical shorts from the key quotes, made here from the final cut (no Descript credits), approved one by one and scheduled on YouTube one a day.">
                                    <Shorts episodeId={episodeId} enabled={on} report={report} revision={revision} />
                                </Stage>
                            </div>
                        </div>
                    )}
                </div>

                {view && notes && (
                    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-[#130b29]/95 backdrop-blur">
                        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="flex flex-col min-w-[10rem] flex-1">
                                <span className="text-sm whitespace-nowrap">
                                    <span className="font-semibold text-gray-200">Show notes</span>{" "}
                                    <span className={autosave.saveState === "error" ? "text-red-300 font-bold" : autosave.saveState === "saved" ? "text-green-300" : "text-gray-400"}>
                                        {saveLabel}{autosave.saveState === "error" && `: ${autosave.saveError}`}
                                    </span>
                                </span>
                                {notice ? (
                                    <span className={`text-sm ${notice.startsWith("⚠️") ? "text-red-300 font-semibold" : "text-green-300"}`}>{notice}</span>
                                ) : autosave.saveState !== "error" && (
                                    <span className="hidden sm:block text-xs text-gray-400">
                                        {upToDate
                                            ? `Approved by ${approved!.by}. These are the show notes the next steps use.`
                                            : approved && pendingChanges
                                                ? `Not approved yet: ${pendingChanges.length ? pendingChanges.map(c => c.part).join(", ") : "small edits"}. Approve to use them in the next steps, or discard them.`
                                                : "Approve when the notes are right; they become the show notes the next steps use."}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 ml-auto">
                                {autosave.saveState === "error" && <button onClick={() => { void flush(); }} className={secondary}>Try again</button>}
                                {next && next !== "notes" && (
                                    <button onClick={() => go(nextStage!)} className={upToDate && !steps[next]?.working ? primary : secondary} title="Open and scroll to the next step">
                                        {steps[next]?.working ? "In progress" : "Next"}: {labelIn(flow, next)} →
                                    </button>
                                )}
                                {upToDate ? (
                                    <span className="text-sm text-emerald-300 px-1">✓ Approved</span>
                                ) : (
                                    <>
                                        {approved && notesChanged && <button onClick={discard} disabled={busy || drafting} className={secondary}>Discard</button>}
                                        <button onClick={approve} disabled={busy || drafting} className={primary}>
                                            {busy ? "Working…" : approved ? "Approve changes" : "Approve show notes"}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AuthGuard>
    );
}
