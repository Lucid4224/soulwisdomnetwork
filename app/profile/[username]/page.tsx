"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import MemberGate from "@/components/feed/MemberGate";
import PostCard from "@/components/feed/PostCard";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { studioFetch } from "@/lib/studioClient";
import type { CommunityPost } from "@/types/community";
import type { UserProfile } from "@/types/user";

// A member's profile and posts. The route segment is their uid.
export default function ProfilePage() {
    return <MemberGate><Profile /></MemberGate>;
}

function Profile() {
    const { username: uid } = useParams<{ username: string }>();
    const { user } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
    const [posts, setPosts] = useState<CommunityPost[]>([]);

    useEffect(() => {
        getDoc(doc(db, "users", uid))
            .then(snap => setProfile(snap.exists() ? (snap.data() as UserProfile) : null))
            .catch(() => setProfile(null));
        studioFetch<{ posts: CommunityPost[] }>(`/api/community/posts?author=${encodeURIComponent(uid)}`)
            .then(page => setPosts(page.posts))
            .catch(error => console.error("Error fetching posts:", error));
    }, [uid]);

    if (profile === undefined) {
        return (
            <div className="min-h-screen bg-sand-50 dark:bg-ocean-950 flex justify-center items-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold-500"></div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="min-h-screen bg-sand-50 dark:bg-ocean-950 flex flex-col justify-center items-center p-4">
                <h1 className="text-2xl font-bold text-ocean-900 dark:text-ocean-100 mb-4">Member not found</h1>
                <Link href="/dashboard" className="bg-gold-500 text-ocean-950 px-6 py-2 rounded-lg font-bold">Back to the feed</Link>
            </div>
        );
    }

    const name = profile.displayName || "Member";
    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
            <main className="max-w-2xl mx-auto p-4 py-8">
                <div className="bg-white dark:bg-ocean-900 rounded-2xl shadow-sm border border-sand-200 dark:border-ocean-800 overflow-hidden mb-8">
                    <div className="h-32 bg-gradient-to-r from-indigo-600 to-gold-500"></div>
                    <div className="px-6 pb-6 relative">
                        <div className="flex justify-between items-end -mt-12 mb-4">
                            <div className="p-1 bg-white dark:bg-ocean-900 rounded-full">
                                {profile.photoURL ? (
                                    <img src={profile.photoURL} alt={name} referrerPolicy="no-referrer" className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-ocean-900" />
                                ) : (
                                    <div className="w-24 h-24 rounded-full bg-sand-100 dark:bg-ocean-800 flex items-center justify-center text-3xl font-bold text-ocean-400 border-4 border-white dark:border-ocean-900">
                                        {name[0].toUpperCase()}
                                    </div>
                                )}
                            </div>
                            {user?.uid === uid && (
                                <Link href="/profile/edit" className="px-4 py-2 rounded-full border border-ocean-200 dark:border-ocean-700 text-sm font-bold text-ocean-700 dark:text-ocean-200 hover:bg-sand-50 dark:hover:bg-ocean-800">
                                    Edit profile
                                </Link>
                            )}
                        </div>

                        <h2 className="text-2xl font-bold text-ocean-900 dark:text-ocean-100">
                            {name}
                            {profile.banned && <span className="ml-2 text-sm text-red-500">banned</span>}
                        </h2>

                        {profile.bio && (
                            <p className="mt-4 text-ocean-700 dark:text-ocean-300 leading-relaxed whitespace-pre-wrap">{profile.bio}</p>
                        )}

                        <div className="flex gap-4 mt-6 text-sm text-ocean-500 dark:text-ocean-400">
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-ocean-900 dark:text-ocean-100">{posts.length}</span> Posts
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <h3 className="font-bold text-lg text-ocean-900 dark:text-ocean-100 px-1 mb-4">Posts</h3>
                    {posts.map(post => (
                        <PostCard key={post.id} post={post} onDeleted={() => setPosts(prev => prev.filter(p => p.id !== post.id))} />
                    ))}
                    {posts.length === 0 && (
                        <div className="text-center py-12 bg-white dark:bg-ocean-900 rounded-xl border border-dashed border-ocean-200 dark:border-ocean-800">
                            <p className="text-ocean-500 dark:text-ocean-400">No posts yet.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
