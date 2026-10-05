"use client";

// Uploads from the Studio (lib/server/uploads.ts): asks the server for a one-time upload link,
// sends the file straight to Cloud Storage with a progress bar, and, for a recording, turns it
// into an episode. Used on the Studio page (recordings), the Settings page (logo, intro, music) and the
// editor (overlay images, Part I).

import { useRef, useState } from "react";
import { studioFetch } from "@/lib/studioClient";
import { field, hint, primary, secondary } from "@/components/studio/ui";

type Kind = "episode" | "logo" | "intro" | "music" | "overlay";

// Some browsers leave the type empty for video files; the extension says what it is.
const BY_EXTENSION: Record<string, string> = {
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac",
};
const typeOf = (file: File) => file.type || BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";

// Sends one file; resolves with its Storage path (and the new episode's ID for a recording).
export async function uploadFile(kind: Kind, file: File, onProgress: (share: number) => void) {
    const start = await studioFetch<{ uploadUrl: string; path: string; episodeId: string | null }>("/api/studio/uploads", {
        method: "POST",
        body: JSON.stringify({ action: "start", kind, fileName: file.name, contentType: typeOf(file), size: file.size }),
    });
    await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", start.uploadUrl);
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload stopped (${xhr.status}); try again`)));
        xhr.onerror = () => reject(new Error("The upload stopped (connection lost); try again"));
        xhr.send(file);
    });
    onProgress(1);
    return { path: start.path, episodeId: start.episodeId };
}

function Progress({ share }: { share: number }) {
    return (
        <div className="w-full h-2 rounded bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
    );
}

// The Studio page's "Upload a recording": a video file and an optional title. A Zoom file name
// gives the title and recording date by itself.
export function UploadRecording({ onDone }: { onDone: (message: string) => void }) {
    const input = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState("");
    const [share, setShare] = useState<number | null>(null);
    const [error, setError] = useState("");

    async function send() {
        if (!file) return;
        setError("");
        setShare(0);
        try {
            const { path, episodeId } = await uploadFile("episode", file, setShare);
            const done = await studioFetch<{ message: string }>("/api/studio/uploads", {
                method: "POST",
                body: JSON.stringify({ action: "finish", episodeId, path, title }),
            });
            setFile(null);
            setTitle("");
            if (input.current) input.current.value = "";
            onDone(done.message);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setShare(null);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <input ref={input} type="file" accept="video/*" aria-label="Recording file" className="text-sm text-gray-300"
                onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={share !== null} />
            {file && (
                <input value={title} onChange={e => setTitle(e.target.value)} className={field} maxLength={150}
                    placeholder="Title (optional; taken from the file name otherwise)" aria-label="Title" disabled={share !== null} />
            )}
            <button onClick={() => void send()} disabled={!file || share !== null} className={`${primary} self-start`}>
                {share !== null ? `Uploading… ${Math.round(share * 100)}%` : "Upload and process"}
            </button>
            {share !== null && <Progress share={share} />}
            {share !== null && <p className={hint}>Keep this page open until the upload finishes.</p>}
            {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
    );
}

// A logo or intro on the Settings page: uploads and hands back the Storage path to save.
export function UploadAsset({ kind, label, accept, onUploaded }: { kind: "logo" | "intro" | "music"; label: string; accept: string; onUploaded: (path: string) => void }) {
    const [share, setShare] = useState<number | null>(null);
    const [error, setError] = useState("");
    async function pick(file: File | undefined) {
        if (!file) return;
        setError("");
        setShare(0);
        try {
            onUploaded((await uploadFile(kind, file, setShare)).path);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setShare(null);
        }
    }
    return (
        <div className="flex flex-col gap-1">
            <label className={`${secondary} self-start cursor-pointer`}>
                {share !== null ? `Uploading… ${Math.round(share * 100)}%` : label}
                <input type="file" accept={accept} className="hidden" disabled={share !== null} onChange={e => void pick(e.target.files?.[0])} />
            </label>
            {share !== null && <Progress share={share} />}
            {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
    );
}
