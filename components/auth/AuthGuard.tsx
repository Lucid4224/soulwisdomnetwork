"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !user) {
            // Back to this page after signing in (app/login).
            const here = window.location.pathname + window.location.search;
            router.replace(`/login?next=${encodeURIComponent(here)}`);
        }
    }, [user, loading, router]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen bg-sand-50 dark:bg-ocean-950">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return <>{children}</>;
}
