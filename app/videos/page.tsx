import type { Metadata } from "next";
import VideoBrowser from "@/components/videos/VideoBrowser";
import { channelVideos } from "@/lib/server/channel";
import { counts } from "@/lib/videos";

// The podcast's episodes, played on this site (docs/specs/017-videos.md). Public: the videos
// are public on YouTube too. New uploads appear within about half an hour (lib/server/channel.ts).
export const revalidate = 300;

export const metadata: Metadata = {
    title: "Videos · Soul Wisdom Collective",
    description: "Watch every episode of the Soul Wisdom Collective podcast.",
};

export default async function VideosPage() {
    const all = await channelVideos();
    return <VideoBrowser videos={all && all.filter(v => !v.short)} shorts={false} counts={counts(all)} />;
}

