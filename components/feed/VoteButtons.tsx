"use client";

import { useState } from "react";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { studioFetch } from "@/lib/studioClient";
import type { Vote } from "@/types/community";

// Up and down votes on a post or comment. Shows the vote at once and puts it back if the
// server refuses it. `path` is the vote route, e.g. /api/community/posts/<id>/vote.
export default function VoteButtons({ path, score, myVote, vertical = false }: {
    path: string;
    score: number;
    myVote: Vote;
    vertical?: boolean;
}) {
    const [state, setState] = useState({ score, myVote });
    const [busy, setBusy] = useState(false);

    const cast = async (dir: 1 | -1) => {
        if (busy) return;
        const before = state;
        const value: Vote = before.myVote === dir ? 0 : dir;
        setState({ score: before.score + value - before.myVote, myVote: value });
        setBusy(true);
        try {
            setState(await studioFetch<{ score: number; myVote: Vote }>(path, { method: "POST", body: JSON.stringify({ value }) }));
        } catch (error) {
            setState(before);
            alert((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const tone = state.myVote === 1 ? "text-gold-600 dark:text-gold-400" : state.myVote === -1 ? "text-ocean-500" : "text-ocean-800 dark:text-ocean-200";
    return (
        <div className={`flex items-center ${vertical ? "flex-col" : "gap-1"} select-none`}>
            <button type="button" onClick={() => cast(1)} aria-label="Upvote" aria-pressed={state.myVote === 1}
                className={`p-1 rounded hover:bg-sand-100 dark:hover:bg-ocean-800 ${state.myVote === 1 ? "text-gold-600 dark:text-gold-400" : "text-ocean-400 hover:text-gold-600"}`}>
                <ArrowBigUp className="w-6 h-6" fill={state.myVote === 1 ? "currentColor" : "none"} />
            </button>
            <span className={`text-sm font-bold min-w-[2ch] text-center ${tone}`}>{state.score}</span>
            <button type="button" onClick={() => cast(-1)} aria-label="Downvote" aria-pressed={state.myVote === -1}
                className={`p-1 rounded hover:bg-sand-100 dark:hover:bg-ocean-800 ${state.myVote === -1 ? "text-ocean-500" : "text-ocean-400 hover:text-ocean-600"}`}>
                <ArrowBigDown className="w-6 h-6" fill={state.myVote === -1 ? "currentColor" : "none"} />
            </button>
        </div>
    );
}
