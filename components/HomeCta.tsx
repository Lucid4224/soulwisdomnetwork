"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

// The home page's call to action: join, or go to the feed once signed in; and watch the podcast.
export default function HomeCta() {
    const { user } = useAuth();
    return (
        <div className="pt-4 flex flex-wrap justify-center gap-4">
            <Link
                href={user ? "/dashboard" : "/login"}
                className="px-8 py-4 bg-gradient-to-r from-amber-500 to-yellow-600 text-black font-bold rounded-full hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all hover:scale-105 active:scale-95"
            >
                {user ? "Go to the feed" : "Join the Collective"}
            </Link>
            <Link
                href="/videos"
                className="inline-flex items-center gap-2 px-8 py-4 border border-white/15 text-white font-bold rounded-full hover:border-amber-500/50 hover:bg-white/5 transition-all hover:scale-105 active:scale-95"
            >
                <Play className="w-5 h-5 text-amber-400" fill="currentColor" /> Watch the podcast
            </Link>
        </div>
    );
}
