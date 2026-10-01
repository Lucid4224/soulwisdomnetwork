"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "firebase/firestore";
import PostCard, { Post } from "@/components/feed/PostCard";
import AuthGuard from "@/components/auth/AuthGuard";

interface UserProfile {
    uid: string;
    displayName: string;
    photoURL: string | null;
    bio: string;
    username?: string;
}

export default function ProfilePage() {
    const params = useParams();
    const router = useRouter();
    const username = params.username as string;

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchProfile() {
            try {
                // In a real app, you'd query by a 'username' field. 
                // For MVP, we'll try to match displayName or just use UID if we had it.
                // Let's assume we query by UID for now if it looks like one, or try to find by name.
                const usersRef = collection(db, "users");
                const q = query(usersRef, where("uid", "==", username)); // Simplifying to UID for MVP access
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const userData = querySnapshot.docs[0].data() as UserProfile;
                    setProfile(userData);

                    // Fetch posts for this user
                    const postsQ = query(
                        collection(db, "posts"),
                        where("authorId", "==", userData.uid),
                        orderBy("createdAt", "desc")
                    );

                    const unsubscribePosts = onSnapshot(postsQ, (snapshot) => {
                        const postsData = snapshot.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        })) as Post[];
                        setPosts(postsData);
                    });

                    return () => unsubscribePosts();
                } else {
                    // Not found: show the error below.
                    setLoading(false);
                }
            } catch (error) {
                console.error("Error fetching profile:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchProfile();
    }, [username]);

    if (loading) {
        return (
            <div className="min-h-screen bg-sand-50 dark:bg-ocean-950 flex justify-center items-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold-500"></div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="min-h-screen bg-sand-50 dark:bg-ocean-950 flex flex-col justify-center items-center p-4">
                <h1 className="text-2xl font-bold text-ocean-900 dark:text-ocean-100 mb-4">User not found</h1>
                <button
                    onClick={() => router.push("/dashboard")}
                    className="bg-gold-500 text-ocean-950 px-6 py-2 rounded-lg font-bold"
                >
                    Back to Dashboard
                </button>
            </div>
        );
    }

    return (
        <AuthGuard>
            <div className="min-h-screen bg-sand-50 dark:bg-ocean-950">
                <main className="max-w-2xl mx-auto p-4 py-8">
                    <div className="bg-white dark:bg-ocean-900 rounded-2xl shadow-sm border border-sand-200 dark:border-ocean-800 overflow-hidden mb-8">
                        <div className="h-32 bg-gradient-to-r from-indigo-600 to-gold-500"></div>
                        <div className="px-6 pb-6 relative">
                            <div className="flex justify-between items-end -mt-12 mb-4">
                                <div className="p-1 bg-white dark:bg-ocean-900 rounded-full">
                                    {profile.photoURL ? (
                                        <img src={profile.photoURL} alt={profile.displayName} className="w-24 h-24 rounded-full object-cover border-4 border-white dark:border-ocean-900" />
                                    ) : (
                                        <div className="w-24 h-24 rounded-full bg-sand-100 dark:bg-ocean-800 flex items-center justify-center text-3xl font-bold text-ocean-400 border-4 border-white dark:border-ocean-900">
                                            {profile.displayName[0]}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <h2 className="text-2xl font-bold text-ocean-900 dark:text-ocean-100">{profile.displayName}</h2>
                            </div>

                            {profile.bio && (
                                <p className="mt-4 text-ocean-700 dark:text-ocean-300 leading-relaxed">
                                    {profile.bio}
                                </p>
                            )}

                            <div className="flex gap-4 mt-6 text-sm text-ocean-500 dark:text-ocean-400">
                                <div className="flex items-center gap-1">
                                    <span className="font-bold text-ocean-900 dark:text-ocean-100">{posts.length}</span> Posts
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-bold text-lg text-ocean-900 dark:text-ocean-100 px-1 mb-4">Posts</h3>
                        {posts.map(post => (
                            <PostCard key={post.id} post={post} />
                        ))}
                        {posts.length === 0 && (
                            <div className="text-center py-12 bg-white dark:bg-ocean-900 rounded-xl border border-dashed border-sand-300 dark:border-ocean-800">
                                <p className="text-ocean-500 dark:text-ocean-400">This user hasn't posted anything yet.</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </AuthGuard>
    );
}
