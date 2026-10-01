import type { Metadata } from "next";
import VideoBrowser from "@/components/videos/VideoBrowser";
import { channelVideos } from "@/lib/server/channel";
import { counts } from "@/lib/videos";

// The podcast's Shorts (docs/specs/017-videos.md).
export const revalidate = 300;

export const metadata: Metadata = {
    title: "Shorts · Soul Wisdom Collective",
    description: "Short moments from the Soul Wisdom Collective podcast.",
};

export default async function ShortsPage() {
    const all = await channelVideos();
    return <VideoBrowser videos={all && all.filter(v => v.short)} shorts counts={counts(all)} />;
}
