// The steps on the show notes page, in order, and the six foldable stages they are grouped in.
// Each section tells the page where its step stands (done, working, failed, a one-line summary
// for the folded stage header) and a key that changes whenever its state does (a job finishing,
// an approval); the page uses that to colour the step tracker, open the stage that needs the
// producer, and have every other section fetch its view again, so a step that becomes possible
// shows at once instead of after a reload.

import { useEffect } from "react";
import { explainError } from "@/lib/serviceErrors";

export const STEPS = [
    ["notes", "Approve the show notes"],
    ["broll", "Generate b-roll images"],
    ["package", "Build the edit package"],
    ["descript", "Send to Descript"],
    ["final", "Get the final cut from Descript"],
    ["thumbnail", "Pick a thumbnail and approve the episode"],
    ["youtube", "Upload to YouTube"],
    ["shorts", "Make and schedule shorts"],
] as const;

export type StepId = (typeof STEPS)[number][0];

export const STAGES = [
    { id: "notes", title: "Show notes", steps: ["notes"], checkpoint: "B" },
    { id: "broll", title: "B-roll", steps: ["broll"] },
    { id: "package", title: "Edit package and Descript", steps: ["package", "descript"] },
    { id: "final", title: "Final cut", steps: ["final"] },
    { id: "thumbnail", title: "Thumbnail and upload", steps: ["thumbnail", "youtube"], checkpoint: "D" },
    { id: "shorts", title: "Shorts", steps: ["shorts"], checkpoint: "E" },
] as const satisfies readonly { id: string; title: string; steps: readonly StepId[]; checkpoint?: string }[];

export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = "done" | "next" | "working" | "failed" | "waiting";

export const stageOf = (step: StepId) => STAGES.find(s => (s.steps as readonly StepId[]).includes(step))!;
export const stepLabel = (step: StepId) => STEPS.find(([id]) => id === step)![1];

export interface StepLink { label: string; href: string }
export interface StepState {
    done: boolean;
    failed: boolean;
    working: boolean;
    summary: string;            // one line for the folded stage header
    link: StepLink | null;      // a shortcut shown on the stage header, e.g. the Descript project
    key: string;
}
export type ReportStep = (step: StepId, state: StepState) => void;

// Tells the page about a step, and loads the section's view again when another step changes.
export function useStep(o: {
    step: StepId; done: boolean; failed?: boolean; working?: boolean; summary?: string; link?: StepLink | null;
    key: string | null; report?: ReportStep; revision?: number; enabled: boolean; load: () => unknown;
}) {
    const { step, done, failed = false, working = false, summary = "", link = null, key, report, revision = 0, enabled, load } = o;
    const linkLabel = link?.label, linkHref = link?.href;
    useEffect(() => {
        if (key === null) return;
        report?.(step, { done, failed, working, summary, link: linkLabel && linkHref ? { label: linkLabel, href: linkHref } : null, key });
    }, [step, done, failed, working, summary, linkLabel, linkHref, key, report]);
    useEffect(() => {
        if (enabled && revision) load();
        // Only a new revision reloads; `load` changing is handled by the section's own effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision]);
}

// A failed step's summary: what failed and, when known, why ("Descript is out of credits").
export function failure(what: string, error: string | null | undefined) {
    const problem = explainError(error)?.problem;
    return problem ? `${what} failed: ${problem}` : `${what} failed`;
}

// Where a stage stands, from its steps. A failure or a running job shows first.
export function stageStatus(steps: readonly StepId[], states: Partial<Record<StepId, StepState>>, next: StepId | undefined): StageStatus {
    const s = steps.map(id => states[id]);
    if (s.some(x => x?.failed)) return "failed";
    if (s.some(x => x?.working)) return "working";
    if (s.every(x => x?.done)) return "done";
    if (next && steps.includes(next)) return "next";
    return "waiting";
}
