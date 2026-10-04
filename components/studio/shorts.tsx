"use client";

// Shorts and Checkpoint E on the show notes page (docs/specs/013-shorts.md). The producer can
// ask Claude for its picks and add or swap them in, ticks the key quotes to make into shorts,
// moves their ends by clicking words, has Claude write headlines and titles (or writes them),
// previews the cut, has them drawn, watches and approves each one, and schedules the approved
// ones on YouTube one a day. Edits save as they go.

import { useCallback, useEffect, useRef, useState } from "react";
import { ago } from "@/components/studio/format";
import { useAutosave } from "@/components/studio/useAutosave";
import { mmss } from "@/lib/showNotes";
import {
    DAY_MS, DEFAULT_ASPECT, HEADLINE_MAX_CHARS, publishSlot, QUOTE_MATCH_LOW, renderInputs, sameRender, SHORT_ASPECTS, SHORT_MAX_MS, SHORT_MIN_MS,
    SHORT_TARGET_MS, SHORT_TITLE_MAX, sideCrop, wordBounds, type ShortAspect, type ShortEdit,
} from "@/lib/shorts";
import { DIRECTION_MAX, isTaken, suggestionToShort, swapIn, type ShortSuggestion } from "@/lib/shortPicks";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";
import { failure, useStep, type ReportStep } from "@/components/studio/steps";
import { approveButton, chosen, primary, secondary } from "@/components/studio/ui";
import type { ShortItemView, ShortsView } from "@/types/studio";

const input = "bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white w-full";

const WORKING: Record<string, string> = { pick: "Finding the best moments…", titles: "Writing headlines and titles…", render: "Making the shorts…", upload: "Scheduling on YouTube…" };

type Edits = { aspect: ShortAspect; items: ShortEdit[] };

const pick = (i: ShortEdit): ShortEdit => ({
    id: i.id, quoteIndex: i.quoteIndex, speaker: i.speaker, startMs: i.startMs, endMs: i.endMs,
    headline: i.headline, title: i.title, synthetic: i.synthetic,
});

// <input type="datetime-local"> works in the browser's own time zone.
function localInput(ms: number) {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The day after the last short already scheduled (any episode), at the same time; or tomorrow at 5 pm.
function defaultFirstSlot(lastSlot: number | null) {
    if (lastSlot && lastSlot + DAY_MS > Date.now() + DAY_MS / 2) return lastSlot + DAY_MS;
    const d = new Date(Date.now() + DAY_MS);
    if (lastSlot) {
        const t = new Date(lastSlot);
        d.setHours(t.getHours(), t.getMinutes(), 0, 0);
    } else {
        d.setHours(17, 0, 0, 0);
    }
    return d.getTime();
}

export function Shorts({ episodeId, enabled, report, revision }: { episodeId: string; enabled: boolean; report?: ReportStep; revision?: number }) {
    const [view, setView] = useState<ShortsView | null>(null);
    const [edits, setEdits] = useState<Edits>({ aspect: DEFAULT_ASPECT, items: [] });
    const [error, setError] = useState("");
    const [starting, setStarting] = useState(false);
    const [firstAt, setFirstAt] = useState("");
    // The producer's direction for Claude's picks; null until loaded, then set once from view.direction.
    const [direction, setDirection] = useState<string | null>(null);
    // Signed links change on every load; keep the first one per render so a playing video is not reset.
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [finalUrl, setFinalUrl] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState<string | null>(null);
    const player = useRef<HTMLVideoElement | null>(null);
    const stopAt = useRef<number | null>(null);
    const base = `/api/studio/episodes/${episodeId}/shorts`;

    const save = useCallback(async (value: Edits, version: number) => {
        const res = await studioFetch<{ version: number }>(base, {
            method: "PATCH", body: JSON.stringify({ version, aspect: value.aspect, items: value.items.map(pick) }),
        });
        return res.version;
    }, [base]);
    const { saveState, saveError, change, flush, reset } = useAutosave<Edits>(save);
    const saveStateRef = useRef(saveState);
    useEffect(() => { saveStateRef.current = saveState; }, [saveState]);

    const load = useCallback(async (force = false) => {
        try {
            const next = await studioFetch<ShortsView>(base);
            setView(next);
            setError("");
            // Unsaved edits on this page win over what the server has, until they are saved.
            if (force || saveStateRef.current === "saved") {
                setEdits({ aspect: next.aspect, items: next.items.map(pick) });
                reset(next.version);
            }
            setFinalUrl(url => url ?? next.finalUrl);
            setUrls(prev => {
                const out = { ...prev };
                for (const i of next.items) if (i.render && !out[i.render.key]) out[i.render.key] = i.render.url;
                return out;
            });
            setFirstAt(value => value || localInput(defaultFirstSlot(next.lastSlot)));
            setDirection(value => value ?? next.direction);
        } catch (e) {
            setError((e as Error).message);
        }
    }, [base, reset]);

    useEffect(() => {
        if (enabled) load(true);
    }, [enabled, load]);

    const working = view?.status === "queued" || view?.status === "working";
    const scheduled = view?.items.filter(i => i.youtube).length ?? 0;
    const approvedCount = view?.items.filter(i => i.approved && !i.youtube).length ?? 0;
    useStep({
        step: "shorts", failed: view?.status === "failed", done: scheduled > 0, working,
        summary: working ? WORKING[view?.job ?? ""] ?? "Working…" : view?.status === "failed" ? failure("The shorts job", view.error)
            : view?.blocker ? "Waiting for the final cut"
                : view?.items.length ? [`${view.items.length} short${view.items.length === 1 ? "" : "s"}`, approvedCount ? `${approvedCount} approved` : "", scheduled ? `${scheduled} scheduled` : ""].filter(Boolean).join(" · ")
                : "No shorts yet: ask Claude for its picks or tick key quotes",
        key: view ? `${view.status}:${view.finishedAt}:${view.blocker}:${scheduled}` : null,
        report, revision, enabled, load,
    });
    const wasWorking = useRef(false);
    useEffect(() => {
        if (!working) {
            // The job just finished: take its results (new texts, renders, uploads).
            if (wasWorking.current) load();
            wasWorking.current = false;
            return;
        }
        wasWorking.current = true;
        const timer = setInterval(() => load(), 10000);
        return () => clearInterval(timer);
    }, [working, load]);

    function update(next: Edits) {
        setEdits(next);
        change(next);
    }
    const setItem = (id: string, patch: Partial<ShortEdit>) =>
        update({ ...edits, items: edits.items.map(i => (i.id === id ? { ...i, ...patch } : i)) });

    function move(id: string, by: number) {
        const items = [...edits.items];
        const at = items.findIndex(i => i.id === id);
        const to = at + by;
        if (at < 0 || to < 0 || to >= items.length) return;
        [items[at], items[to]] = [items[to], items[at]];
        update({ ...edits, items });
    }

    // Ticking a key quote makes it a short (the whole quote, to trim); unticking removes it.
    async function toggle(index: number) {
        const existing = edits.items.find(i => i.quoteIndex === index);
        if (existing) {
            const v = byId.get(existing.id);
            if (v?.youtube) return;
            if ((v?.render || existing.headline || existing.title) && !confirm("Remove this short, with its trim, texts and video?")) return;
            update({ ...edits, items: edits.items.filter(i => i.id !== existing.id) });
            return;
        }
        const q = view?.quotes[index];
        if (!q) return;
        const item: ShortEdit = {
            id: crypto.randomUUID().slice(0, 8), quoteIndex: index, speaker: q.speaker,
            startMs: q.startMs, endMs: Math.min(q.endMs, q.startMs + SHORT_MAX_MS), headline: "", title: "", synthetic: false,
        };
        update({ ...edits, items: [...edits.items, item] });
        // Saved at once, so its words for trimming come back.
        if (await flush()) await load(true);
    }

    async function start(mode: "pick" | "titles" | "render" | "upload") {
        setStarting(true);
        try {
            if (!(await flush())) throw new Error("Your changes could not be saved; fix that first");
            const body = mode === "upload"
                ? { mode, firstAt: new Date(firstAt).getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
                : mode === "pick" ? { mode, direction: direction ?? "" } : { mode };
            await studioFetch(base, { method: "POST", body: JSON.stringify(body) });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }

    // Adds a Claude pick as a new short, then flushes and reloads as toggle does.
    async function addPick(s: ShortSuggestion) {
        update({ ...edits, items: [...edits.items, suggestionToShort(s, crypto.randomUUID().slice(0, 8))] });
        if (await flush()) await load(true);
    }

    // Swaps a pick in for a short already chosen, after confirming if it has a render or texts.
    async function swapPick(targetId: string, s: ShortSuggestion) {
        const existing = byId.get(targetId);
        if (existing?.youtube) return;
        if ((existing?.render || existing?.headline || existing?.title) &&
            !confirm("Replace this short, with its trim, texts and video, by Claude's pick?")) return;
        update({ ...edits, items: swapIn(edits.items, targetId, s) });
        if (await flush()) await load(true);
    }

    async function approve(id: string, approved: boolean) {
        try {
            await studioFetch(base, { method: "POST", body: JSON.stringify({ approve: id, approved }) });
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    }

    // Plays a short's (or a key quote's) stretch of the final cut, before it is drawn.
    function preview(item: { id: string; startMs: number; endMs: number }) {
        const video = player.current;
        if (!video) return;
        setPreviewing(item.id);
        stopAt.current = item.endMs / 1000;
        video.currentTime = item.startMs / 1000;
        void video.play();
    }
    function onTime() {
        const video = player.current;
        if (video && stopAt.current !== null && video.currentTime >= stopAt.current) {
            video.pause();
            stopAt.current = null;
        }
    }

    const byId = new Map((view?.items ?? []).map(i => [i.id, i]));
    // Drawn from the short exactly as it is on this page, and from the current final cut.
    const drawn = (i: ShortEdit) => {
        const r = byId.get(i.id)?.render;
        return !!r && !!view && sameRender(r.inputs, renderInputs(i, edits.aspect, view.finalAt));
    };
    const toDraw = edits.items.filter(i => !byId.get(i.id)?.youtube && !drawn(i)).length;
    const waiting = edits.items.filter(i => drawn(i) && byId.get(i.id)?.approved && !byId.get(i.id)?.youtube);
    const firstMs = firstAt ? new Date(firstAt).getTime() : NaN;
    const used = new Set(edits.items.map(i => i.quoteIndex));
    const needTexts = edits.items.filter(i => !byId.get(i.id)?.youtube && (!i.headline.trim() || !i.title.trim())).length;
    const crop = `${sideCrop(edits.aspect) * 100}%`;

    return (
        <div className="flex flex-col gap-4">
            {view?.status === "failed" && <ErrorNote title="The shorts job failed" message={view.error} />}
            {view?.blocker ? (
                <p className="text-xs text-gray-400">{view.blocker}</p>
            ) : (
                <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => start("titles")} disabled={working || starting || !needTexts} className={secondary}
                        title="Claude writes a headline and title for each short that is missing one; clear a field to have it rewritten">
                        {working && view?.job === "titles" ? WORKING.titles : `Write headlines and titles${needTexts ? ` (${needTexts})` : ""}`}
                    </button>
                    <button onClick={() => start("render")} disabled={working || starting || !toDraw} className={primary}>
                        {working && view?.job === "render" ? WORKING.render : `Make ${toDraw || ""} short${toDraw === 1 ? "" : "s"}`.replace("  ", " ")}
                    </button>
                    {view?.finishedAt && !working && <span className="text-xs text-gray-400">Last job {ago(view.finishedAt)}</span>}
                    <span className="text-xs text-gray-400">
                        {saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : saveState === "error" ? "" : edits.items.length ? "Saved" : ""}
                    </span>
                </div>
            )}
            <p className="text-xs text-gray-400">
                {working
                    ? view?.job === "render" ? "About a minute a short. This page updates by itself and you get an email." : "This page updates by itself."
                    : "Tick the key quotes to make into shorts. Click a word to move the nearer end of a short there (20-60 seconds holds viewers best), preview it, then make it: 1080x1920, the episode above large captions with the spoken word in gold."}
            </p>
            <ErrorNote title="Your changes were not saved" message={saveError} />
            {view?.warnings.map(w => <p key={w} className="text-xs text-amber-300">{w}</p>)}

            {!view?.blocker && finalUrl && (
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
                    <div className="relative">
                        <video ref={player} src={finalUrl} controls preload="metadata" onTimeUpdate={onTime} onPause={() => setPreviewing(null)}
                            className="w-full rounded-xl bg-black aspect-video" />
                        {/* What the crop leaves out. */}
                        <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60 border-r border-amber-400/70 rounded-l-xl" style={{ width: crop }} />
                        <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/60 border-l border-amber-400/70 rounded-r-xl" style={{ width: crop }} />
                    </div>
                    <div className="flex flex-col gap-2 text-xs text-gray-400 md:w-56">
                        <p className="text-sm text-gray-300">Crop</p>
                        <div className="flex gap-2">
                            {SHORT_ASPECTS.map(a => (
                                <button key={a} onClick={() => update({ ...edits, aspect: a })} disabled={working}
                                    className={edits.aspect === a ? chosen : secondary}>{a}</button>
                            ))}
                        </div>
                        <p>The shaded sides are left out. 13:9 makes people larger; check nobody is cut at the edge.</p>
                        {previewing && <p className="text-amber-300">Previewing a short on the final cut</p>}
                    </div>
                </div>
            )}

            {!view?.blocker && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-gray-300">
                        Claude&apos;s picks <span className="text-xs text-gray-400">(the moments it would make into Shorts, best first, each with a score out of 10 and why)</span>
                    </p>
                    <textarea value={direction ?? ""} maxLength={DIRECTION_MAX} rows={2}
                        aria-label="Direction for Claude's picks"
                        placeholder="Optional: e.g. favour moments about decisions, or keep them under 45 seconds"
                        disabled={working}
                        onChange={e => setDirection(e.target.value)}
                        className={input} />
                    <button onClick={() => start("pick")} disabled={working || starting} className={secondary}>
                        {working && view?.job === "pick" ? WORKING.pick
                            : view?.suggestions.length ? "Find moments again" : "Find the best moments"}
                    </button>
                    {!!view?.suggestions.length && (
                        <ul className="flex flex-col gap-1 max-h-96 overflow-y-auto pr-1">
                            {view.suggestions.map(s => {
                                const taken = isTaken(s, edits.items);
                                const swapOptions = edits.items.filter(i => !byId.get(i.id)?.youtube);
                                return (
                                    <li key={s.id} className={`flex flex-col gap-1 text-xs rounded-lg px-2 py-1.5 ${taken ? "bg-amber-500/10" : "hover:bg-white/5"}`}>
                                        <div className="flex items-start gap-2">
                                            <span className="text-amber-300 font-medium">{s.score}/10</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-gray-400">
                                                    {mmss(s.startMs)}–{mmss(s.endMs)} · {Math.round((s.endMs - s.startMs) / 1000)}s · {s.speaker}
                                                </p>
                                                <p className="text-gray-200">&ldquo;{s.hook}&rdquo;</p>
                                                <p className="text-gray-400">{s.reason}</p>
                                            </div>
                                            <button onClick={() => preview({ id: s.id, startMs: s.startMs, endMs: s.endMs })} className={secondary}>▶ Preview</button>
                                        </div>
                                        <div className="flex items-center gap-2 pl-6">
                                            <button onClick={() => addPick(s)} disabled={taken || working}
                                                className={taken ? `${secondary} opacity-50` : secondary}>
                                                {taken ? "Added" : "Add as a short"}
                                            </button>
                                            {!taken && swapOptions.length > 0 && (
                                                <select aria-label="Swap for a short"
                                                    disabled={working}
                                                    value=""
                                                    onChange={e => { const v = e.target.value; if (v) swapPick(v, s); }}
                                                    className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200">
                                                    <option value="">Swap for…</option>
                                                    {swapOptions.map((i, n) => (
                                                        <option key={i.id} value={i.id}>
                                                            #{n + 1} {byId.get(i.id)?.headline || byId.get(i.id)?.title || mmss(i.startMs)}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {!view?.blocker && !!view?.quotes.length && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-gray-300">
                        Key quotes <span className="text-xs text-gray-400">({used.size} of {view.quotes.length} ticked as shorts; they are scheduled in the order below)</span>
                    </p>
                    <ul className="flex flex-col gap-1 max-h-96 overflow-y-auto pr-1">
                        {view.quotes.map((q, i) => {
                            const item = edits.items.find(x => x.quoteIndex === i);
                            const seconds = Math.round((q.endMs - q.startMs) / 1000);
                            return (
                                <li key={i} className={`flex items-start gap-2 text-xs rounded-lg px-2 py-1.5 ${item ? "bg-amber-500/10" : "hover:bg-white/5"}`}>
                                    <input type="checkbox" checked={!!item} disabled={working || !!(item && byId.get(item.id)?.youtube)}
                                        onChange={() => toggle(i)} className="mt-0.5" aria-label={`Make a short from the quote at ${mmss(q.startMs)}`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-gray-400">
                                            {mmss(q.startMs)} · {q.speaker} · <span className={seconds > SHORT_TARGET_MS / 1000 ? "text-amber-300" : ""}>{seconds}s</span>
                                            {q.match < QUOTE_MATCH_LOW && <span className="text-amber-300"> · much of it was cut in the edit; preview it</span>}
                                        </p>
                                        <p className="text-gray-200 line-clamp-2" title={q.text}>{q.text}</p>
                                    </div>
                                    <button onClick={() => preview({ id: `quote-${i}`, startMs: q.startMs, endMs: q.endMs })} className={secondary}>▶</button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {edits.items.map((item, n) => (
                <ShortCard key={item.id} n={n} item={item} view={byId.get(item.id)} url={urls[byId.get(item.id)?.render?.key ?? ""]}
                    drawnAsIs={drawn(item)} saved={saveState === "saved"} working={working} count={edits.items.length}
                    onChange={patch => setItem(item.id, patch)} onMove={by => move(item.id, by)}
                    onRemove={() => update({ ...edits, items: edits.items.filter(i => i.id !== item.id) })}
                    onPreview={() => preview(item)} onApprove={ok => approve(item.id, ok)} />
            ))}

            {!!edits.items.length && (
                <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
                    <h4 className="text-sm text-gray-100 font-semibold">Checkpoint E: approve each short, then schedule them</h4>
                    <ul className="text-xs text-gray-400 list-disc pl-5 flex flex-col gap-0.5">
                        <li>Watch it through with sound: it starts on a hook and ends on a complete thought, not mid-word.</li>
                        <li>The captions match what is said, names are spelled right, and nobody is cut off at the sides.</li>
                        <li>Tick &ldquo;AI imagery&rdquo; if a b-roll still shows; YouTube requires the label.</li>
                    </ul>
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="text-xs text-gray-400 flex items-center gap-2">
                            First one goes out
                            <input type="datetime-local" value={firstAt} onChange={e => setFirstAt(e.target.value)}
                                className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200" />
                        </label>
                        <button onClick={() => start("upload")} disabled={working || starting || !waiting.length || !Number.isFinite(firstMs)} className={primary}>
                            {working && view?.job === "upload" ? WORKING.upload : `Schedule ${waiting.length || ""} on YouTube`.replace("  ", " ")}
                        </button>
                    </div>
                    {!!waiting.length && Number.isFinite(firstMs) && (
                        <ul className="text-xs text-gray-400 flex flex-col gap-0.5">
                            {waiting.map((i, k) => <li key={i.id}>{when(publishSlot(firstMs, k))}: <span className="text-gray-200">{i.title || i.headline}</span></li>)}
                        </ul>
                    )}
                    <p className="text-xs text-gray-400">
                        One a day, in the order above, each Private until its time. {view?.lastSlot && view.lastSlot > Date.now() ? `Shorts are already scheduled until ${when(view.lastSlot)}, so this batch follows on. ` : ""}
                        {view?.episodeUrl
                            ? "Each links to the full episode in its description; to also show it under the Short, set “Related video” in YouTube Studio."
                            : "The episode is not on YouTube yet, so each short links to the podcast playlist instead. Upload the episode first to link it directly."}
                    </p>
                </div>
            )}

            <ErrorNote message={error} />
        </div>
    );
}

function ShortCard({ n, item, view, url, drawnAsIs, saved, working, count, onChange, onMove, onRemove, onPreview, onApprove }: {
    n: number; item: ShortEdit; view: ShortItemView | undefined; url: string | undefined; drawnAsIs: boolean; saved: boolean; working: boolean; count: number;
    onChange: (patch: Partial<ShortEdit>) => void; onMove: (by: number) => void; onRemove: () => void;
    onPreview: () => void; onApprove: (approved: boolean) => void;
}) {
    const duration = item.endMs - item.startMs;
    const words = view?.words ?? [];
    const locked = !!view?.youtube;

    // Moves the nearer end of the short to the clicked word.
    function clickWord(k: number) {
        const w = words[k];
        const { startMs, endMs } = wordBounds(words, k, k);
        const toStart = w.start <= item.startMs || (w.start < item.endMs && w.start - item.startMs < item.endMs - w.start);
        if (toStart && startMs < item.endMs) onChange({ startMs });
        else if (!toStart && endMs > item.startMs) onChange({ endMs });
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 bg-black/20 border border-white/5 rounded-xl p-3">
            <div className="flex flex-col gap-1.5">
                {view?.render && url ? (
                    <video key={view.render.key} src={url} controls preload="metadata" playsInline
                        className={`w-full aspect-[9/16] rounded-lg bg-black ${drawnAsIs ? "" : "opacity-50"}`} />
                ) : (
                    <div className="w-full aspect-[9/16] rounded-lg bg-black/40 border border-dashed border-white/10 flex items-center justify-center text-xs text-gray-400 text-center p-3">
                        Not made yet
                    </div>
                )}
                {view?.render && !drawnAsIs && !locked && <p className="text-[11px] text-amber-300">Changed since it was made; make it again.</p>}
            </div>
            <div className="flex flex-col gap-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <span className="text-gray-200 font-medium">#{n + 1}</span>
                    <span>{item.speaker}</span>
                    <span>{mmss(item.startMs)}–{mmss(item.endMs)}</span>
                    <span className={duration > SHORT_TARGET_MS || duration < SHORT_MIN_MS ? "text-amber-300" : "text-gray-300"}>
                        {Math.round(duration / 1000)}s{duration > SHORT_TARGET_MS ? " (over a minute: fine, but shorter holds viewers)" : duration < SHORT_MIN_MS ? " (too short)" : ""}
                    </span>
                    <span className="grow" />
                    <button onClick={onPreview} className={secondary}>▶ Preview</button>
                    {!locked && (
                        <>
                            <button onClick={() => onMove(-1)} disabled={n === 0 || working} className={secondary} title="Earlier in the schedule">↑</button>
                            <button onClick={() => onMove(1)} disabled={n === count - 1 || working} className={secondary} title="Later in the schedule">↓</button>
                            <button onClick={onRemove} disabled={working} className={secondary}>Remove</button>
                        </>
                    )}
                </div>
                <label className="text-xs text-gray-400 flex flex-col gap-1">
                    <span>Name shown on the short</span>
                    <input value={item.speaker} maxLength={100} disabled={locked}
                        onChange={e => onChange({ speaker: e.target.value })} className={input} />
                </label>
                <label className="text-xs text-gray-400 flex flex-col gap-1">
                    <span>Headline on the short <span className="text-gray-500">(*asterisks* make words gold)</span></span>
                    <input value={item.headline} maxLength={HEADLINE_MAX_CHARS} disabled={locked}
                        onChange={e => onChange({ headline: e.target.value })} className={input} />
                </label>
                <label className="text-xs text-gray-400 flex flex-col gap-1">
                    <span>YouTube title <span className="text-gray-500">({item.title.length}/{SHORT_TITLE_MAX})</span></span>
                    <input value={item.title} maxLength={SHORT_TITLE_MAX} disabled={locked}
                        onChange={e => onChange({ title: e.target.value.replace(/[<>]/g, "") })} className={input} />
                </label>
                <label className="text-xs text-gray-400 flex items-center gap-2">
                    <input type="checkbox" checked={item.synthetic} disabled={locked} onChange={e => onChange({ synthetic: e.target.checked })} />
                    Shows AI imagery (YouTube&rsquo;s &ldquo;altered or synthetic content&rdquo;)
                </label>
                {!locked && !!words.length && (
                    <div className="text-sm leading-relaxed max-h-44 overflow-y-auto bg-black/30 border border-white/5 rounded-lg p-2">
                        {words.map((w, k) => {
                            const inside = w.start >= item.startMs - 50 && w.start < item.endMs;
                            return (
                                <span key={k}>
                                    <button onClick={() => clickWord(k)} disabled={working}
                                        className={`rounded px-0.5 hover:bg-amber-500/30 ${inside ? "text-gray-100 bg-amber-500/10" : "text-gray-600"}`}>
                                        {w.text}
                                    </button>{" "}
                                </span>
                            );
                        })}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                    {view?.youtube ? (
                        <p className="text-emerald-300">
                            Scheduled for {when(view.youtube.publishAt)} · <a href={view.youtube.url} target="_blank" rel="noreferrer" className="text-amber-300 hover:underline">On YouTube ↗</a>
                        </p>
                    ) : view?.approved && drawnAsIs ? (
                        <>
                            <p className="text-emerald-300">Approved by {view.approved.by}, {ago(view.approved.at)}</p>
                            <button onClick={() => onApprove(false)} disabled={working} className={secondary}>Withdraw approval</button>
                        </>
                    ) : drawnAsIs ? (
                        <button onClick={() => onApprove(true)} disabled={working || !saved || !item.title.trim()} className={approveButton}>
                            {item.title.trim() ? "Approve this short" : "Add a title to approve"}
                        </button>
                    ) : null}
                    {view && !view.youtube && <ErrorNote message={view.error} />}
                </div>
            </div>
        </div>
    );
}
