"use client";

// B-roll images on the show notes page (docs/specs/008-broll-images.md): loads what has been
// generated, starts the Podcast B-roll run, and checks back while it works.

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/components/studio/format";
import { BROLL_STYLES, type BrollStyle } from "@/lib/broll";
import { studioFetch } from "@/lib/studioClient";
import type { BrollView } from "@/types/studio";

export function useBroll(episodeId: string, enabled: boolean) {
    const [view, setView] = useState<BrollView | null>(null);
    const [error, setError] = useState("");
    const [starting, setStarting] = useState(false);

    const load = useCallback(async () => {
        try {
            setView(await studioFetch<BrollView>(`/api/studio/episodes/${episodeId}/broll`));
            setError("");
        } catch (e) {
            setError((e as Error).message);
        }
    }, [episodeId]);

    useEffect(() => {
        if (enabled) load();
    }, [enabled, load]);

    const working = view?.status === "queued" || view?.status === "generating";
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(load, 8000);
        return () => clearInterval(timer);
    }, [working, load]);

    const generate = useCallback(async (index: number | null) => {
        setStarting(true);
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/broll`, { method: "POST", body: JSON.stringify({ index }) });
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setStarting(false);
        }
    }, [episodeId, load]);

    const image = (index: number) => view?.images.find(i => i.index === index);
    return { view, error, working, starting, generate, image };
}

export type Broll = ReturnType<typeof useBroll>;

// The generated image for one idea, or where it stands.
export function BrollImageView({ broll, index, idea, style }: { broll: Broll; index: number; idea: string; style: BrollStyle }) {
    const image = broll.image(index);
    const pending = broll.working && (broll.view?.only === null || broll.view?.only === index);
    if (!image) {
        return pending ? <p className="text-xs text-sky-300">Generating…</p> : null;
    }
    return (
        <div className="flex gap-3 items-start">
            <a href={image.url} target="_blank" rel="noreferrer" title="Open full size" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
                <img src={image.url} alt={image.idea} className={`w-48 aspect-[3/2] object-cover rounded-lg bg-black ${pending ? "opacity-40" : ""}`} />
            </a>
            <div className="flex flex-col gap-1 text-xs text-gray-400 min-w-0">
                {pending && <span className="text-sky-300">Generating a new one…</span>}
                {image.idea !== idea.trim() && (
                    <span className="text-amber-300">The idea has changed since this image was made.</span>
                )}
                {image.style !== style && (
                    <span className="text-amber-300">Made in the {BROLL_STYLES[image.style].label} style; this idea is now {BROLL_STYLES[style].label}.</span>
                )}
                <span>{BROLL_STYLES[image.style].label} · {image.model} · ${image.usd.toFixed(2)}{image.createdAt ? ` · ${ago(image.createdAt)}` : ""}</span>
                <details>
                    <summary className="cursor-pointer hover:text-gray-300">Prompt</summary>
                    <p className="whitespace-pre-wrap mt-1">{image.prompt}</p>
                </details>
            </div>
        </div>
    );
}
