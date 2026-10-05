"use client";

// Why: the social posts, follow-up email and transcript downloads on the show notes page —
// the extras Claude writes from the approved notes, and the accepted transcript as Word,
// plain text and captions, each made in the browser.

import { useCallback, useEffect, useState } from "react";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { field, hint as small, primary, secondary } from "@/components/studio/ui";
import { studioFetch } from "@/lib/studioClient";
import { EXTRAS_DIRECTION_MAX, mailtoLink, X_MAX } from "@/lib/extras";
import { downloadName, transcriptDocx, transcriptSrt, transcriptText } from "@/lib/transcriptExport";
import type { SpokenWord } from "@/lib/showNotes";
import type { ExtrasView } from "@/types/studio";
import { ago } from "@/components/studio/format";

// Copies text to the clipboard and shows "Copied" for two seconds.
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className={secondary}
        >
            {copied ? "Copied" : label}
        </button>
    );
}

// A titled piece of text with a copy button and a read-only textarea.
function Piece({ title, text, note }: { title: string; text: string; note?: string }) {
    const rows = Math.min(12, Math.max(3, text.split("\n").length));
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-200">{title}</span>
                {note && <span className={small}>{note}</span>}
                <CopyButton text={text} />
            </div>
            <textarea value={text} readOnly rows={rows} aria-label={title} className={field} />
        </div>
    );
}

// The social posts and follow-up email, written by Claude from the approved notes.
export function WritingExtras({ episodeId, meeting }: { episodeId: string; meeting: boolean }) {
    const [view, setView] = useState<ExtrasView | null>(null);
    const [direction, setDirection] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [loadedDirection, setLoadedDirection] = useState(false);

    const load = useCallback(() => {
        studioFetch<ExtrasView>(`/api/studio/episodes/${episodeId}/extras`)
            .then(setView)
            .catch(e => setError((e as Error).message));
    }, [episodeId]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (view && !loadedDirection) {
            setDirection(view.direction);
            setLoadedDirection(true);
        }
    }, [view, loadedDirection]);

    const working = view?.status === "queued" || view?.status === "working";
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(load, 10_000);
        return () => clearInterval(timer);
    }, [working, load]);

    const write = async () => {
        setBusy(true);
        setError("");
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/extras`, {
                method: "POST",
                body: JSON.stringify({ direction }),
            });
            load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (!view) return <p className={small}>Loading…</p>;

    const result = view.result;
    const hasResult = !!result && view.status === "ready";

    return (
        <div className="flex flex-col gap-3">
            {error && <ErrorNote message={error} />}
            {view.status === "failed" && <ErrorNote title="Writing failed" message={view.error} />}
            <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400" htmlFor="extras-direction">Direction for the posts</label>
                <textarea
                    id="extras-direction"
                    value={direction}
                    onChange={e => setDirection(e.target.value)}
                    maxLength={EXTRAS_DIRECTION_MAX}
                    rows={2}
                    aria-label="Direction for the posts"
                    placeholder="Optional: e.g. a more personal tone, or mention the next meeting on Friday"
                    disabled={working}
                    className={field}
                />
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => void write()} disabled={busy || working} className={hasResult ? secondary : primary}>
                    {working ? "Claude is writing…" : hasResult ? "Write them again" : "Write social posts"}
                </button>
                <span className={small}>
                    {working
                        ? "About a minute. This updates by itself."
                        : view.generatedAt ? `Written ${ago(view.generatedAt)}` : ""}
                </span>
            </div>
            {hasResult && result && (
                <div className="flex flex-col gap-3">
                    <Piece title="LinkedIn" text={result.linkedin} />
                    <Piece title="Instagram" text={result.instagram} />
                    <Piece title="X" text={result.x} note={`${result.x.length}/${X_MAX}`} />
                    {meeting && (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-200">Follow-up email</span>
                                <CopyButton text={`Subject: ${result.followupSubject}\n\n${result.followupBody}`} label="Copy email" />
                                <a
                                    href={mailtoLink(result.followupSubject, result.followupBody)}
                                    className={`${secondary} no-underline`}
                                >
                                    Open in email
                                </a>
                            </div>
                            <input value={result.followupSubject} readOnly aria-label="Email subject" className={field} />
                            <textarea value={result.followupBody} readOnly rows={12} aria-label="Email body" className={field} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// The accepted transcript as Word, plain text and captions, each downloaded in the browser.
export function TranscriptDownloads({ title, words }: { title: string; words: SpokenWord[] }) {
    const save = (name: string, data: Blob) => {
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    if (!words.length) {
        return <p className={small}>The transcript is not available yet.</p>;
    }

    return (
        <div className="flex flex-wrap gap-2">
            <button
                onClick={() => save(downloadName(title, "docx"), new Blob([new Uint8Array(transcriptDocx(title, words))], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))}
                className={secondary}
            >
                Word (.docx)
            </button>
            <button
                onClick={() => save(downloadName(title, "txt"), new Blob([transcriptText(title, words)], { type: "text/plain" }))}
                className={secondary}
            >
                Plain text (.txt)
            </button>
            <button
                onClick={() => save(downloadName(title, "srt"), new Blob([transcriptSrt(words)], { type: "application/x-subrip" }))}
                className={secondary}
            >
                Captions (.srt)
            </button>
        </div>
    );
}
