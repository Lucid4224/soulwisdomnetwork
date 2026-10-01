"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import CommentForm from "@/components/feed/CommentForm";
import CommentTree from "@/components/feed/CommentTree";
import CommunitySidebar from "@/components/feed/CommunitySidebar";
import MemberGate from "@/components/feed/MemberGate";
import PostCard from "@/components/feed/PostCard";
import { studioFetch } from "@/lib/studioClient";
import type { CommunityComment, CommunityPost } from "@/types/community";

// One post with its threaded comments.
export default function PostPage() {
    return <MemberGate><Thread /></MemberGate>;
}

function Thread() {
    const { postId } = useParams<{ postId: string }>();
    const router = useRouter();
    const [data, setData] = useState<{ post: CommunityPost; comments: CommunityComment[] } | null>(null);
    const [error, setError] = useState("");

    const load = useCallback(() => studioFetch<{ post: CommunityPost; comments: CommunityComment[] }>(`/api/community/posts/${postId}`)
        .then(setData, (e: Error) => setError(e.message)), [postId]);

    useEffect(() => { void load(); }, [load]);

    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
            <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <main className="space-y-4 min-w-0">
                    <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-bold text-ocean-500 hover:text-gold-600">
                        <ArrowLeft className="w-4 h-4" /> Feed
                    </Link>
                    {error && <p className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">{error}</p>}
                    {!data && !error && <div className="h-48 bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 animate-pulse" />}
                    {data && (
                        <>
                            {/* key: a reload after a comment refreshes the count */}
                            <PostCard key={data.post.commentCount} post={data.post} full onDeleted={() => router.push("/dashboard")} />
                            <section className="bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 p-4 space-y-5">
                                <CommentForm postId={data.post.id} onPosted={load} />
                                <CommentTree postId={data.post.id} comments={data.comments} onChanged={load} />
                            </section>
                        </>
                    )}
                </main>
                <div className="hidden lg:block"><CommunitySidebar /></div>
            </div>
        </div>
    );
}
