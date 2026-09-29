"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import Link from "next/link";
import { UserProfile, UserRole } from "@/types/user";
import { studioFetch } from "@/lib/studioClient";

export default function AdminPage() {
    const { profile, loading } = useAuth();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);

    useEffect(() => {
        if (!loading && profile?.role === 'admin') {
            fetchUsers();
        }
    }, [loading, profile]);

    const fetchUsers = async () => {
        try {
            const querySnapshot = await getDocs(collection(db, "users"));
            const fetchedUsers = querySnapshot.docs.map(doc => ({
                ...doc.data(),
                uid: doc.id // Ensure ID is captured if not in data
            })) as UserProfile[];
            setUsers(fetchedUsers);
        } catch (error) {
            console.error("Error fetching users:", error);
        } finally {
            setIsLoadingUsers(false);
        }
    };

    // Roles change on the server; members cannot change their own (firestore.rules).
    const changeRole = async (userId: string, role: UserRole) => {
        try {
            await studioFetch("/api/admin/users/role", {
                method: "POST",
                body: JSON.stringify({ uid: userId, role }),
            });
            setUsers(prev => prev.map(u => (u.uid === userId ? { ...u, role } : u)));
        } catch (error) {
            console.error("Error updating role:", error);
            alert(`Failed to update role: ${(error as Error).message}`);
        }
    };

    if (loading) return <div className="p-8 text-center text-white">Loading...</div>;

    if (profile?.role !== 'admin') {
        return (
            <div className="min-h-screen bg-[#130b29] flex items-center justify-center p-4">
                <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-8 max-w-md text-center">
                    <h1 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h1>
                    <p className="text-gray-300">You do not have permission to view this page.</p>
                </div>
            </div>
        );
    }

    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-8">
                <div className="max-w-6xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                        <h1 className="text-3xl font-bold text-amber-400">Admin Console</h1>
                        <div className="flex gap-2">
                            <Link href="/admin/usage" className="text-sm px-4 py-2 rounded-lg border border-white/10 text-gray-300 hover:bg-white/10 transition-colors">
                                Usage
                            </Link>
                            <Link href="/admin/podcast" className="text-sm px-4 py-2 rounded-lg border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-colors">
                                Podcast Studio →
                            </Link>
                        </div>
                    </div>

                    <div className="bg-[#1E1035]/50 border border-white/5 rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-white/5 border-b border-white/10 text-gray-400 text-sm uppercase">
                                        <th className="p-4">User</th>
                                        <th className="p-4">Email</th>
                                        <th className="p-4">Role</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {users.map((user) => (
                                        <tr key={user.uid} className="hover:bg-white/5 transition-colors">
                                            <td className="p-4 font-medium text-white">{user.displayName || 'Anonymous'}</td>
                                            <td className="p-4 text-gray-400">{user.email}</td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${user.role === 'admin'
                                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                                        : user.role === 'producer'
                                                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                    }`}>
                                                    {user.role}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                {user.uid !== profile.uid && ( // Prevent self-demotion
                                                    <select
                                                        value={user.role}
                                                        onChange={e => changeRole(user.uid, e.target.value as UserRole)}
                                                        className="text-xs px-2 py-1.5 rounded-lg bg-[#1E1035] border border-white/10 hover:bg-white/10 transition-colors"
                                                    >
                                                        <option value="user">Member</option>
                                                        <option value="producer">Producer (Podcast Studio)</option>
                                                        <option value="admin">Admin</option>
                                                    </select>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </AuthGuard>
    );
}
