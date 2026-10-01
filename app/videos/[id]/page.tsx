import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Youtube } from "lucide-react";
import LinkedText from "@/components/feed/LinkedText";
import VideoCard from "@/components/videos/VideoCard";
import { channelVideos } from "@/lib/server/channel";
import { date, views } from "@/lib/videos";

// One video, played here (docs/specs/017-videos.md). Only the channel's own videos: any other
// ID is "not found", so the page can't be used to show someone else's video under our name.
export const revalidate = 300;

type Props = { params: Promise<{ id: string }> };

async function find(id: string) {
    const all = await channelVideos();
    return { all, video: all?.find(v => v.id === id) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { video } = await find((await params).id);
    if (!video) return { title: "Videos · Soul Wisdom Collective" };
    return {
        title: `${video.title} · Soul Wisdom Collective`,
        description: video.description.slice(0, 200),
        openGraph: { title: video.title, images: [video.thumbnail], type: "video.other" },
    };
}

export default async function WatchPage({ params }: Props) {
    const { id } = await params;
    const { all, video } = await find(id);
    if (!video) notFound();

    // More of the same kind, newest first.
    const more = (all ?? []).filter(v => v.short === video.short && v.id !== video.id).slice(0, video.short ? 10 : 8);
    const embed = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`;

    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
            <main className="max-w-6xl mx-auto px-4 py-4 md:py-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">
                    <Link href={video.short ? "/videos/shorts" : "/videos"} className="inline-flex items-center gap-1 mb-3 text-sm font-bold text-ocean-500 hover:text-gold-600">
                        <ArrowLeft className="w-4 h-4" /> {video.short ? "Shorts" : "Episodes"}
                    </Link>
                    <div className={`relative overflow-hidden rounded-xl bg-black ${video.short ? "aspect-[9/16] max-h-[80vh] mx-auto" : "aspect-video"}`}
                        style={video.short ? { maxWidth: "calc(80vh * 9 / 16)" } : undefined}>
                        <iframe
                            src={embed}
                            title={video.title}
                            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                            allowFullScreen
                            className="absolute inset-0 w-full h-full"
                        />
                    </div>
                    <h1 className="mt-4 text-xl md:text-2xl font-bold text-ocean-900 dark:text-ocean-50 break-words">{video.title}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ocean-500 dark:text-ocean-400">
                        <span>{views(video.views)} · {date(video.publishedAt)}</span>
                        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-bold text-ocean-600 dark:text-ocean-300 hover:text-gold-600">
                            <Youtube className="w-4 h-4 text-red-500" /> Open on YouTube
                        </a>
                    </div>
                    {video.description && (
                        <div className="mt-4 rounded-xl bg-white dark:bg-ocean-900 border border-sand-200 dark:border-ocean-800 p-4">
                            <LinkedText text={video.description} className="text-sm text-ocean-800 dark:text-ocean-200 leading-relaxed" />
                        </div>
                    )}
                </div>

                {more.length > 0 && (
                    <aside>
                        <h2 className="mb-3 font-bold text-ocean-900 dark:text-ocean-100">{video.short ? "More shorts" : "More episodes"}</h2>
                        {video.short ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
                                {more.map(v => <VideoCard key={v.id} video={v} />)}
                            </div>
                        ) : (
                            <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-4">
                                {more.map(v => <VideoCard key={v.id} video={v} compact />)}
                            </div>
                        )}
                    </aside>
                )}
            </main>
        </div>
    );
}
