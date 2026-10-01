"use client";

import { useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuth } from "@/context/AuthContext";

// The community is for signed-in members who have confirmed their email address (Google
// accounts always have). The server checks the same (lib/server/community.ts); this explains it.
export default function MemberGate({ children }: { children: React.ReactNode }) {
    return <AuthGuard><Verified>{children}</Verified></AuthGuard>;
}

function Verified({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [verified, setVerified] = useState(!!user?.emailVerified);
    const [note, setNote] = useState("");

    if (verified || !user) return <>{children}</>;

    const resend = async () => {
        try {
            await sendEmailVerification(user);
            setNote("Sent. Check your inbox, and your spam folder.");
        } catch {
            setNote("We sent one a moment ago. Wait a minute before asking again.");
        }
    };
    const check = async () => {
        await user.reload();
        if (user.emailVerified) {
            await user.getIdToken(true);    // the server reads "verified" from a fresh token
            setVerified(true);
        } else {
            setNote("Not confirmed yet. Open the link in the email, then press this again.");
        }
    };

    return (
        <div className="min-h-[70vh] flex items-center justify-center p-4 bg-sand-50 dark:bg-ocean-950">
            <div className="max-w-md w-full bg-white dark:bg-ocean-900 rounded-xl border border-sand-200 dark:border-ocean-800 p-6 text-center space-y-4">
                <h1 className="text-xl font-bold text-ocean-900 dark:text-ocean-100">Confirm your email</h1>
                <p className="text-sm text-ocean-600 dark:text-ocean-300">
                    We sent a link to <strong>{user.email}</strong>. Open it to join the conversation.
                    This keeps bots out. Your email is never shown to other members.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={check} className="px-4 py-2 rounded-full bg-gold-500 hover:bg-gold-600 text-ocean-950 text-sm font-bold">I&apos;ve confirmed it</button>
                    <button type="button" onClick={resend} className="px-4 py-2 rounded-full border border-ocean-200 dark:border-ocean-700 text-sm font-bold text-ocean-700 dark:text-ocean-200">Send it again</button>
                </div>
                {note && <p className="text-xs text-ocean-500">{note}</p>}
            </div>
        </div>
    );
}
