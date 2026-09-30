"use client";

// The show notes page's building blocks: a foldable stage whose header says where it stands even
// when folded, the parts inside a stage, and the step tracker under the video. One colour per
// state everywhere: green done, gold next (your turn), blue working, red failed, grey not yet.

import type { ReactNode } from "react";
import type { StageId, StageStatus, StepLink } from "@/components/studio/steps";

const PILL: Record<StageStatus, [string, string] | null> = {
    done: ["Done", "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"],
    next: ["Your turn", "bg-amber-500 text-black"],
    working: ["Working…", "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/40"],
    failed: ["Failed", "bg-red-500 text-white"],
    waiting: null,
};

const CARD: Record<StageStatus, string> = {
    done: "border-white/10",
    next: "border-amber-400/60 shadow-[0_10px_40px_-18px_rgba(245,158,11,0.55)]",
    working: "border-sky-400/40",
    failed: "border-2 border-red-500/70",
    waiting: "border-white/5",
};

export function StatusBadge({ status, n, small = false }: { status: StageStatus; n: number; small?: boolean }) {
    const size = small ? "h-6 w-6 text-[11px]" : "h-9 w-9 text-sm";
    const tone = {
        done: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/50",
        next: "bg-amber-500 text-black",
        working: "bg-sky-500/10 text-sky-200",
        failed: "bg-red-500 text-white",
        waiting: "bg-white/5 text-gray-400 ring-1 ring-white/10",
    }[status];
    return (
        <span aria-hidden className={`relative shrink-0 inline-flex items-center justify-center rounded-full font-bold tabular-nums ${size} ${tone}`}>
            {status === "done" ? "✓" : status === "failed" ? "!" : n}
            {status === "working" && <span className="absolute inset-0 rounded-full border-2 border-sky-400 border-t-transparent motion-safe:animate-spin" />}
        </span>
    );
}

export function Stage({ id, n, title, checkpoint, status, summary, links, open, onToggle, intro, children }: {
    id: StageId; n: number; title: string; checkpoint?: string; status: StageStatus; summary: string; links: StepLink[];
    open: boolean; onToggle: () => void; intro?: ReactNode; children: ReactNode;
}) {
    const pill = PILL[status];
    return (
        <section id={id} aria-labelledby={`${id}-title`} className={`rounded-2xl border bg-[#1E1035]/50 scroll-mt-20 transition-colors ${CARD[status]}`}>
            {/* The whole header folds and unfolds; the button inside is what keyboards and screen readers use. */}
            <div onClick={onToggle} className="flex items-center gap-3 sm:gap-4 px-4 py-3.5 sm:px-5 cursor-pointer select-none group">
                <StatusBadge status={status} n={n} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <h2 id={`${id}-title`} className="text-lg font-semibold leading-tight">
                            <button type="button" aria-expanded={open} aria-controls={`${id}-body`}
                                className={`text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 ${status === "waiting" ? "text-gray-300" : "text-gray-50"}`}>
                                {title}
                            </button>
                        </h2>
                        {pill && <span className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${pill[1]}`}>{pill[0]}</span>}
                        {checkpoint && (
                            <span title="A person checks and approves here before anything goes further"
                                className="text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-white/15 text-gray-300">
                                Checkpoint {checkpoint}
                            </span>
                        )}
                    </div>
                    <p className={`text-sm truncate mt-0.5 ${status === "failed" ? "text-red-200" : "text-gray-400"}`}>{summary || "Not started"}</p>
                </div>
                {links.map(l => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        className="hidden md:inline-flex shrink-0 items-center text-sm text-amber-300 hover:text-amber-200 hover:underline whitespace-nowrap">
                        {l.label} ↗
                    </a>
                ))}
                <svg aria-hidden viewBox="0 0 20 20" fill="currentColor"
                    className={`h-5 w-5 shrink-0 text-gray-500 group-hover:text-gray-200 transition-transform ${open ? "rotate-180" : ""}`}>
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
            </div>
            {/* Folded stages stay mounted: each keeps loading and reporting its step. */}
            <div id={`${id}-body`} className={open ? "flex flex-col gap-5 border-t border-white/5 px-4 pt-4 pb-5 sm:px-5" : "hidden"}>
                {intro && <p className="text-sm text-gray-400 leading-relaxed max-w-3xl">{intro}</p>}
                {children}
            </div>
        </section>
    );
}

// A part of a stage, e.g. the chapters within the show notes.
export function Part({ id, title, hint, aside, children }: { id?: string; title: string; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
    return (
        <div id={id} className="flex flex-col gap-3 scroll-mt-36 border-t border-white/5 pt-5 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-gray-100">{title}</h3>
                {aside}
            </div>
            {hint && <p className="-mt-2 text-xs text-gray-400 leading-relaxed max-w-3xl">{hint}</p>}
            {children}
        </div>
    );
}

export interface TrackedStage { id: StageId; n: number; title: string; status: StageStatus; detail: string }

const TRACK_TEXT: Record<StageStatus, [string, string]> = {
    done: ["text-emerald-300/90", ""],
    next: ["text-amber-300 font-semibold", "text-amber-200/90"],
    working: ["text-sky-200", "text-sky-300/90"],
    failed: ["text-red-300 font-bold", "text-red-300"],
    waiting: ["text-gray-400", ""],
};
const TRACK_BAR: Record<StageStatus, string> = {
    done: "bg-emerald-400/80", next: "bg-amber-400", working: "bg-sky-400 motion-safe:animate-pulse", failed: "bg-red-500", waiting: "bg-white/10",
};

// Where the episode stands, under the video: every stage, and what to do next.
export function StepTracker({ stages, onGo }: { stages: TrackedStage[]; onGo: (id: StageId) => void }) {
    const done = stages.filter(s => s.status === "done").length;
    return (
        <nav aria-label="Steps">
            <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-gray-200">Steps</h2>
                <span className="text-xs text-gray-400">{done} of {stages.length} done</span>
            </div>
            <div aria-hidden className="mt-2 flex gap-1">
                {stages.map(s => <span key={s.id} className={`h-1.5 flex-1 rounded-full ${TRACK_BAR[s.status]}`} />)}
            </div>
            <ol className="mt-3">
                {stages.map((s, i) => (
                    <li key={s.id} className="relative pl-9 pb-3 last:pb-0">
                        {i < stages.length - 1 && <span aria-hidden className="absolute left-3 top-6 bottom-0 w-px bg-white/10" />}
                        <a href={`#${s.id}`} onClick={e => { e.preventDefault(); onGo(s.id); }}
                            aria-current={s.status === "next" ? "step" : undefined} className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70">
                            <span className="absolute left-0 top-0"><StatusBadge status={s.status} n={s.n} small /></span>
                            <span className={`block text-sm leading-6 group-hover:underline ${TRACK_TEXT[s.status][0]}`}>{s.title}</span>
                            {s.detail && <span className={`block text-xs leading-snug ${TRACK_TEXT[s.status][1]}`}>{s.detail}</span>}
                        </a>
                    </li>
                ))}
            </ol>
        </nav>
    );
}
