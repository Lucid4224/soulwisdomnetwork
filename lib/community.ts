// The community feed (docs/specs/016-community-feed.md): limits and helpers shared by the
// browser and the server routes, so both check the same things.

export const LIMITS = {
    title: 300,
    body: 10000,
    comment: 5000,
    url: 2000,
    imageBytes: 10 * 1024 * 1024,
    name: 40,
    bio: 500,
};

export const MAX_DEPTH = 8;          // replies nest this deep, then the Reply button goes away

export type PostKind = 'text' | 'image' | 'link' | 'youtube';
export const POST_KINDS: PostKind[] = ['text', 'image', 'link', 'youtube'];

// The 11-character video ID from any usual YouTube link (watch, youtu.be, shorts, embed,
// live), or null.
export function youtubeId(link: string): string | null {
    const url = webUrl(link);
    if (!url) return null;
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        else id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// An http(s) link, or null. Anything else (javascript:, data:, ...) is refused.
export function webUrl(link: string): URL | null {
    try {
        const url = new URL(link.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch {
        return null;
    }
}

export const domainOf = (link: string) => webUrl(link)?.hostname.replace(/^www\./, '') ?? '';

// Reddit's "hot" ranking: votes count logarithmically (the first 10 weigh as much as the next
// 90), and every 12.5 hours of age costs as much as a tenfold drop in score.
export function hotRank(score: number, created: Date): number {
    const order = Math.log10(Math.max(Math.abs(score), 1));
    const sign = Math.sign(score);
    const seconds = created.getTime() / 1000 - 1134028003;
    return Math.round((sign * order + seconds / 45000) * 1e7) / 1e7;
}
