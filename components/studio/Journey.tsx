"use client";

// The journey bar: one pill per stage across the Studio pages (Upload → Speakers → Show
// notes → Edit → Publish → Shorts), showing what is done and what is next, with links.

import Link from "next/link";
import { journey, journeyHref, type FinalSource, type JourneyState, type JourneyStatus } from "@/components/studio/steps";

const DONE = "border-emerald-400/60 text-emerald-300";
const CURRENT = "bg-amber-500 text-black font-bold";
const WAITING = "border-white/10 text-gray-400";

const cls = (status: JourneyStatus) =>
    status === "done" ? DONE : status === "current" ? CURRENT : WAITING;

export function Journey({ episodeId, state, source }: { episodeId: string; state: JourneyState; source: FinalSource | null | undefined }) {
    const entries = journey(state);
    return (
        <nav aria-label="Episode progress">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                {entries.map((e, i) => (
                    <li key={e.label} className="flex items-center gap-1.5">
                        <Link
                            href={journeyHref(episodeId, i, source)}
                            aria-current={e.status === "current" ? "step" : undefined}
                            className={`rounded-full border px-2.5 py-0.5 ${cls(e.status)}`}
                        >
                            {e.status === "done" && <span aria-hidden>✓ </span>}
                            {e.label}
                        </Link>
                        {i < entries.length - 1 && <span aria-hidden className="text-gray-600">→</span>}
                    </li>
                ))}
            </ol>
        </nav>
    );
}
