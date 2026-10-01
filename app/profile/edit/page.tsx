"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { LIMITS } from "@/lib/community";
import { db } from "@/lib/firebase/config";

// Members choose the name others see, any name they like, and a short bio. Their email and
// sign-in details are never shown (profiles hold no email: firestore.rules).
export default function EditProfilePage() {
    return <AuthGuard><EditProfile /></AuthGuard>;
}

function EditProfile() {
    const { user, profile, refreshProfile } = useAuth();
    const router = useRouter();
    const [name, setName] = useState(profile?.displayName ?? "");
    const [bio, setBio] = useState(profile?.bio ?? "");
    const [removePhoto, setRemovePhoto] = useState(false);
    // New members land here from sign-up (app/login) to pick their name. (This only renders in
    // the browser: AuthProvider waits for sign-in.)
    const [welcome] = useState(() => new URLSearchParams(window.location.search).has("welcome"));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    if (!user) return null;
    const trimmed = name.trim().replace(/\s+/g, " ");
    const problem = trimmed.length < 2 ? "Names need at least 2 characters" : "";

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (problem || busy) return;
        setBusy(true);
        setError("");
        try {
            await updateDoc(doc(db, "users", user.uid), {
                displayName: trimmed,
                bio: bio.trim(),
                ...(removePhoto ? { photoURL: null } : {}),
            });
            await refreshProfile();
            router.push(welcome ? "/dashboard" : `/profile/${user.uid}`);
        } catch (err) {
            setError((err as Error).message);
            setBusy(false);
        }
    };

    const field = "w-full rounded-md border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-950 px-3 py-2 text-ocean-900 dark:text-ocean-100 outline-none focus:border-gold-500";
    return (
        <div className="min-h-screen bg-sand-50 dark:bg-ocean-950 px-4 py-8">
            <form onSubmit={save} className="max-w-lg mx-auto bg-white dark:bg-ocean-900 rounded-xl border border-sand-200 dark:border-ocean-800 p-6 space-y-5">
                <div>
                    <h1 className="text-xl font-bold text-ocean-900 dark:text-ocean-100">{welcome ? "Welcome! Choose your name" : "Edit profile"}</h1>
                    <p className="mt-1 text-sm text-ocean-500 dark:text-ocean-400">
                        This is how other members see you. Use any name you like: it doesn&apos;t have to be your real one.
                        Your email address is never shown to anyone.
                    </p>
                </div>

                <label className="block space-y-1">
                    <span className="text-sm font-bold text-ocean-700 dark:text-ocean-200">Display name</span>
                    <input value={name} onChange={e => setName(e.target.value)} maxLength={LIMITS.name} autoFocus className={field} />
                    {problem && name && <span className="text-xs text-ocean-400">{problem}</span>}
                </label>

                <label className="block space-y-1">
                    <span className="text-sm font-bold text-ocean-700 dark:text-ocean-200">About you <span className="font-normal text-ocean-400">(optional)</span></span>
                    <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={LIMITS.bio} rows={4} className={`${field} resize-y`} />
                    <span className="text-[10px] text-ocean-400">{bio.length}/{LIMITS.bio}</span>
                </label>

                {profile?.photoURL && (
                    <label className="flex items-center gap-3 text-sm text-ocean-700 dark:text-ocean-200">
                        <img src={profile.photoURL} alt="" className={`w-10 h-10 rounded-full object-cover ${removePhoto ? "opacity-30" : ""}`} referrerPolicy="no-referrer" />
                        <input type="checkbox" checked={removePhoto} onChange={e => setRemovePhoto(e.target.checked)} />
                        Don&apos;t show my photo (it came from your Google account)
                    </label>
                )}

                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-2">
                    {!welcome && (
                        <button type="button" onClick={() => router.back()} className="px-4 py-2 rounded-full text-sm font-bold text-ocean-500 hover:bg-sand-100 dark:hover:bg-ocean-800">Cancel</button>
                    )}
                    <button type="submit" disabled={!!problem || busy} className="px-6 py-2 rounded-full bg-gold-500 hover:bg-gold-600 text-ocean-950 text-sm font-bold disabled:opacity-40">
                        {busy ? "Saving…" : "Save"}
                    </button>
                </div>
            </form>
        </div>
    );
}
