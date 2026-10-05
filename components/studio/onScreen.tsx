"use client";

// Why: Part I in the full-page editor. The "On screen" panel adds and edits what the render burns
// onto the picture (captions in a chosen look, text such as name titles, and images such as a
// logo), and the preview layer shows them over the video while it plays, as Descript does.
// The caption look fields are shared with the Settings page.

import { useMemo, useState } from "react";
import { buildCues } from "@/lib/captions";
import {
    BACKGROUNDS, CAPTION_POSITIONS, captionLook, DEFAULT_CAPTION_STYLE, FONTS, nameTitles, newText, POSITION_LABELS, POSITIONS,
    SIZE_NAMES, TEXT_SIZES, type Background, type CaptionChoice, type CaptionStyle, type FontName, type ImageOverlay,
    type Overlay, type Position, type TextOverlay, type TextSize,
} from "@/lib/onScreen";
import type { EpisodeEdit } from "@/lib/edit";
import type { SpokenWord } from "@/lib/showNotes";
import { field, hint, secondary } from "@/components/studio/ui";
import { uploadFile } from "@/components/studio/upload";

// Pictures uploaded in this visit, shown from the browser until the page loads its own links.
const localUrls = new Map<string, string>();

const SIZE_LABELS: Record<TextSize, string> = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };
const BACKGROUND_LABELS: Record<Background, string> = { outline: "Outline", box: "Dark band", shadow: "Shadow only" };
const CAPTION_POSITION_LABELS: Record<typeof CAPTION_POSITIONS[number], string> = { bottom: "Bottom", middle: "Middle", top: "Top" };

// Format mm:ss from ms.
function mmss(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The font, size, colour and background controls, for captions and for a text overlay.
export function LookFields({ look, onChange, positions = "caption" }: {
    look: Pick<CaptionStyle, "font" | "size" | "color" | "background"> & { position: string };
    onChange: (change: Partial<{ font: FontName; size: TextSize; color: string; background: Background; position: string }>) => void;
    positions?: "caption" | "all";
}) {
    const small = `${field} !w-auto !py-1 !px-2 text-xs`;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Font" value={look.font} onChange={e => onChange({ font: e.target.value as FontName })} className={small}>
                {FONTS.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>
            <select aria-label="Size" value={look.size} onChange={e => onChange({ size: e.target.value as TextSize })} className={small}>
                {SIZE_NAMES.map(s => <option key={s} value={s}>{SIZE_LABELS[s]}</option>)}
            </select>
            <input type="color" aria-label="Colour" value={look.color} onChange={e => onChange({ color: e.target.value })}
                className="h-7 w-10 rounded border border-white/10 bg-transparent" />
            <select aria-label="Background" value={look.background} onChange={e => onChange({ background: e.target.value as Background })} className={small}>
                {BACKGROUNDS.map(b => <option key={b} value={b}>{BACKGROUND_LABELS[b]}</option>)}
            </select>
            <select aria-label="Position" value={look.position} onChange={e => onChange({ position: e.target.value })} className={small}>
                {positions === "caption"
                    ? CAPTION_POSITIONS.map(p => <option key={p} value={p}>{CAPTION_POSITION_LABELS[p]}</option>)
                    : POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
            </select>
        </div>
    );
}

// CSS for text in a look, sized against the video's width (1920 render pixels = 100cqw).
function textStyle(look: { font: FontName; size: TextSize; color: string; background: Background }): React.CSSProperties {
    const font = FONTS.find(f => f.name === look.font) ?? FONTS[0];
    const px = (v: number) => `${(v / 19.2).toFixed(3)}cqw`;
    const style: React.CSSProperties = {
        fontFamily: font.css, fontSize: px(TEXT_SIZES[look.size]), color: look.color, lineHeight: 1.15,
        fontWeight: look.font === "Outfit Black" ? 900 : look.font === "Outfit SemiBold" ? 600 : font.bold ? 700 : 400,
    };
    if (look.background === "box") return { ...style, backgroundColor: "rgba(0,0,0,0.69)", padding: `0 ${px(TEXT_SIZES[look.size] * 0.15)}` };
    if (look.background === "outline") {
        const o = px(Math.max(2, TEXT_SIZES[look.size] * 0.07));
        return { ...style, textShadow: `-${o} -${o} 0 #000, ${o} -${o} 0 #000, -${o} ${o} 0 #000, ${o} ${o} 0 #000` };
    }
    return { ...style, textShadow: `${px(4)} ${px(4)} ${px(4)} rgba(0,0,0,0.6)` };
}

// Where a box sits on the video for a position, with the render's margins.
function placeStyle(position: Position | typeof CAPTION_POSITIONS[number], marginV: number, marginH = 90): React.CSSProperties {
    const px = (v: number) => `${(v / 19.2).toFixed(3)}cqw`;
    const s: React.CSSProperties = { position: "absolute" };
    const tx = position.endsWith("left") ? (s.left = px(marginH), "0") : position.endsWith("right") ? (s.right = px(marginH), "0") : (s.left = "50%", "-50%");
    const ty = position.startsWith("top") ? (s.top = px(marginV), "0") : position.startsWith("bottom") ? (s.bottom = px(marginV), "0") : (s.top = "50%", "-50%");
    s.transform = `translate(${tx}, ${ty})`;
    s.textAlign = position.endsWith("left") ? "left" : position.endsWith("right") ? "right" : "center";
    return s;
}

// Over the video: the caption being spoken, and the text and images up at this moment of the recording.
export function OnScreenPreview({ words, edit, currentMs, studio, overlayUrls }: {
    words: SpokenWord[]; edit: EpisodeEdit; currentMs: number; studio: CaptionChoice; overlayUrls: Record<string, string>;
}) {
    const cues = useMemo(() => buildCues(words), [words]);
    const look = captionLook(edit, { burnCaptions: studio.on, captionStyle: studio.style });
    const cue = look ? cues.find(c => currentMs >= c.startMs && currentMs < c.endMs) : undefined;
    const up = (edit.overlays ?? []).filter(o => currentMs >= o.atMs && currentMs < o.atMs + o.seconds * 1000);
    if (!cue && !up.length) return null;
    return (
        <div aria-label="On-screen preview" className="pointer-events-none absolute inset-0 overflow-hidden">
            {up.filter((o): o is ImageOverlay => o.type === "image").map(o => {
                const url = overlayUrls[o.path] ?? localUrls.get(o.path);
                if (!url) return null;
                // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL or a local blob
                return <img key={o.id} src={url} alt="" style={{ ...placeStyle(o.position, o.widthPct >= 100 ? 0 : 60, o.widthPct >= 100 ? 0 : 60), width: `${o.widthPct}%` }} />;
            })}
            {up.filter((o): o is TextOverlay => o.type === "text").map(o => (
                <div key={o.id} style={{ ...placeStyle(o.position, 80), ...textStyle(o) }}>
                    {o.text}
                    {o.subtext && <div style={{ fontSize: "0.6em" }}>{o.subtext}</div>}
                </div>
            ))}
            {cue && look && (
                <div style={{ ...placeStyle(look.position, 70), ...textStyle(look), whiteSpace: "nowrap" }}>
                    {cue.lines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
            )}
        </div>
    );
}

// The "On screen" panel under the timeline: captions for this video, then every text and image, in time order.
export function OnScreenPanel({ words, edit, currentMs, studio, onOverlays, onCaptions, onSeek }: {
    words: SpokenWord[]; edit: EpisodeEdit; currentMs: number; studio: CaptionChoice;
    onOverlays: (overlays: Overlay[]) => void; onCaptions: (captions: CaptionChoice | null) => void; onSeek: (ms: number) => void;
}) {
    const overlays = useMemo(() => edit.overlays ?? [], [edit.overlays]);
    const sorted = useMemo(() => [...overlays].sort((a, b) => a.atMs - b.atMs), [overlays]);
    const [share, setShare] = useState<number | null>(null);
    const [error, setError] = useState("");
    const studioLook = studio.style ?? DEFAULT_CAPTION_STYLE;
    const mode = edit.captions ? (edit.captions.on ? "own" : "off") : "studio";
    const newId = () => `o${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

    // Changes one overlay by its id.
    const change = (id: string, part: Partial<TextOverlay> | Partial<ImageOverlay>) =>
        onOverlays(overlays.map(o => (o.id === id ? { ...o, ...part } as Overlay : o)));

    // Uploads a picture and adds it at the playhead, top right, a fifth of the width, for the whole of five seconds.
    async function addImage(file: File | undefined) {
        if (!file) return;
        setError("");
        setShare(0);
        try {
            const { path } = await uploadFile("overlay", file, setShare);
            localUrls.set(path, URL.createObjectURL(file));
            const image: ImageOverlay = {
                id: newId(), type: "image", atMs: Math.round(currentMs), seconds: 5, path, name: file.name.slice(0, 150),
                position: "top-right", widthPct: 20,
            };
            onOverlays([...overlays, image]);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setShare(null);
        }
    }

    return (
        <section aria-label="On screen" className="rounded-lg bg-[#130b29] border border-white/5 p-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-200">On screen</span>
                <span className={hint}>Burned into the render. Times follow the recording; the render moves them with your cuts.</span>
            </div>

            {/* Captions on this video: the Studio's choice, a look of its own, or none. */}
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-200">
                    <span className="font-medium">Captions</span>
                    {([
                        ["studio", `Studio setting (${studio.on ? "on" : "off"})`],
                        ["own", "On, with this look"],
                        ["off", "Off for this video"],
                    ] as const).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-1">
                            <input type="radio" name="captions" checked={mode === value}
                                onChange={() => onCaptions(value === "studio" ? null : { on: value === "own", style: edit.captions?.style ?? studioLook })} />
                            {label}
                        </label>
                    ))}
                </div>
                {mode === "own" && edit.captions && (
                    <LookFields look={edit.captions.style}
                        onChange={c => onCaptions({ on: true, style: { ...edit.captions!.style, ...c } as CaptionStyle })} />
                )}
            </div>

            {/* Adding: text at the playhead, a name title for each speaker, an image at the playhead. */}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={secondary} onClick={() => onOverlays([...overlays, newText(newId(), currentMs, studioLook)])}>
                    + Text at {mmss(currentMs)}
                </button>
                <button type="button" className={secondary} disabled={!words.length}
                    onClick={() => onOverlays([...overlays, ...nameTitles(words, overlays, studioLook)])}>
                    + Name titles for each speaker
                </button>
                <label className={`${secondary} cursor-pointer`}>
                    {share !== null ? `Uploading… ${Math.round(share * 100)}%` : `+ Image at ${mmss(currentMs)} (PNG or JPEG)`}
                    <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={share !== null}
                        onChange={e => { void addImage(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {error && <span className="text-sm text-red-300">{error}</span>}
            </div>

            {sorted.length === 0 && <p className={hint}>Nothing yet. Name titles show each speaker&apos;s name the first time they speak.</p>}
            <ul className="flex flex-col gap-2">
                {sorted.map(o => (
                    <li key={o.id} aria-label={o.type === "text" ? `Text: ${o.text}` : `Image: ${o.name}`}
                        className="rounded-lg border border-white/10 bg-white/[0.02] p-2 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                            <span className={`px-1.5 py-0.5 rounded ${o.type === "text" ? "bg-violet-500/20 text-violet-200" : "bg-sky-500/20 text-sky-200"}`}>
                                {o.type === "text" ? "Text" : "Image"}
                            </span>
                            <button type="button" className={`${secondary} px-2 py-0.5`} onClick={() => onSeek(o.atMs)} title="Jump there">
                                {mmss(o.atMs)}
                            </button>
                            <button type="button" className={`${secondary} px-2 py-0.5`} onClick={() => change(o.id, { atMs: Math.round(currentMs) })}>
                                Start at {mmss(currentMs)}
                            </button>
                            <label className="flex items-center gap-1">
                                for
                                <input type="number" min={0.5} max={86400} step={0.5} value={o.seconds} aria-label="Seconds on screen"
                                    onChange={e => change(o.id, { seconds: Math.max(0.5, Number(e.target.value) || 0.5) })}
                                    className={`${field} !w-20 !py-1 !px-2 text-xs`} />
                                s
                            </label>
                            <span className="grow" />
                            <button type="button" className={`${secondary} px-2 py-0.5`} onClick={() => onOverlays(overlays.filter(x => x.id !== o.id))}>
                                Remove
                            </button>
                        </div>
                        {o.type === "text" ? (
                            <>
                                <div className="flex flex-wrap gap-2">
                                    <input value={o.text} maxLength={200} aria-label="Text" onChange={e => change(o.id, { text: e.target.value })}
                                        className={`${field} !w-auto grow`} placeholder="Text" />
                                    <input value={o.subtext} maxLength={200} aria-label="Second line" onChange={e => change(o.id, { subtext: e.target.value })}
                                        className={`${field} !w-auto grow`} placeholder="Smaller second line (optional), such as a role" />
                                </div>
                                <LookFields look={o} positions="all" onChange={c => change(o.id, c as Partial<TextOverlay>)} />
                            </>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                                <span className="truncate max-w-[16rem]">{o.name || "Image"}</span>
                                <select aria-label="Position" value={o.position} onChange={e => change(o.id, { position: e.target.value as Position })}
                                    className={`${field} !w-auto !py-1 !px-2 text-xs`}>
                                    {POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
                                </select>
                                <label className="flex items-center gap-1">
                                    Width
                                    <input type="range" min={5} max={100} value={o.widthPct} aria-label="Width"
                                        onChange={e => change(o.id, { widthPct: Number(e.target.value) })} />
                                    {o.widthPct}%
                                </label>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
