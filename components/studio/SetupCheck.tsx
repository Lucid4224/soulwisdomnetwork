"use client";

// Tests every service the Studio relies on (GET /api/studio/health), one line each.

import { useCallback, useEffect, useState } from "react";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { studioFetch } from "@/lib/studioClient";

type Check = { ok: boolean; detail: string };

const LABELS: Record<string, string> = {
    firestore: "Database (Firestore)",
    storage: "Video storage (Cloud Storage)",
    drive: "Google Drive folders",
    github: "Processing jobs (GitHub)",
};

export default function SetupCheck() {
    const [checks, setChecks] = useState<Record<string, Check> | null>(null);
    const [error, setError] = useState("");
    const [checking, setChecking] = useState(false);

    const run = useCallback(async () => {
        setChecking(true);
        setError("");
        try {
            setChecks((await studioFetch<{ checks: Record<string, Check> }>("/api/studio/health")).checks);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => { run(); }, [run]);

    const failing = checks ? Object.values(checks).filter(c => !c.ok).length : 0;

    return (
        <details className="bg-[#1E1035]/50 border border-white/5 rounded-2xl p-5" open={failing > 0}>
            <summary className="cursor-pointer font-semibold flex items-center gap-2">
                Setup check
                {checks && (
                    <span className={`text-xs font-normal ${failing ? "text-red-400" : "text-green-400"}`}>
                        {failing ? `${failing} problem(s)` : "all good"}
                    </span>
                )}
            </summary>
            <div className="mt-4">
                <ErrorNote message={error} className="mb-3" />
                <ul className="divide-y divide-white/5">
                    {Object.entries(LABELS).map(([key, label]) => {
                        const c = checks?.[key];
                        return (
                            <li key={key} className="py-2.5 flex items-start gap-3">
                                <span className={!c ? "text-gray-500" : c.ok ? "text-green-400" : "text-red-400"}>
                                    {!c ? "…" : c.ok ? "✓" : "✗"}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">{label}</p>
                                    <p className="text-xs text-gray-400 break-words">{c?.detail ?? (checking ? "Checking…" : "")}</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
                <button
                    onClick={run}
                    disabled={checking}
                    className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-50"
                >
                    {checking ? "Checking…" : "Check again"}
                </button>
            </div>
        </details>
    );
}
