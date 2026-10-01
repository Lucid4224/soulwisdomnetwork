import { unstable_cache } from "next/cache";
import { YOUTUBE_CHANNEL_HANDLE } from "@/lib/site";
import type { ChannelVideo } from "@/types/video";

// The podcast channel's public videos, for the Videos pages (docs/specs/017-videos.md). Read
// with the YouTube Data API and a server-only key (YOUTUBE_API_KEY), and kept for half an
// hour, so a new upload shows up on the site within about 30 minutes. A refresh costs a few
// units of the API's 10,000-a-day quota.

const API = "https://www.googleapis.com/youtube/v3";
export const REFRESH_SECONDS = 1800;
const MAX_PAGES = 20;   // 1,000 videos

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error("YOUTUBE_API_KEY is not set");
    const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`, { cache: "no-store" });
    if (!res.ok) {
        const err = new Error(`YouTube ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
    }
    return res.json() as Promise<T>;
}

type Page = { nextPageToken?: string; items?: { contentDetails: { videoId: string } }[] };

async function playlistIds(playlistId: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = "";
    for (let i = 0; i < MAX_PAGES; i++) {
        const page = await call<Page>("playlistItems", {
            part: "contentDetails", playlistId, maxResults: "50", ...(pageToken && { pageToken }),
        });
        ids.push(...(page.items ?? []).map(item => item.contentDetails.videoId));
        if (!page.nextPageToken) break;
        pageToken = page.nextPageToken;
    }
    return ids;
}

type Thumbs = Partial<Record<"default" | "medium" | "high" | "standard" | "maxres", { url: string }>>;
type VideoItem = {
    id: string;
    snippet: { title: string; description: string; publishedAt: string; liveBroadcastContent: string; thumbnails: Thumbs };
    contentDetails: { duration: string };
    statistics?: { viewCount?: string };
};

// "PT1H2M3S" → 3723
export function isoSeconds(duration: string): number {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
    if (!m) return 0;
    const [, d, h, min, s] = m.map(n => Number(n ?? 0));
    return ((d * 24 + h) * 60 + min) * 60 + s;
}

// Uncached; use channelVideos().
export async function fetchChannelVideos(): Promise<ChannelVideo[]> {
    const channels = await call<{ items?: { id: string; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
        "channels", { part: "contentDetails", forHandle: YOUTUBE_CHANNEL_HANDLE });
    const channel = channels.items?.[0];
    if (!channel) throw new Error(`No YouTube channel @${YOUTUBE_CHANNEL_HANDLE}`);

    const ids = await playlistIds(channel.contentDetails.relatedPlaylists.uploads);

    // Shorts: YouTube keeps a playlist of a channel's Shorts ("UUSH" + the channel ID after
    // "UC"). It is not documented, so if it is missing, anything up to 3 minutes counts.
    let shorts: Set<string> | null = null;
    try {
        shorts = new Set(await playlistIds(`UUSH${channel.id.slice(2)}`));
    } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
    }

    const videos: ChannelVideo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
        const batch = await call<{ items?: VideoItem[] }>("videos", {
            part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: "50",
        });
        for (const v of batch.items ?? []) {
            if (v.snippet.liveBroadcastContent !== "none") continue;    // upcoming premieres and live streams
            const seconds = isoSeconds(v.contentDetails.duration);
            const short = shorts ? shorts.has(v.id) : seconds <= 180;
            const t = v.snippet.thumbnails;
            // Episodes: 4:3 "high", cropped to 16:9 on the page. Shorts: the 16:9 frame has the
            // vertical video in the middle, cropped to 9:16, so the biggest one available.
            const thumb = short ? (t.maxres ?? t.standard ?? t.high ?? t.medium) : (t.high ?? t.medium ?? t.default);
            videos.push({
                id: v.id,
                // The page already says it is a short.
                title: short ? v.snippet.title.replace(/\s*#shorts\b/gi, "").trim() || v.snippet.title : v.snippet.title,
                description: v.snippet.description,
                publishedAt: v.snippet.publishedAt,
                seconds,
                views: Number(v.statistics?.viewCount ?? 0),
                thumbnail: thumb?.url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
                short,
            });
        }
    }
    return videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

const cached = unstable_cache(fetchChannelVideos, ["channel-videos"], { revalidate: REFRESH_SECONDS, tags: ["channel-videos"] });

// Newest first. Null when YouTube can't be read (no key yet, quota, an outage): the pages
// then point to the channel instead. A failure is not cached, so the next visit tries again.
export async function channelVideos(): Promise<ChannelVideo[] | null> {
    try {
        return await cached();
    } catch (error) {
        console.error("Could not load the channel's videos:", error);
        return null;
    }
}
