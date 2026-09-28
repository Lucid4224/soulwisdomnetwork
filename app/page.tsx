import React from 'react';
import Link from 'next/link';
import { BookOpen, Sparkles, Users, Video } from 'lucide-react';

export default function Home() {
    return (
        <div className="min-h-screen bg-[#130b29] text-gray-100 font-sans selection:bg-amber-500/30">

            {/* Background Glows */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] left-[20%] w-[60%] h-[60%] bg-purple-900/20 rounded-full blur-[120px] opacity-40 animate-pulse-slow"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-900/10 rounded-full blur-[100px] opacity-30"></div>
            </div>

            <div className="relative z-10 max-w-7xl mx-auto px-6 py-8 flex flex-col min-h-screen">

                {/* --- Hero Section --- */}
                <div className="text-center space-y-6 max-w-3xl mx-auto mb-24 animate-fade-in-up pt-24">
                    <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-tight">
                        <span className="block text-amber-400">Connect Deeper.</span>
                        <span className="block text-white">Ascend Higher.</span>
                    </h1>

                    <p className="text-lg text-gray-400 max-w-xl mx-auto leading-relaxed">
                        The premier network for spiritual growth, connection, and wisdom. Join a collective dedicated to elevating consciousness.
                    </p>

                    <div className="pt-8 flex justify-center gap-4">
                        <Link href="/login" className="px-8 py-4 bg-gradient-to-r from-amber-500 to-yellow-600 text-black font-bold rounded-full hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all transform hover:scale-105 active:scale-95">
                            Join the Collective
                        </Link>

                        <Link href="/daily" className="px-8 py-4 border border-white/10 text-white font-bold rounded-full hover:bg-white/5 transition-all">
                            Daily Wisdom
                        </Link>
                    </div>
                </div>

                {/* --- Feature Grid --- */}
                <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full mb-32">

                    {/* Card 1: Signal (Curated Wisdom) */}
                    <Link href="/signal" className="group p-8 rounded-2xl bg-[#1E1035]/50 border border-white/5 hover:border-amber-500/30 hover:bg-[#1E1035] transition-all duration-300">
                        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                            <BookOpen className="w-5 h-5 text-amber-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-3 group-hover:text-amber-400 transition-colors">Curated Wisdom</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Access exclusive content, courses, and teachings from world-renowned spiritual masters.
                        </p>
                    </Link>

                    {/* Card 2: Daily (Daily Harvest) */}
                    <Link href="/daily" className="group p-8 rounded-2xl bg-[#1E1035]/50 border border-white/5 hover:border-purple-500/30 hover:bg-[#1E1035] transition-all duration-300">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                            <Sparkles className="w-5 h-5 text-purple-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-3 group-hover:text-purple-400 transition-colors">Daily Deep Harvest</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Wake up to high-signal videos harvested daily by our AI agent. Your morning wisdom routine.
                        </p>
                    </Link>

                    {/* Card 3: Community (Placeholder) */}
                    <div className="group p-8 rounded-2xl bg-[#1E1035]/50 border border-white/5 hover:border-blue-500/30 hover:bg-[#1E1035] transition-all duration-300 cursor-default opacity-80">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center mb-6">
                            <Users className="w-5 h-5 text-blue-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-3">Community Connection</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Find your soul tribe. Connect with like-minded seekers on the same path of ascension.
                        </p>
                    </div>

                </div>

                {/* --- Mission Section --- */}
                <div className="flex justify-end mb-24 max-w-5xl mx-auto w-full">
                    <div className="max-w-md text-right space-y-6">
                        <h2 className="text-2xl font-bold text-amber-400">The Soul Wisdom Mission</h2>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            We believe that we are all interconnected. The Soul Wisdom Network is built to facilitate the flow of ancient wisdom into the modern world.
                        </p>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Our platform uses technology not to distract, but to deepen. Every feature is designed with the intention of supporting your spiritual journey and connecting you with the truth of who you are.
                        </p>
                    </div>
                </div>

                {/* --- Footer --- */}
                <footer className="mt-auto border-t border-white/5 py-8 text-center text-xs text-gray-600">
                    <p>&copy; 2026 Soul Wisdom Network. All rights reserved.</p>
                    <div className="flex justify-center gap-4 mt-2">
                        <Link href="/privacy" className="hover:text-gray-400">Privacy Policy</Link>
                        <Link href="/terms" className="hover:text-gray-400">Terms of Service</Link>
                        <a href="mailto:soulwisdomcollective@gmail.com" className="hover:text-gray-400">Contact</a>
                    </div>
                </footer>

            </div>
        </div>
    );
}
