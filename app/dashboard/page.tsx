"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Image as ImageIcon, Link as LinkIcon, Sparkles, Trophy } from "lucide-react";
import CommunitySidebar from "@/components/feed/CommunitySidebar";
import MemberGate from "@/components/feed/MemberGate";
import PostCard from "@/components/feed/PostCard";
import { useAuth } from "@/context/AuthContext";
import { studioFetch } from "@/lib/studioClient";
import type { CommunityPost, FeedSort } from "@/types/community";

// The community feed, Reddit-style: one community, Hot / New / Top (docs/specs/016-community-feed.md).
export default function FeedPage() {
    return <MemberGate><Feed /></MemberGate>;
}

const SORTS: { id: FeedSort; label: string; Icon: typeof Flame }[] = [
    { id: "hot", label: "Hot", Icon: Flame },
    { id: "new", label: "New", Icon: Sparkles },
    { id: "top", label: "Top", Icon: Trophy },
];

function Feed() {
    const { profile } = useAuth();
    const [sort, setSort] = useState<FeedSort>("hot");
    const [posts, setPosts] = useState<CommunityPost[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async (after: string | null) => {
        setLoading(true);
        setError("");
        try {
            const page = await studioFetch<{ posts: CommunityPost[]; next: string | null }>(
                `/api/community/posts?sort=${sort}${after ? `&after=${after}` : ""}`);
            setPosts(prev => (after ? [...prev, ...page.posts] : page.posts));
            setNext(page.next);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [sort]);

    useEffect(() => { void load(null); }, [load]);

    const initial = (profile?.displayName || "M")[0].toUpperCase();
    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
            <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <main className="space-y-3 min-w-0">
                    <div className="flex items-center gap-2 bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 p-2">
                        {profile?.photoURL
                            ? <img src={profile.photoURL} alt="" className="w-9 h-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                            : <span className="w-9 h-9 rounded-full bg-gold-500/15 text-gold-600 dark:text-gold-400 font-bold flex items-center justify-center">{initial}</span>}
                        <Link href="/dashboard/submit" className="flex-1 min-w-0 px-3 py-2 rounded-md bg-sand-50 dark:bg-ocean-950 border border-sand-200 dark:border-ocean-800 text-sm text-ocean-400 hover:border-gold-500">
                            Create post
                        </Link>
                        <Link href="/dashboard/submit?kind=image" aria-label="Post an image" className="p-2 rounded-md text-ocean-400 hover:bg-sand-100 dark:hover:bg-ocean-800"><ImageIcon className="w-5 h-5" /></Link>
                        <Link href="/dashboard/submit?kind=link" aria-label="Post a link" className="p-2 rounded-md text-ocean-400 hover:bg-sand-100 dark:hover:bg-ocean-800"><LinkIcon className="w-5 h-5" /></Link>
                    </div>

                    <div className="flex gap-1 bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 p-1.5">
                        {SORTS.map(({ id, label, Icon }) => (
                            <button key={id} type="button" onClick={() => setSort(id)} aria-pressed={sort === id}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${sort === id
                                    ? "bg-sand-100 dark:bg-ocean-800 text-ocean-900 dark:text-ocean-50"
                                    : "text-ocean-500 hover:bg-sand-50 dark:hover:bg-ocean-800/50"}`}>
                                <Icon className="w-4 h-4" /> {label}
                            </button>
                        ))}
                    </div>

                    {error && <p className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">{error}</p>}

                    {posts.map(post => (
                        <PostCard key={post.id} post={post} onDeleted={() => setPosts(prev => prev.filter(p => p.id !== post.id))} />
                    ))}

                    {loading && [1, 2, 3].map(i => (
                        <div key={i} className="h-28 bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 animate-pulse" />
                    ))}

                    {!loading && !error && posts.length === 0 && (
                        <div className="text-center py-16 bg-white dark:bg-ocean-900 rounded-lg border border-dashed border-ocean-200 dark:border-ocean-800">
                            <p className="text-ocean-500 dark:text-ocean-400">No posts yet. Be the first to share something.</p>
                        </div>
                    )}

                    {!loading && next && (
                        <button type="button" onClick={() => load(next)} className="w-full py-2.5 rounded-full border border-ocean-200 dark:border-ocean-700 text-sm font-bold text-ocean-700 dark:text-ocean-200 hover:bg-white dark:hover:bg-ocean-900">
                            Load more
                        </button>
                    )}
                </main>
                <div className="hidden lg:block"><CommunitySidebar /></div>
            </div>
        </div>
    );
}
