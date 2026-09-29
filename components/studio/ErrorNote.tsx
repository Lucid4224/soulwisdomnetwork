"use client";

// Every error in the Podcast Studio, in one box that is hard to miss: what went wrong in bold,
// what to do about it, and the raw message underneath. Known causes (an account out of
// credits, a key that stopped working, a busy service) are recognised by lib/serviceErrors.ts.
// `tone="warning"` is for a step that finished with part of it missing.

import { explainError } from "@/lib/serviceErrors";

export function ErrorNote({ message, title, tone = "error", className = "" }: {
    message: string | null | undefined;
    title?: string;             // what failed, e.g. "Drafting failed"
    tone?: "error" | "warning";
    className?: string;
}) {
    if (!message) return null;
    const help = explainError(message);
    const colours = tone === "error"
        ? "border-red-500/70 bg-red-950/60 text-red-100"
        : "border-amber-500/70 bg-amber-950/50 text-amber-100";
    const accent = tone === "error" ? "text-red-300" : "text-amber-300";
    const heading = help?.problem ?? title ?? "Something went wrong";
    return (
        <div role="alert" className={`rounded-lg border-2 px-4 py-3 text-sm flex flex-col gap-1 ${colours} ${className}`}>
            <p className={`font-bold text-base ${accent}`}>
                {help?.outOfMoney ? "💳 " : "⚠️ "}
                {title && help ? `${title}: ` : ""}{heading}
            </p>
            {help && <p className="font-semibold">{help.fix}</p>}
            <p className={help ? "text-xs opacity-80 break-words" : "font-semibold break-words"}>
                {help ? `Details: ${message}` : message}
            </p>
        </div>
    );
}
