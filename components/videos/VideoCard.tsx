import Link from "next/link";
import { date, duration, views } from "@/lib/videos";
import type { ChannelVideo } from "@/types/video";

// One video in a grid or list: an episode (16:9, with its length) or a short (9:16).
export default function VideoCard({ video, compact = false }: { video: ChannelVideo; compact?: boolean }) {
    if (video.short) {
        return (
            <Link href={`/videos/${video.id}`} className="group block">
                <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-ocean-900">
                    <img src={video.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    <div className="absolute inset-x-0 bottom-0 p-2.5 pt-10 bg-gradient-to-t from-black/85 to-transparent">
                        <h3 className="text-sm font-bold text-white leading-snug line-clamp-3">{video.title}</h3>
                        <p className="mt-1 text-xs text-white/70">{views(video.views)}</p>
                    </div>
                </div>
            </Link>
        );
    }
    return (
        <Link href={`/videos/${video.id}`} className={`group ${compact ? "flex gap-3" : "block"}`}>
            <div className={`relative aspect-video rounded-xl overflow-hidden bg-ocean-900 shrink-0 ${compact ? "w-40" : ""}`}>
                <img src={video.thumbnail} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform" />
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs font-bold tabular-nums">
                    {duration(video.seconds)}
                </span>
            </div>
            <div className={compact ? "min-w-0" : "mt-3"}>
                <h3 className={`font-bold text-ocean-900 dark:text-ocean-50 leading-snug group-hover:text-gold-600 dark:group-hover:text-gold-400 ${compact ? "text-sm line-clamp-3" : "line-clamp-2"}`}>
                    {video.title}
                </h3>
                <p className="mt-1 text-xs text-ocean-500 dark:text-ocean-400">{views(video.views)} · {date(video.publishedAt)}</p>
            </div>
        </Link>
    );
}
