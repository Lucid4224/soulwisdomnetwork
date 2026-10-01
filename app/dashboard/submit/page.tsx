"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Image as ImageIcon, Link as LinkIcon, Type, Youtube } from "lucide-react";
import CommunitySidebar from "@/components/feed/CommunitySidebar";
import MemberGate from "@/components/feed/MemberGate";
import { LIMITS, POST_KINDS, webUrl, youtubeId, type PostKind } from "@/lib/community";
import { studioFetch } from "@/lib/studioClient";

// Create a post: a title, plus text, an image, a link or a YouTube video.
export default function SubmitPage() {
    return <MemberGate><Submit /></MemberGate>;
}

const KINDS: { id: PostKind; label: string; Icon: typeof Type }[] = [
    { id: "text", label: "Text", Icon: Type },
    { id: "image", label: "Image", Icon: ImageIcon },
    { id: "link", label: "Link", Icon: LinkIcon },
    { id: "youtube", label: "YouTube", Icon: Youtube },
];

function Submit() {
    const router = useRouter();
    // The feed's image and link buttons open this page on that tab. (This only renders in the
    // browser: MemberGate waits for sign-in.)
    const [kind, setKind] = useState<PostKind>(() => {
        const wanted = new URLSearchParams(window.location.search).get("kind") as PostKind | null;
        return wanted && POST_KINDS.includes(wanted) ? wanted : "text";
    });
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [url, setUrl] = useState("");
    const [image, setImage] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const preview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const video = kind === "youtube" ? youtubeId(url) : null;
    const problem =
        !title.trim() ? "Give your post a title"
            : kind === "text" && !body.trim() ? "Write something in the post"
                : kind === "image" && !image ? "Choose an image"
                    : kind === "link" && !webUrl(url) ? "Paste a link starting with https://"
                        : kind === "youtube" && !video ? "Paste a YouTube video link"
                            : "";

    const pick = (file: File | undefined) => {
        setError("");
        if (file && file.size > LIMITS.imageBytes) {
            setError("Images can be up to 10 MB");
            return;
        }
        setImage(file ?? null);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (problem || busy) return;
        setBusy(true);
        setError("");
        const form = new FormData();
        form.set("kind", kind);
        form.set("title", title);
        form.set("body", body);
        if (kind === "link" || kind === "youtube") form.set("url", url);
        if (kind === "image" && image) form.set("image", image);
        try {
            const { id } = await studioFetch<{ id: string }>("/api/community/posts", { method: "POST", body: form });
            router.push(`/dashboard/post/${id}`);
        } catch (err) {
            setError((err as Error).message);
            setBusy(false);
        }
    };

    const field = "w-full rounded-md border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-950 px-3 py-2 text-ocean-900 dark:text-ocean-100 placeholder-ocean-400 outline-none focus:border-gold-500";
    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
            <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <main className="space-y-4 min-w-0">
                    <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-bold text-ocean-500 hover:text-gold-600">
                        <ArrowLeft className="w-4 h-4" /> Feed
                    </Link>
                    <h1 className="text-xl font-bold text-ocean-900 dark:text-ocean-100">Create post</h1>
                    <form onSubmit={submit} className="bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 overflow-hidden">
                        <div className="grid grid-cols-4 border-b border-sand-200 dark:border-ocean-800">
                            {KINDS.map(({ id, label, Icon }) => (
                                <button key={id} type="button" onClick={() => setKind(id)} aria-pressed={kind === id}
                                    className={`flex items-center justify-center gap-1.5 py-3 text-sm font-bold border-b-2 ${kind === id
                                        ? "border-gold-500 text-gold-600 dark:text-gold-400 bg-gold-500/5"
                                        : "border-transparent text-ocean-500 hover:bg-sand-50 dark:hover:bg-ocean-800/50"}`}>
                                    <Icon className="w-4 h-4" /> <span className="hidden sm:inline">{label}</span>
                                </button>
                            ))}
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="relative">
                                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={LIMITS.title}
                                    placeholder="Title" className={`${field} pr-16`} aria-label="Title" />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ocean-400">{title.length}/{LIMITS.title}</span>
                            </div>

                            {kind === "image" && (
                                <label className="block rounded-md border-2 border-dashed border-ocean-200 dark:border-ocean-700 p-4 text-center cursor-pointer hover:border-gold-500">
                                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="sr-only"
                                        onChange={e => pick(e.target.files?.[0])} />
                                    {preview
                                        ? <img src={preview} alt="" className="mx-auto max-h-80 rounded" />
                                        : <span className="text-sm text-ocean-500">Choose an image (JPEG, PNG, WebP or GIF, up to 10 MB)</span>}
                                </label>
                            )}

                            {(kind === "link" || kind === "youtube") && (
                                <input value={url} onChange={e => setUrl(e.target.value)} maxLength={LIMITS.url} inputMode="url"
                                    placeholder={kind === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://…"} className={field} aria-label="Link" />
                            )}
                            {video && (
                                <img src={`https://i.ytimg.com/vi/${video}/hqdefault.jpg`} alt="Video preview" className="w-full max-w-sm rounded" />
                            )}

                            <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={LIMITS.body} rows={kind === "text" ? 8 : 4}
                                placeholder={kind === "text" ? "Text" : "Text (optional)"} className={`${field} resize-y`} aria-label="Text" />

                            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                            <div className="flex items-center justify-end gap-3">
                                {problem && title && <span className="text-xs text-ocean-400">{problem}</span>}
                                <button type="submit" disabled={!!problem || busy}
                                    className="px-6 py-2 rounded-full bg-gold-500 hover:bg-gold-600 text-ocean-950 text-sm font-bold disabled:opacity-40">
                                    {busy ? "Posting…" : "Post"}
                                </button>
                            </div>
                        </div>
                    </form>
                </main>
                <div className="hidden lg:block"><CommunitySidebar /></div>
            </div>
        </div>
    );
}
