"use client";

// Why: Part I on the show notes page. Choose languages and Claude translates the final cut's
// captions, title and description; each language can be downloaded as captions (SRT) and goes to
// YouTube as its own caption track with the next YouTube upload.

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/components/studio/format";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { hint as small, primary, secondary } from "@/components/studio/ui";
import { studioFetch } from "@/lib/studioClient";
import { LANGUAGES, LANGUAGES_MAX } from "@/lib/translate";
import type { TranslationsView } from "@/types/studio";

export function Translations({ episodeId }: { episodeId: string }) {
    const [view, setView] = useState<TranslationsView | null>(null);
    const [chosen, setChosen] = useState<string[] | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        studioFetch<TranslationsView>(`/api/studio/episodes/${episodeId}/translations`)
            .then(v => { setView(v); setChosen(c => c ?? v.languages); })
            .catch(e => setError((e as Error).message));
    }, [episodeId]);
    useEffect(() => { load(); }, [load]);

    const working = view?.status === "queued" || view?.status === "working";
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(load, 15_000);
        return () => clearInterval(timer);
    }, [working, load]);

    // Starts translating into the chosen languages.
    const translate = async () => {
        setBusy(true);
        setError("");
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/translations`, { method: "POST", body: JSON.stringify({ languages: chosen }) });
            load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (!view || !chosen) return <p className={small}>Loading…</p>;
    const toggle = (code: string) => setChosen(c => (c!.includes(code) ? c!.filter(x => x !== code) : c!.length < LANGUAGES_MAX ? [...c!, code] : c!));

    return (
        <div className="flex flex-col gap-3">
            {error && <ErrorNote message={error} />}
            {view.status === "failed" && <ErrorNote title="Translating failed" message={view.error} />}
            <fieldset className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-sm text-gray-200" disabled={working}>
                <legend className={`${small} mb-1`}>Languages (up to {LANGUAGES_MAX}; the Studio settings choose the usual ones)</legend>
                {LANGUAGES.map(l => (
                    <label key={l.code} className="flex items-center gap-2">
                        <input type="checkbox" checked={chosen.includes(l.code)} onChange={() => toggle(l.code)} />
                        {l.name}
                    </label>
                ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => void translate()} disabled={busy || working || !!view.canStart || !chosen.length}
                    className={view.tracks.length ? secondary : primary}>
                    {working ? "Claude is translating…" : view.tracks.length ? "Translate again" : "Translate the captions"}
                </button>
                <span className={small}>
                    {view.canStart ?? (working
                        ? "A few minutes per language. This updates by itself."
                        : `About $0.40 a language, on the Anthropic key${view.generatedAt ? ` · last made ${ago(view.generatedAt)}` : ""}.`)}
                </span>
            </div>
            {view.tracks.length > 0 && (
                <div className="flex flex-col gap-1">
                    {view.stale && <p className="text-sm text-amber-300">The final cut changed since these were made; translate again so they match.</p>}
                    <ul className="flex flex-col gap-1 text-sm text-gray-200">
                        {view.tracks.map(t => (
                            <li key={t.code} className="flex flex-wrap items-center gap-3">
                                <span className="w-44">{t.name}</span>
                                {t.url && <a href={t.url} download={`${t.code}.srt`} className="text-amber-300 underline">Download captions (.srt)</a>}
                                <span className={small}>
                                    {t.withTitle ? "with the title and description" : "captions only"}
                                    {t.missing > 0 && ` · ${t.missing} caption${t.missing === 1 ? "" : "s"} left in English`}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className={small}>
                        {view.onYoutube
                            ? "The episode is already on YouTube: press “Update on YouTube” above to add these to the same video."
                            : "These go to YouTube with the episode, each as its own caption track, with the title and description in each language."}
                    </p>
                </div>
            )}
        </div>
    );
}
