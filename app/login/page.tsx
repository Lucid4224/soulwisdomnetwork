"use client";

import { useEffect, useState } from "react";
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { auth, db } from "@/lib/firebase/config";
import { useRouter } from "next/navigation";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";

// A banned member's account is disabled (app/api/admin/users/ban).
function message(err: unknown): string {
    const { code, message } = (err ?? {}) as { code?: string; message?: string };
    return code === "auth/user-disabled"
        ? "This account has been banned from the community."
        : message ?? "Something went wrong";
}

// Where to go after signing in: the page that sent them here (components/auth/AuthGuard.tsx),
// if it is on this site, or else the feed.
function nextPage(): string {
    const next = new URLSearchParams(window.location.search).get("next") ?? "";
    return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    // Sign-in is kept in this browser until they sign out, so someone already signed in who
    // opens this page (a bookmark, an old tab) goes straight on. Only who was signed in when
    // the page opened: signing in here sends them on itself, to the right page.
    const { user } = useAuth();
    const [signedInAlready] = useState(() => !!user);
    useEffect(() => {
        if (signedInAlready) router.replace(nextPage());
    }, [signedInAlready, router]);

    const handleGoogleLogin = async () => {
        try {
            setError("");
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Check if user exists in Firestore, if not create doc
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);

            if (!userDoc.exists()) {
                await setDoc(userDocRef, {
                    uid: user.uid,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    createdAt: serverTimestamp(),
                    bio: "",
                    role: "user",
                });
                // New members choose the name others see (it starts as their Google name).
                router.push("/profile/edit?welcome=1");
                return;
            }

            router.push(nextPage());
        } catch (err: any) {
            setError(message(err));
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            let userCredential;
            if (isRegistering) {
                userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                // Create user doc for new email users
                // Not the email's first part: that would show other members part of the address.
                // They choose a name next (app/profile/edit).
                await setDoc(doc(db, "users", user.uid), {
                    uid: user.uid,
                    displayName: `Member ${Math.floor(1000 + Math.random() * 9000)}`,
                    photoURL: null,
                    createdAt: serverTimestamp(),
                    bio: "",
                    role: "user",
                });

                // Send Verification Email
                // The feed opens once the address is confirmed (components/feed/MemberGate.tsx).
                await sendEmailVerification(user);
                router.push("/profile/edit?welcome=1");
                return;
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            router.push(nextPage());
        } catch (err: any) {
            setError(message(err));
        }
    };

    if (signedInAlready) return null;

    return (
        <div className="min-h-screen flex items-center justify-center bg-sand-50 dark:bg-ocean-950 px-4">
            <div className="max-w-md w-full bg-white dark:bg-ocean-900 rounded-xl shadow-2xl p-8 border border-sand-200 dark:border-ocean-800">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-ocean-900 dark:text-ocean-100 mb-2">
                        Welcome to Soul Wisdom
                    </h1>
                    <p className="text-ocean-600 dark:text-ocean-300">
                        Sign in to join the community
                    </p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <button
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 bg-white dark:bg-ocean-800 border border-ocean-200 dark:border-ocean-700 text-ocean-700 dark:text-ocean-200 py-3 rounded-lg hover:bg-sand-50 dark:hover:bg-ocean-700 transition-colors font-medium mb-6"
                >
                    <img
                        src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                        alt="Google"
                        className="w-5 h-5"
                    />
                    Continue with Google
                </button>

                <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-ocean-200 dark:border-ocean-700"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-white dark:bg-ocean-900 text-ocean-500">
                            Or continue with email
                        </span>
                    </div>
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-ocean-700 dark:text-ocean-300 mb-1">
                            Email Address
                        </label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-950 text-ocean-900 dark:text-ocean-100 focus:ring-2 focus:ring-gold-500 focus:border-transparent outline-none transition-all"
                            placeholder="you@example.com"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-700 dark:text-ocean-300 mb-1">
                            Password
                        </label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-950 text-ocean-900 dark:text-ocean-100 focus:ring-2 focus:ring-gold-500 focus:border-transparent outline-none transition-all"
                            placeholder="••••••••"
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-gold-500 hover:bg-gold-600 text-ocean-950 font-bold py-3 rounded-lg transition-colors shadow-lg shadow-gold-500/20"
                    >
                        {isRegistering ? "Sign Up" : "Sign In"}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm text-ocean-600 dark:text-ocean-400">
                    {isRegistering ? "Already have an account?" : "Don't have an account?"}{" "}
                    <button
                        onClick={() => {
                            setIsRegistering(!isRegistering);
                            setError("");
                        }}
                        className="text-gold-600 hover:text-gold-500 font-medium"
                    >
                        {isRegistering ? "Sign In" : "Sign Up"}
                    </button>
                </div>
            </div>
        </div>
    );
}
