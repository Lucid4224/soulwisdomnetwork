"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, ExternalLink, MessageSquare, Play, Share2, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { domainOf } from "@/lib/community";
import { studioFetch } from "@/lib/studioClient";
import type { CommunityPost } from "@/types/community";
import Byline from "./Byline";
import LinkedText from "./LinkedText";
import VoteButtons from "./VoteButtons";
import { banAuthor, shareLink } from "./moderation";

// A post in the feed (`full` false: title links to the post, long text is cut short) or on
// its own page (`full`).
export default function PostCard({ post, full = false, onDeleted }: {
    post: CommunityPost;
    full?: boolean;
    onDeleted?: () => void;
}) {
    const { profile } = useAuth();
    const [banned, setBanned] = useState(post.author.banned);
    const href = `/dashboard/post/${post.id}`;
    const isAdmin = profile?.role === "admin";

    const remove = async () => {
        if (!confirm("Delete this post and all its comments? This cannot be undone.")) return;
        try {
            await studioFetch(`/api/community/posts/${post.id}`, { method: "DELETE" });
            onDeleted?.();
        } catch (error) {
            alert((error as Error).message);
        }
    };

    const action = "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-bold text-ocean-500 dark:text-ocean-400 hover:bg-sand-100 dark:hover:bg-ocean-800";
    return (
        <article className="flex bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 hover:border-ocean-200 dark:hover:border-ocean-700 transition-colors overflow-hidden">
            <div className="w-12 shrink-0 bg-sand-50 dark:bg-ocean-950/40 pt-2 flex justify-center">
                <VoteButtons path={`/api/community/posts/${post.id}/vote`} score={post.score} myVote={post.myVote} vertical />
            </div>
            <div className="flex-1 min-w-0 p-3 pb-1">
                <Byline author={{ ...post.author, banned }} createdAt={post.createdAt} />
                <h2 className={`mt-1.5 font-bold text-ocean-900 dark:text-ocean-50 break-words ${full ? "text-xl" : "text-lg leading-snug"}`}>
                    {full ? post.title : <Link href={href} className="hover:underline">{post.title}</Link>}
                </h2>

                <Media post={post} href={href} full={full} />

                {post.body && (
                    full
                        ? <LinkedText text={post.body} className="mt-3 text-ocean-800 dark:text-ocean-200 leading-relaxed" />
                        : <Link href={href} className="block mt-2 text-sm text-ocean-700 dark:text-ocean-300 line-clamp-3 whitespace-pre-wrap break-words">{post.body}</Link>
                )}

                <div className="flex flex-wrap items-center gap-1 mt-2 -ml-2">
                    <Link href={href} className={action}>
                        <MessageSquare className="w-4 h-4" /> {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
                    </Link>
                    <button type="button" onClick={() => shareLink(href)} className={action}>
                        <Share2 className="w-4 h-4" /> Share
                    </button>
                    {post.canDelete && (
                        <button type="button" onClick={remove} className={`${action} hover:text-red-600`}>
                            <Trash2 className="w-4 h-4" /> Delete
                        </button>
                    )}
                    {isAdmin && post.author.role === "user" && !banned && post.author.uid !== profile?.uid && (
                        <button type="button" onClick={async () => setBanned(await banAuthor(post.author))} className={`${action} hover:text-red-600`}>
                            <Ban className="w-4 h-4" /> Ban author
                        </button>
                    )}
                </div>
            </div>
        </article>
    );
}

function Media({ post, href, full }: { post: CommunityPost; href: string; full: boolean }) {
    const [playing, setPlaying] = useState(false);

    if (post.kind === "image" && post.imageUrl) {
        const img = <img src={post.imageUrl} alt={post.title} loading="lazy" className="w-full max-h-[512px] object-contain bg-ocean-950/5 dark:bg-black/30" />;
        return <div className="mt-3 rounded-md overflow-hidden border border-sand-200 dark:border-ocean-800">{full ? img : <Link href={href}>{img}</Link>}</div>;
    }

    if (post.kind === "youtube" && post.youtubeId) {
        // A thumbnail until played, so a page of videos doesn't load a page of players.
        return (
            <div className="mt-3 relative aspect-video rounded-md overflow-hidden bg-black">
                {playing ? (
                    <iframe
                        src={`https://www.youtube-nocookie.com/embed/${post.youtubeId}?autoplay=1`}
                        title={post.title}
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        allowFullScreen
                        className="absolute inset-0 w-full h-full"
                    />
                ) : (
                    <button type="button" onClick={() => setPlaying(true)} className="absolute inset-0 w-full h-full group" aria-label="Play video">
                        <img src={`https://i.ytimg.com/vi/${post.youtubeId}/hqdefault.jpg`} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100" />
                        <span className="absolute inset-0 flex items-center justify-center">
                            <span className="w-16 h-11 rounded-xl bg-red-600 flex items-center justify-center shadow-lg">
                                <Play className="w-6 h-6 text-white" fill="currentColor" />
                            </span>
                        </span>
                    </button>
                )}
            </div>
        );
    }

    if (post.url) {
        return (
            <a href={post.url} target="_blank" rel="noopener noreferrer nofollow ugc"
                className="mt-2 inline-flex items-center gap-1.5 max-w-full text-sm text-gold-600 dark:text-gold-400 hover:underline">
                <span className="truncate">{domainOf(post.url)}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
        );
    }
    return null;
}
