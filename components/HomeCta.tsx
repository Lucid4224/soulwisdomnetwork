"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

// The home page's call to action: join, or go to the feed once signed in.
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
        </div>
    );
}
