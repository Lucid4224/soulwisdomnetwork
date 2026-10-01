// A public video on the podcast's YouTube channel, as the Videos pages show it
// (lib/server/channel.ts, docs/specs/017-videos.md).
export interface ChannelVideo {
    id: string;
    title: string;
    description: string;
    publishedAt: string;    // ISO time
    seconds: number;        // length
    views: number;
    thumbnail: string;
    short: boolean;
}
