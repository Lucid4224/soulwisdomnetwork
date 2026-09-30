"use client";

// Thumbnails and Checkpoint D on the show notes page (docs/specs/011-thumbnails.md). The job
// makes the raw material (texts, frames, an AI background); this panel draws the three options
// from it as the producer edits, and approving uploads the chosen one exactly as drawn.

import { useCallback, useEffect, useRef, useState } from "react";
import { ago } from "@/components/studio/format";
import { canvasJpeg, drawThumbnail, type ThumbImages } from "@/components/studio/thumbnailCanvas";
import { BROLL_STYLE_IDS, BROLL_STYLES, type BrollStyle } from "@/lib/broll";
import { auth } from "@/lib/firebase/config";
import { mmss } from "@/lib/showNotes";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";
import { failure, useStep, type ReportStep } from "@/components/studio/steps";
import { approveButton, chosen, primary, secondary } from "@/components/studio/ui";
import { THUMB_HEIGHT, THUMB_KINDS, THUMB_LABELS, THUMB_MAX_BYTES, THUMB_WIDTH, type ThumbKind } from "@/lib/thumbnail";
import type { ThumbnailsView } from "@/types/studio";


// An image from the Studio API (it needs the sign-in token, so not a plain <img src>).
async function fetchImage(url: string) {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
    if (!res.ok) throw new Error(`Could not load an image (${res.status})`);
    const blob = await res.blob();
    return { bitmap: await createImageBitmap(blob), src: URL.createObjectURL(blob) };
}

type Loaded = { bitmap: ImageBitmap; src: string };

export function Thumbnails({ episodeId, enabled, report, revision }: { episodeId: string; enabled: boolean; report?: ReportStep; revision?: number }) {
    const [view, setView] = useState<ThumbnailsView | null>(null);
    const [error, setError] = useState("");
    const [starting, setStarting] = useState(false);
    const [approving, setApproving] = useState(false);
    // The producer's picks, drawn at once and saved shortly after.
    const [text, setText] = useState("");
    const [frame, setFrame] = useState(0);
    const [choice, setChoice] = useState<ThumbKind | null>(null);
    const [idea, setIdea] = useState("");
    const [style, setStyle] = useState<BrollStyle>("digital");
    const [images, setImages] = useState<Record<string, Loaded>>({});
    const [logo, setLogo] = useState<ImageBitmap | null>(null);
    const [family, setFamily] = useState("");
    const canvases = useRef<Partial<Record<ThumbKind, HTMLCanvasElement | null>>>({});
    const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const base = `/api/studio/episodes/${episodeId}/thumbnails`;

    const load = useCallback(async (resetPicks = false) => {
        try {
            const next = await studioFetch<ThumbnailsView>(base);
            setView(next);
            setError("");
            if (resetPicks) {
                setText(next.text);
                setFrame(next.frame);
                setChoice(next.choice);
                if (next.image) {
                    setIdea(next.image.idea);
                    setStyle(next.image.style);
                }
            }
        } catch (e) {
            setError((e as Error).message);
        }
    }, [base]);

    useEffect(() => {
        if (enabled) load(true);
    }, [enabled, load]);

    const working = view?.status === "queued" || view?.status === "working";
    useStep({
        step: "thumbnail", failed: view?.status === "failed", done: !!view?.approval && !view.approval.stale, working,
        summary: working ? "Making thumbnail options…" : view?.status === "failed" ? failure("Making thumbnails", view.error)
            : view?.approval ? (view.approval.stale ? "Changed since approval: approve again" : `Episode approved ${ago(view.approval.at)}`)
                : view?.frames.length ? "Options ready: pick one and approve" : view?.canStart ? "No thumbnail options yet" : "Waiting for the final cut",
        key: view ? `${view.status}:${view.finishedAt}:${view.approval?.at}:${view.approval?.stale}` : null,
        report, revision, enabled, load,
    });
    // When a run finishes, take the new texts and frames.
    const wasWorking = useRef(false);
    useEffect(() => {
        if (!working) {
            if (wasWorking.current) load(true);
            wasWorking.current = false;
            return;
        }
        wasWorking.current = true;
        const timer = setInterval(() => load(), 10000);
        return () => clearInterval(timer);
    }, [working, load]);

    // The heading font and the logo, once.
    useEffect(() => {
        let cancelled = false;
        const outfit = getComputedStyle(document.body).getPropertyValue("--font-outfit").trim() || "sans-serif";
        document.fonts.load(`900 100px ${outfit}`).catch(() => []).then(() => { if (!cancelled) setFamily(outfit); });
        fetch("/logo.png").then(r => r.blob()).then(b => createImageBitmap(b)).then(b => { if (!cancelled) setLogo(b); }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Frames, the AI background and the approved thumbnail, each fetched once per version.
    useEffect(() => {
        if (!view) return;
        const wanted = [
            ...view.frames.map((f, i) => ({ name: `frame-${i}`, key: f.key })),
            ...(view.image ? [{ name: "ai", key: view.image.key }] : []),
            ...(view.approval ? [{ name: "approved", key: view.approval.key }] : []),
        ].filter(w => !images[`${w.name}:${w.key}`]);
        if (!wanted.length) return;
        let cancelled = false;
        Promise.all(wanted.map(async w => [`${w.name}:${w.key}`, await fetchImage(`${base}/image?name=${w.name}&v=${encodeURIComponent(w.key)}`)] as const))
            .then(loaded => { if (!cancelled) setImages(prev => ({ ...prev, ...Object.fromEntries(loaded) })); })
            .catch(e => { if (!cancelled) setError((e as Error).message); });
        return () => { cancelled = true; };
    }, [view, images, base]);

    const imageFor = (name: string, key: string | undefined) => (key ? images[`${name}:${key}`] : undefined);
    const frameImage = imageFor(`frame-${frame}`, view?.frames[frame]?.key);
    const aiImage = imageFor("ai", view?.image?.key);

    // Redraw the three options whenever anything they show changes.
    useEffect(() => {
        if (!family) return;
        const set: ThumbImages = { frame: frameImage?.bitmap ?? null, ai: aiImage?.bitmap ?? null, logo };
        for (const kind of THUMB_KINDS) {
            const ctx = canvases.current[kind]?.getContext("2d");
            if (ctx) drawThumbnail(ctx, kind, text, set, family);
        }
    }, [family, text, frameImage, aiImage, logo, view?.frames.length]);

    const save = useCallback(async (picks: { text?: string; frame?: number; choice?: ThumbKind | null }) => {
        try {
            await studioFetch(base, { method: "PATCH", body: JSON.stringify(picks) });
        } catch (e) {
            setError((e as Error).message);
        }
    }, [base]);

    function editText(value: string) {
        setText(value);
        if (textTimer.current) clearTimeout(textTimer.current);
        textTimer.current = setTimeout(() => save({ text: value }), 800);
    }

    async function start(onlyImage: boolean) {
        setStarting(true);
        try {
            await studioFetch(base, { method: "POST", body: JSON.stringify(onlyImage ? { only: "image", idea, style } : {}) });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }

    async function approve() {
        const canvas = choice && canvases.current[choice];
        if (!choice || !canvas) return;
        setApproving(true);
        try {
            if (textTimer.current) clearTimeout(textTimer.current);
            const image = await canvasJpeg(canvas, THUMB_MAX_BYTES);
            await studioFetch(`/api/studio/episodes/${episodeId}/approval`, {
                method: "POST", body: JSON.stringify({ kind: choice, text, image }),
            });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setApproving(false);
        }
    }

    async function withdraw() {
        if (!confirm("Withdraw the approval? The episode will not be published until it is approved again.")) return;
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/approval`, { method: "DELETE" });
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    }

    const ready = !!view?.frames.length;
    const approval = view?.approval;
    const approvedImage = imageFor("approved", approval?.key);
    const blockers = view?.blockers ?? [];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => start(false)} disabled={!view?.canStart || working || starting} className={ready ? secondary : primary}>
                    {working && view?.only !== "image" ? "Making thumbnail options…" : ready ? "Make new options" : "Make thumbnail options"}
                </button>
                {view?.finishedAt && ready && !working && <span className="text-xs text-gray-400">Made {ago(view.finishedAt)}</span>}
            </div>
            <p className="text-xs text-gray-400">
                {working
                    ? "Claude writes short texts, frames are taken from the final cut at the strongest quotes, and an AI background is made. A few minutes; this page updates by itself and you get an email."
                    : !view?.canStart
                        ? "Get the final cut from Descript first: the frames come from it."
                        : ready
                            ? "Pick a text and a frame, then the option you like. “Make new options” replaces the texts, frames and AI image (about $0.20)."
                            : "Makes three options: a frame from the episode, an AI image and the brand template, all with a short text. About $0.20."}
            </p>
            {view?.stale && <p className="text-sm text-amber-300">These options came from an earlier final cut. Make new options to match.</p>}
            {view?.status === "failed" && <ErrorNote title="Making thumbnails failed" message={view.error} />}
            {view?.status === "ready" && <ErrorNote tone="warning" title="The AI image is missing" message={view.error} />}

            {ready && view && (
                <>
                    <div className="flex flex-col gap-2">
                        <p className="text-sm text-gray-300">Text <span className="text-xs text-gray-400">(*asterisks* make words gold)</span></p>
                        <div className="flex flex-wrap gap-2">
                            {view.hooks.map(h => (
                                <button key={h} onClick={() => { editText(h); }}
                                    className={`${h === text ? chosen : secondary} !rounded-full`}>
                                    {h.replace(/\*/g, "")}
                                </button>
                            ))}
                        </div>
                        <input value={text} onChange={e => editText(e.target.value)} maxLength={60}
                            className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white max-w-xl" />
                    </div>

                    <div className="flex flex-col gap-2">
                        <p className="text-sm text-gray-300">Frame <span className="text-xs text-gray-400">(used by the frame option and the brand template)</span></p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {view.frames.map((f, i) => {
                                const img = imageFor(`frame-${i}`, f.key);
                                return (
                                    <button key={f.key} onClick={() => { setFrame(i); save({ frame: i }); }} title={`${f.speaker}: “${f.text}”`}
                                        className={`relative rounded-lg overflow-hidden border-2 aspect-video bg-black/40 ${i === frame ? "border-amber-400" : "border-transparent hover:border-white/30"}`}>
                                        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob */}
                                        {img && <img src={img.src} alt={`Frame at ${mmss(f.atMs)}`} className="w-full h-full object-cover" />}
                                        <span className="absolute bottom-0 left-0 text-[10px] px-1.5 py-0.5 bg-black/60 text-gray-200">{mmss(f.atMs)} {f.speaker}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {THUMB_KINDS.map(kind => (
                            <button key={kind} onClick={() => { setChoice(kind); save({ choice: kind }); }}
                                className={`flex flex-col gap-1.5 text-left rounded-xl p-1.5 border-2 ${choice === kind ? "border-emerald-400 bg-emerald-500/5" : "border-white/10 hover:border-white/30"}`}>
                                <canvas ref={el => { canvases.current[kind] = el; }} width={THUMB_WIDTH} height={THUMB_HEIGHT} className="w-full rounded-lg" />
                                <span className="text-xs text-gray-300 px-1">{choice === kind ? "✓ " : ""}{THUMB_LABELS[kind]}</span>
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-gray-400">Check each one small too: most people see thumbnails at about a fifth of this size.</p>

                    <details className="text-xs text-gray-400">
                        <summary className="cursor-pointer text-gray-300">AI image: {view.image?.idea ?? "none yet"}</summary>
                        <div className="flex flex-col gap-2 mt-2">
                            <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={3} maxLength={600}
                                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                            <div className="flex flex-wrap items-center gap-3">
                                <select value={style} onChange={e => setStyle(e.target.value as BrollStyle)}
                                    className="bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-200">
                                    {BROLL_STYLE_IDS.map(s => <option key={s} value={s}>{BROLL_STYLES[s].label}</option>)}
                                </select>
                                <button onClick={() => start(true)} disabled={working || starting || !idea.trim()} className={secondary}>
                                    {working && view.only === "image" ? "Making a new AI image…" : "New AI image from this idea (about $0.17)"}
                                </button>
                            </div>
                            {view.image && <p className="text-gray-600">Prompt: {view.image.prompt}</p>}
                        </div>
                    </details>
                </>
            )}

            <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
                <h4 className="text-sm text-gray-100 font-semibold">Checkpoint D: approve the episode for YouTube</h4>
                <ul className="text-xs text-gray-400 flex flex-col gap-0.5">
                    <li>Title: <span className="text-gray-200">{view?.title ?? "—"}</span></li>
                    <li>Chapters on the final cut: <span className="text-gray-200">{view?.chapterCount ?? 0}</span></li>
                    <li>Thumbnail: <span className="text-gray-200">{choice ? THUMB_LABELS[choice] : "not picked yet"}</span></li>
                </ul>
                {blockers.map(b => <p key={b} className="text-xs text-amber-300">{b}</p>)}
                {approval && (
                    <div className="flex flex-col gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob */}
                        {approvedImage && <img src={approvedImage.src} alt="Approved thumbnail" className="w-full max-w-sm rounded-lg border border-emerald-500/40" />}
                        <p className="text-sm text-emerald-300">
                            Approved by {approval.by} {ago(approval.at)} with the {THUMB_LABELS[approval.kind].toLowerCase()}.
                        </p>
                        {approval.stale && <p className="text-sm text-amber-300">The notes or the final cut changed after this approval. Check it and approve again.</p>}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                    <button onClick={approve} disabled={!choice || blockers.length > 0 || approving || working || !family} className={approveButton}>
                        {approving ? "Approving…" : approval ? "Approve again with this thumbnail" : "Approve episode"}
                    </button>
                    {approval && <button onClick={withdraw} className={secondary}>Withdraw approval</button>}
                </div>
                <p className="text-xs text-gray-400">Approving saves the chosen thumbnail as a JPEG and clears the episode for the YouTube upload (spec 005 step 13).</p>
            </div>

            <ErrorNote message={error} />
        </div>
    );
}
