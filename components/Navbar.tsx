"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase/config";
import { signOut } from "firebase/auth";

export default function Navbar() {
    const { user, profile, loading } = useAuth();
    const pathname = usePathname();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close the avatar menu on outside click or Escape (menu links close it themselves).
    useEffect(() => {
        if (!menuOpen) return;
        const onClick = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [menuOpen]);

    if (loading) return null;

    // Only decides which links to show; the pages and their API routes check roles themselves.
    const isAdmin = profile?.role === "admin";
    const isStudio = isAdmin || profile?.role === "producer";
    const menuItems = user ? [
        { name: "My profile", href: `/profile/${user.uid}` },
        { name: "Edit profile", href: "/profile/edit" },
        ...(isStudio ? [{ name: "Podcast Studio", href: "/admin/podcast" }] : []),
        ...(isAdmin ? [{ name: "Admin console", href: "/admin" }] : []),
    ] : [];

    // Videos are public; the rest is for members.
    const navItems = user ? [
        { name: "Feed", href: "/dashboard" },
        { name: "Videos", href: "/videos" },
        { name: "Members", href: "/members" },
        { name: "Messages", href: "/messages" },
    ] : [{ name: "Videos", href: "/videos" }];

    const links = (spacing: string) => navItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
            <Link
                key={item.href}
                href={item.href}
                className={`${spacing} py-2 rounded-lg text-sm font-bold transition-all ${isActive
                    ? "bg-gold-500/10 text-gold-400"
                    : "text-ocean-300 hover:bg-ocean-900/50 hover:text-gold-300"
                    }`}
            >
                {item.name}
            </Link>
        );
    });

    return (
        <nav className="bg-ocean-950 backdrop-blur-md border-b border-ocean-800/30 px-4 py-3 sticky top-0 z-50 shadow-2xl">
            <div className="max-w-6xl mx-auto flex justify-between items-center">
                <div className="flex items-center gap-4 md:gap-8 min-w-0">
                    <Link href="/" className="flex items-center gap-2 group">
                        <img
                            src="/logo-trimmed.png"
                            alt="Soul Wisdom Collective"
                            className="h-12 md:h-14 w-auto transition-transform group-hover:scale-105"
                        />
                    </Link>

                    {/* On phones members' links get a row of their own (below) */}
                    <div className="hidden md:flex gap-1">{links("px-4")}</div>
                </div>

                <div className="flex items-center gap-2 md:gap-4 shrink-0">
                    {user ? (
                        <>
                            <div
                                ref={menuRef}
                                className="relative"
                                // Hover opens it for a mouse only: on a phone a tap fires both, which
                                // would open the menu and close it again at once.
                                onPointerEnter={e => e.pointerType === "mouse" && setMenuOpen(true)}
                                onPointerLeave={e => e.pointerType === "mouse" && setMenuOpen(false)}
                            >
                                <button
                                    type="button"
                                    onClick={() => setMenuOpen(open => !open)}
                                    aria-haspopup="menu"
                                    aria-expanded={menuOpen}
                                    className="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-ocean-900/50 transition-all border border-transparent hover:border-ocean-800"
                                >
                                    {/* The profile's name and photo, which the member chooses (app/profile/edit). */}
                                    {profile?.photoURL ? (
                                        <img src={profile.photoURL} alt="Profile" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-ocean-700" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-400 font-bold text-xs">
                                            {(profile?.displayName?.[0] || "M").toUpperCase()}
                                        </div>
                                    )}
                                    <span className="hidden md:inline text-sm font-bold text-ocean-100">
                                        {profile?.displayName || "Member"}
                                    </span>
                                    <svg className={`w-3 h-3 text-ocean-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {menuOpen && (
                                    // pt-2 bridges the gap so hover doesn't drop between button and menu.
                                    <div className="absolute right-0 top-full pt-2 w-52" role="menu">
                                        <div className="bg-ocean-950 border border-ocean-800 rounded-xl shadow-2xl py-1 overflow-hidden">
                                            {menuItems.map(item => (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    role="menuitem"
                                                    onClick={() => setMenuOpen(false)}
                                                    className={`block px-4 py-2 text-sm font-bold transition-colors ${pathname === item.href
                                                        ? "text-gold-400 bg-gold-500/10"
                                                        : "text-ocean-200 hover:bg-ocean-900/60 hover:text-gold-300"
                                                        }`}
                                                >
                                                    {item.name}
                                                </Link>
                                            ))}
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => signOut(auth)}
                                                className="w-full text-left px-4 py-2 text-sm font-bold text-ocean-300 hover:bg-red-950/30 hover:text-red-400 transition-colors border-t border-ocean-800/60"
                                            >
                                                Sign out
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* The menu has Sign out too; on phones that is the only one, to save room. */}
                            <button
                                onClick={() => signOut(auth)}
                                className="hidden sm:block p-2 text-ocean-400 hover:text-red-400 transition-colors rounded-lg hover:bg-red-950/20"
                                title="Sign Out"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                        </>
                    ) : (
                        <>
                        <div className="md:hidden">{links("px-3")}</div>
                        <Link
                            href="/login"
                            className="bg-gradient-to-b from-gold-400 to-gold-600 hover:scale-105 active:scale-95 text-ocean-950 font-bold py-2 px-6 rounded-full transition-all text-sm shadow-lg shadow-gold-500/10"
                        >
                            Join / Log In
                        </Link>
                        </>
                    )}
                </div>
            </div>

            {user && (
                <div className="md:hidden max-w-6xl mx-auto mt-2 -mb-1 grid grid-cols-4 gap-1">{links("px-1 text-center")}</div>
            )}
        </nav>
    );
}
