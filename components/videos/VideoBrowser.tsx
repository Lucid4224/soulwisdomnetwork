"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Youtube } from "lucide-react";
import { YOUTUBE_CHANNEL_URL } from "@/lib/site";
import type { ChannelVideo } from "@/types/video";
import VideoCard from "./VideoCard";

// The Videos pages: Episodes or Shorts, sorted and searched in the browser (the whole channel
// arrives with the page; app/videos).

const SORTS = {
    new: { label: "Newest", by: (a: ChannelVideo, b: ChannelVideo) => b.publishedAt.localeCompare(a.publishedAt) },
    old: { label: "Oldest", by: (a: ChannelVideo, b: ChannelVideo) => a.publishedAt.localeCompare(b.publishedAt) },
    popular: { label: "Most viewed", by: (a: ChannelVideo, b: ChannelVideo) => b.views - a.views },
} as const;
type Sort = keyof typeof SORTS;

export default function VideoBrowser({ videos, shorts, counts }: {
    videos: ChannelVideo[] | null;   // null: YouTube couldn't be read
    shorts: boolean;
    counts: { episodes: number; shorts: number };
}) {
    const [sort, setSort] = useState<Sort>("new");
    const [query, setQuery] = useState("");

    const shown = useMemo(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return (videos ?? [])
            .filter(v => words.every(w => `${v.title} ${v.description}`.toLowerCase().includes(w)))
            .sort(SORTS[sort].by);
    }, [videos, sort, query]);

    const tab = (active: boolean) => `px-4 py-2 rounded-full text-sm font-bold transition-colors ${active
        ? "bg-gold-500 text-ocean-950"
        : "text-ocean-600 dark:text-ocean-300 hover:bg-sand-100 dark:hover:bg-ocean-800"}`;

    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
            <main className="max-w-6xl mx-auto px-4 py-6 md:py-10">
                <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-ocean-900 dark:text-ocean-50">Videos</h1>
                        <p className="mt-1 text-sm text-ocean-600 dark:text-ocean-300">
                            Every conversation from the Soul Wisdom Collective podcast, with Daniel Endy and Tom Wood.
                        </p>
                    </div>
                    <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ocean-200 dark:border-ocean-700 text-sm font-bold text-ocean-700 dark:text-ocean-200 hover:border-gold-500">
                        <Youtube className="w-4 h-4 text-red-500" /> Subscribe on YouTube
                    </a>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
                    <nav className="flex gap-1" aria-label="Video type">
                        <Link href="/videos" className={tab(!shorts)} aria-current={!shorts ? "page" : undefined}>
                            Episodes <span className="opacity-60 font-normal">{counts.episodes}</span>
                        </Link>
                        <Link href="/videos/shorts" className={tab(shorts)} aria-current={shorts ? "page" : undefined}>
                            Shorts <span className="opacity-60 font-normal">{counts.shorts}</span>
                        </Link>
                    </nav>
                    <div className="flex gap-2 sm:ml-auto">
                        <label className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ocean-400" />
                            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={shorts ? "Search shorts" : "Search episodes"}
                                aria-label="Search" className="w-full rounded-full border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-900 pl-9 pr-3 py-2 text-sm text-ocean-900 dark:text-ocean-100 placeholder-ocean-400 outline-none focus:border-gold-500" />
                        </label>
                        <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort"
                            className="rounded-full border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-900 px-3 py-2 text-sm font-bold text-ocean-700 dark:text-ocean-200 outline-none focus:border-gold-500">
                            {Object.entries(SORTS).map(([id, { label }]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </div>
                </div>

                {videos === null ? (
                    <Empty>
                        The videos can&apos;t be shown here right now.{" "}
                        <a href={YOUTUBE_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-gold-600 dark:text-gold-400 underline">Watch them on YouTube</a>.
                    </Empty>
                ) : shown.length === 0 ? (
                    <Empty>{query ? "Nothing matches that search." : shorts ? "No shorts yet." : "No episodes yet."}</Empty>
                ) : shorts ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                        {shown.map(v => <VideoCard key={v.id} video={v} />)}
                    </div>
                ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-8">
                        {shown.map(v => <VideoCard key={v.id} video={v} />)}
                    </div>
                )}
            </main>
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-center py-16 rounded-xl border border-dashed border-ocean-200 dark:border-ocean-800 text-ocean-500 dark:text-ocean-400">
            {children}
        </div>
    );
}
