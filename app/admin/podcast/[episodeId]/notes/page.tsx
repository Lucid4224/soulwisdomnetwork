"use client";

// Checkpoint B (spec 005 step 6; docs/specs/007-show-notes.md): review and edit the show
// notes Claude drafted from the accepted transcript, then approve them. Edits save as you go.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { BrollImageView, useBroll } from "@/components/studio/broll";
import { EditPackage } from "@/components/studio/editPackage";
import { FinalCut } from "@/components/studio/finalCut";
import { ago, minutes } from "@/components/studio/format";
import { useAutosave } from "@/components/studio/useAutosave";
import { useAuth } from "@/context/AuthContext";
import { BROLL_STYLE_IDS, BROLL_STYLES, BROLL_USD_PER_IMAGE, type BrollStyle } from "@/lib/broll";
import { locate, mmss, youtubeDescription, type ShowNotes, type TeaserClip } from "@/lib/showNotes";
import { studioFetch } from "@/lib/studioClient";
import type { EpisodeNotesView } from "@/types/studio";

const button = "text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} border-amber-500/40 text-amber-300 hover:bg-amber-500/10`;
const secondary = `${button} border-white/10 text-gray-300 hover:bg-white/10`;
const field = "w-full bg-[#130b29] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-500/50";
const small = "text-xs text-gray-500";

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

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="bg-[#1E1035]/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-3">
            <header>
                <h2 className="font-semibold">{title}</h2>
                {hint && <p className={small}>{hint}</p>}
            </header>
            {children}
        </section>
    );
}

export default function ShowNotesPage() {
    const { episodeId } = useParams<{ episodeId: string }>();
    const { profile, loading } = useAuth();
    const allowed = profile?.role === "admin" || profile?.role === "producer";

    const [view, setView] = useState<EpisodeNotesView | null>(null);
    const [notes, setNotes] = useState<ShowNotes | null>(null);
    const [loadedAt, setLoadedAt] = useState(0);   // remounts free-text list fields after a reload
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
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

    const copyDescription = () => {
        if (!notes) return;
        void navigator.clipboard.writeText(youtubeDescription(notes));
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
    const upToDate = status === "approved" && approved?.version === autosave.savedVersion && autosave.saveState === "saved";
    // Images are made from the approved ideas, so only offered when the page shows exactly those.
    const brollChanged = notes ? notes.broll.filter((b, i) => {
        const image = broll.image(i);
        return image?.idea !== b.idea.trim() || image.style !== b.style;
    }).length : 0;
    const brollBlocked = !upToDate || broll.working || broll.starting;
    const saveLabel = {
        saved: "Draft saved to the database", unsaved: "Unsaved changes…", saving: "Saving draft…", error: "Draft not saved",
    }[autosave.saveState];

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-4 pb-28 sm:p-8 sm:pb-28">
                <div className="max-w-7xl mx-auto flex flex-col gap-6">
                    <div>
                        <Link href="/admin/podcast" className="text-sm text-gray-400 hover:text-white">← Podcast Studio</Link>
                        <h1 className="text-2xl font-bold text-amber-400 mt-1 break-words">
                            Show notes{view ? `: ${view.title}` : ""}
                        </h1>
                        {view && (
                            <p className="text-sm text-gray-400 mt-1">
                                {[view.recordedAt?.slice(0, 10), minutes(view.durationSeconds)].filter(Boolean).join(" · ")}
                                {view.notes?.generatedAt && ` · Drafted by Claude ${ago(view.notes.generatedAt)}`}
                                {approved && ` · Approved by ${approved.by} ${ago(approved.at)}`}
                                {" · "}
                                <Link href={`/admin/podcast/${episodeId}`} className="hover:text-white hover:underline">Speaker review</Link>
                            </p>
                        )}
                    </div>

                    {error && <p className="text-red-400 text-sm">{error}</p>}
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
                                    {status === "failed" && <p className="text-sm text-red-300">Drafting failed: {view.notes?.error}</p>}
                                    <p className="text-gray-300">No show notes yet.</p>
                                    <button onClick={() => draft(false)} disabled={busy} className={primary}>Draft show notes</button>
                                </>
                            )}
                        </div>
                    )}

                    {view && notes && (
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] items-start">
                            <div className="flex flex-col gap-4 lg:sticky lg:top-20">
                                {view.videoUrl && (
                                    <video ref={video} src={view.videoUrl} controls preload="metadata" onTimeUpdate={onTime} className="w-full rounded-xl bg-black aspect-video" />
                                )}
                                <p className={small}>
                                    Click ▶ beside a chapter, quote or b-roll idea to check it against the video.
                                    &quot;Add at video time&quot; uses where the video is paused.
                                </p>
                                {drafting && <p className="text-sm text-amber-300">Claude is drafting new notes; they will replace this page when ready.</p>}
                                {status === "failed" && view.notes?.error && <p className="text-sm text-red-300">Last redraft failed: {view.notes.error}</p>}
                                <button onClick={() => draft(true)} disabled={busy || drafting} className={`${secondary} self-start`}>
                                    Draft again with Claude
                                </button>
                            </div>

                            <div className="flex flex-col gap-4 min-w-0">
                                <Section title="Title" hint="Pick one; edit any of them.">
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
                                </Section>

                                <Section
                                    title="“In this episode” clips"
                                    hint="Played in order under an “In this episode” title. Leave them wanting more: end on a question or cut before the answer."
                                >
                                    {notes.teaserClips.length > 0 && (
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => playClips(notes.teaserClips)} className={primary}>▶ Play the teaser</button>
                                            <span className={small}>{Math.round(notes.teaserClips.reduce((t, c) => t + c.endMs - c.startMs, 0) / 1000)} seconds in total; aim for 20–40</span>
                                        </div>
                                    )}
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
                                </Section>

                                <Section title="YouTube description" hint="Hook and keywords in the first two lines: that is all YouTube shows before “more”.">
                                    <textarea value={notes.description} onChange={e => edit(n => ({ ...n, description: e.target.value }))} rows={8} className={field} />
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
                                        <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-300 bg-[#130b29] border border-white/5 rounded-lg p-3">{youtubeDescription(notes)}</pre>
                                    </details>
                                    <div className="flex items-center gap-3">
                                        <p className={small}>{words(notes.description)} words, plus the site link, chapters, subscribe line and hashtags</p>
                                        <button onClick={copyDescription} className={secondary}>Copy full description</button>
                                    </div>
                                </Section>

                                <Section title="Summary" hint="For the episode page on the website.">
                                    <textarea value={notes.summary} onChange={e => edit(n => ({ ...n, summary: e.target.value }))} rows={6} className={field} />
                                </Section>

                                <Section title="Chapters" hint="YouTube needs the first at 0:00, at least three, each 10 seconds or longer.">
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
                                </Section>

                                <Section title="Key quotes" hint={`Word for word, up to two minutes each. Raw material for shorts and social posts; delete the ones you don't want.${notes.quotes.length ? ` ${notes.quotes.length} quotes from ${new Set(notes.quotes.map(q => q.speaker)).size} speakers.` : ""}`}>
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
                                </Section>

                                <Section title="Tags, themes and topics" hint="Separate with commas.">
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
                                </Section>

                                <Section title="B-roll" hint="Still images with a slow pan and zoom (spec 005, option A), made by AI from the approved ideas. They go to Descript with the episode.">
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
                                                    title={upToDate ? "Make a new image for this idea" : "Approve the show notes first"}
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
                                                    ? "Approve the show notes first; images are made from the approved ideas."
                                                    : brollChanged
                                                        ? `About $${(brollChanged * BROLL_USD_PER_IMAGE).toFixed(2)} with OpenAI's image model. Ideas that already have an image are left alone.`
                                                        : ""}
                                        </span>
                                    </div>
                                    {(broll.error || broll.view?.error) && (
                                        <p className="text-sm text-red-300">{broll.error || broll.view?.error}</p>
                                    )}
                                </Section>

                                <Section title="Edit package and Descript" hint="Built from the approved notes. Descript has the final say: the edit happens there.">
                                    <EditPackage episodeId={episodeId} enabled={!loading && allowed} upToDate={upToDate} />
                                </Section>

                                <Section title="Final cut" hint="The finished edit, published from Descript, set to broadcast loudness and saved to Drive, with the chapter times moved onto it.">
                                    <FinalCut episodeId={episodeId} enabled={!loading && allowed} />
                                </Section>
                            </div>
                        </div>
                    )}
                </div>

                {view && notes && (
                    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-[#130b29]/95 backdrop-blur">
                        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className={`text-sm ${autosave.saveState === "error" ? "text-red-300" : autosave.saveState === "saved" ? "text-green-300" : "text-gray-400"}`}>
                                {autosave.saveState === "saved" ? "✓ " : ""}{saveLabel}
                            </span>
                            {autosave.saveState === "error" && (
                                <>
                                    <span className="text-sm text-red-300">{autosave.saveError}</span>
                                    <button onClick={() => { void flush(); }} className={secondary}>Try again</button>
                                </>
                            )}
                            {notice ? (
                                <span className={`text-sm ${notice.startsWith("⚠️") ? "text-red-300" : "text-green-300"}`}>{notice}</span>
                            ) : autosave.saveState !== "error" && (
                                <span className="text-xs text-gray-500">
                                    {upToDate
                                        ? `Approved by ${approved!.by}. These are the show notes the next steps will use.`
                                        : approved
                                            ? "Approve the changes to make them the show notes the next steps will use."
                                            : "Approve when the notes are right; they become the show notes the next steps will use."}
                                </span>
                            )}
                            <button
                                onClick={approve}
                                disabled={busy || drafting || upToDate}
                                className={`${primary} ml-auto !text-sm !px-4 !py-2`}
                            >
                                {busy ? "Working…" : upToDate ? "✓ Approved" : approved ? "Approve changes" : "Approve show notes"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </AuthGuard>
    );
}
