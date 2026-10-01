"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/config";
import { collection, query, getDocs, orderBy } from "firebase/firestore";
import Link from "next/link";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuth } from "@/context/AuthContext";

interface Member {
    uid: string;
    displayName: string;
    photoURL: string | null;
    bio: string;
}

export default function MembersPage() {
    const { user: currentUser } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchMembers() {
            try {
                const q = query(collection(db, "users"), orderBy("displayName", "asc"));
                const snapshot = await getDocs(q);
                // Banned members are left out of the directory.
                const membersData = snapshot.docs.map(doc => doc.data() as Member & { banned?: boolean }).filter(m => !m.banned);
                setMembers(membersData);
            } catch (error) {
                console.error("Error fetching members:", error);
            } finally {
                setLoading(false);
            }
        }
        fetchMembers();
    }, []);

    const handleMessageClick = async (memberUId: string, memberName: string, memberPhoto: string | null) => {
        if (!currentUser) return;
        try {
            const { getOrCreateConversation } = await import("@/lib/firebase/messaging");
            const convId = await getOrCreateConversation(currentUser.uid, memberUId, memberName, memberPhoto);
            window.location.href = `/messages/${convId}`;
        } catch (error) {
            console.error("Error starting conversation:", error);
        }
    };

    return (
        <AuthGuard>
            <div className="min-h-screen bg-sand-50 dark:bg-ocean-950 p-4 py-8">
                <div className="max-w-6xl mx-auto">
                    <header className="mb-8">
                        <h1 className="text-3xl font-bold text-ocean-900 dark:text-ocean-100 mb-2">Member Directory</h1>
                        <p className="text-ocean-500 dark:text-ocean-400">Discover and connect with like-minded souls in the network.</p>
                    </header>

                    {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                <div key={i} className="bg-white dark:bg-ocean-900 rounded-2xl p-6 border border-sand-200 dark:border-ocean-800 animate-pulse">
                                    <div className="w-20 h-20 bg-sand-100 dark:bg-ocean-800 rounded-full mx-auto mb-4"></div>
                                    <div className="h-4 bg-sand-100 dark:bg-ocean-800 rounded w-3/4 mx-auto mb-2"></div>
                                    <div className="h-3 bg-sand-100 dark:bg-ocean-800 rounded w-1/2 mx-auto"></div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {members.map(member => (
                                <div
                                    key={member.uid}
                                    className="bg-white dark:bg-ocean-900 rounded-2xl p-6 border border-sand-200 dark:border-ocean-800 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col items-center text-center group"
                                >
                                    <Link href={`/profile/${member.uid}`} className="relative mb-4">
                                        {member.photoURL ? (
                                            <img
                                                src={member.photoURL}
                                                alt={member.displayName}
                                                className="w-24 h-24 rounded-full object-cover border-4 border-sand-50 dark:border-ocean-800 group-hover:border-gold-500 transition-colors"
                                            />
                                        ) : (
                                            <div className="w-24 h-24 rounded-full bg-sand-100 dark:bg-ocean-800 flex items-center justify-center text-3xl font-bold text-ocean-400 border-4 border-sand-50 dark:border-ocean-800 group-hover:border-gold-500 transition-colors">
                                                {member.displayName?.[0] || 'U'}
                                            </div>
                                        )}
                                    </Link>

                                    <h3 className="font-bold text-xl text-ocean-900 dark:text-ocean-100 mb-1 group-hover:text-gold-600 transition-colors">
                                        {member.displayName}
                                    </h3>

                                    {member.bio && (
                                        <p className="text-sm text-ocean-600 dark:text-ocean-300 mb-6 line-clamp-2 italic">
                                            "{member.bio}"
                                        </p>
                                    )}

                                    <div className="flex gap-2 w-full mt-auto">
                                        <Link
                                            href={`/profile/${member.uid}`}
                                            className="flex-grow bg-sand-50 dark:bg-ocean-800 text-ocean-700 dark:text-ocean-200 py-2 px-4 rounded-xl font-bold text-sm hover:bg-sand-100 dark:hover:bg-ocean-700 transition-colors"
                                        >
                                            View Profile
                                        </Link>
                                        {member.uid !== currentUser?.uid && (
                                            <button
                                                onClick={() => handleMessageClick(member.uid, member.displayName, member.photoURL)}
                                                className="bg-gold-500 hover:bg-gold-600 text-ocean-950 p-2 rounded-xl transition-colors shadow-lg shadow-gold-500/10"
                                                title="Direct Message"
                                            >
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AuthGuard>
    );
}
