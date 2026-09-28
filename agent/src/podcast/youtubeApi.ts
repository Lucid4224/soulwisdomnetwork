// The YouTube Data API v3 through fetch (docs/specs/012-youtube-upload.md): an access token from
// the channel owner's refresh token, a resumable upload that survives dropped connections, and
// the thumbnail, captions and metadata calls. Used by youtube.ts.

import * as fs from 'fs';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
// A multiple of 256 KiB, as resumable uploads require.
const CHUNK = 64 * 1024 * 1024;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class YoutubeError extends Error {
    constructor(message: string, readonly status: number, readonly reason = '') {
        super(message);
    }
}

export interface YoutubeCredentials { clientId: string; clientSecret: string; refreshToken: string }

export interface VideoResource {
    id?: string;
    snippet?: Record<string, unknown>;
    status?: { privacyStatus?: string; uploadStatus?: string; rejectionReason?: string; failureReason?: string; publishAt?: string | null } & Record<string, unknown>;
}

async function explain(res: Response, what: string) {
    const text = await res.text();
    let message = text.slice(0, 300), reason = '';
    try {
        const e = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } | string; error_description?: string };
        if (typeof e.error === 'object') {
            message = e.error.message ?? message;
            reason = e.error.errors?.[0]?.reason ?? '';
        } else {
            message = [e.error, e.error_description].filter(Boolean).join(': ') || message;
            reason = typeof e.error === 'string' ? e.error : '';
        }
    } catch { /* not JSON */ }
    const hint = reason === 'invalid_grant' ? ' (the YouTube sign-in has expired or was revoked; make a new refresh token)'
        : reason === 'quotaExceeded' ? ' (the daily YouTube API quota is used up; try again tomorrow)'
            : reason === 'uploadLimitExceeded' ? ' (the channel has hit YouTube\'s daily upload limit)' : '';
    return new YoutubeError(`YouTube ${what} failed with ${res.status}: ${message}${hint}`, res.status, reason);
}

export function createYoutube(creds: YoutubeCredentials) {
    let token = '', expires = 0;

    async function accessToken() {
        if (token && Date.now() < expires - 60_000) return token;
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: creds.clientId, client_secret: creds.clientSecret,
                refresh_token: creds.refreshToken, grant_type: 'refresh_token',
            }),
        });
        if (!res.ok) throw await explain(res, 'sign-in');
        const body = await res.json() as { access_token: string; expires_in: number };
        token = body.access_token;
        expires = Date.now() + body.expires_in * 1000;
        return token;
    }

    // One call, retried on rate limits and passing server errors.
    async function call<T>(method: string, url: string, init: { body?: BodyInit; type?: string; what: string }): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            const res = await fetch(url, {
                method,
                headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.type ? { 'Content-Type': init.type } : {}) },
                body: init.body,
            });
            if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
            if ((res.status === 429 || res.status >= 500) && attempt < 5) {
                console.log(`  ⏳ YouTube ${res.status}; retrying`);
                await sleep(5000 * attempt);
                continue;
            }
            throw await explain(res, init.what);
        }
    }

    // Resumable upload: start a session, then send the file in chunks, asking YouTube where it
    // got to after any failure. Returns the new video.
    async function upload(file: string, resource: VideoResource): Promise<VideoResource> {
        const size = fs.statSync(file).size;
        const start = await fetch(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${await accessToken()}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Length': String(size),
                'X-Upload-Content-Type': 'video/mp4',
            },
            body: JSON.stringify(resource),
        });
        if (!start.ok) throw await explain(start, 'upload');
        const session = start.headers.get('location');
        if (!session) throw new Error('YouTube did not return an upload session');

        const fd = fs.openSync(file, 'r');
        try {
            let offset = 0, failures = 0, lastLogged = -1;
            while (true) {
                const end = Math.min(offset + CHUNK, size);
                const chunk = Buffer.alloc(end - offset);
                fs.readSync(fd, chunk, 0, chunk.length, offset);
                let res: Response;
                try {
                    res = await fetch(session, {
                        method: 'PUT', redirect: 'manual',
                        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Range': `bytes ${offset}-${end - 1}/${size}` },
                        body: chunk,
                    });
                } catch (error) {
                    res = new Response(null, { status: 599, statusText: (error as Error).message });
                }
                if (res.status === 200 || res.status === 201) return await res.json() as VideoResource;
                if (res.status === 308) {
                    // "bytes=0-N": YouTube has everything up to N.
                    const range = res.headers.get('range');
                    const before = offset;
                    offset = range ? Number(range.split('-')[1]) + 1 : 0;
                    if (offset > before) failures = 0;
                    else if (++failures > 8) throw new Error('The YouTube upload is not making progress');
                    const percent = Math.floor(offset / size * 10) * 10;
                    if (percent !== lastLogged) console.log(`  … uploaded ${percent}%`);
                    lastLogged = percent;
                    continue;
                }
                if (res.status < 500 && res.status !== 429) throw await explain(res, 'upload');
                if (++failures > 8) throw new Error(`The YouTube upload kept failing (${res.status} ${res.statusText})`);
                console.log(`  ⏳ Upload interrupted (${res.status}); resuming`);
                await sleep(Math.min(60_000, 2000 * 2 ** failures));
                // Ask where it got to before sending more.
                const status = await fetch(session, {
                    method: 'PUT', redirect: 'manual',
                    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Range': `bytes */${size}` },
                }).catch(() => null);
                if (status && (status.status === 200 || status.status === 201)) return await status.json() as VideoResource;
                if (status?.status === 308) {
                    const range = status.headers.get('range');
                    offset = range ? Number(range.split('-')[1]) + 1 : 0;
                }
            }
        } finally {
            fs.closeSync(fd);
        }
    }

    const getVideo = (id: string) => call<{ items: VideoResource[] }>('GET', `${API}/videos?part=snippet,status&id=${encodeURIComponent(id)}`, { what: 'video lookup' })
        .then(r => r.items[0] ?? null);

    const updateVideo = (resource: VideoResource) =>
        call<VideoResource>('PUT', `${API}/videos?part=snippet,status`, { body: JSON.stringify(resource), type: 'application/json', what: 'update' });

    const setThumbnail = (videoId: string, jpeg: Buffer) =>
        call('POST', `${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
            { body: new Uint8Array(jpeg), type: 'image/jpeg', what: 'thumbnail' });

    const listCaptions = (videoId: string) =>
        call<{ items: { id: string; snippet: { name: string; language: string } }[] }>('GET', `${API}/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`, { what: 'caption list' })
            .then(r => r.items);

    const deleteCaption = (id: string) => call('DELETE', `${API}/captions?id=${encodeURIComponent(id)}`, { what: 'caption delete' });

    async function insertCaption(videoId: string, name: string, srt: string) {
        const boundary = `swc${Date.now()}`;
        const body = [
            `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
            JSON.stringify({ snippet: { videoId, language: 'en', name, isDraft: false } }),
            `--${boundary}`, 'Content-Type: application/octet-stream', '',
            srt,
            `--${boundary}--`, '',
        ].join('\r\n');
        return call<{ id: string }>('POST', `${UPLOAD}/captions?part=snippet&uploadType=multipart`,
            { body, type: `multipart/related; boundary=${boundary}`, what: 'captions' });
    }

    return { upload, getVideo, updateVideo, setThumbnail, listCaptions, deleteCaption, insertCaption };
}
