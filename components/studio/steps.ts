// The steps on the show notes page, in order. Each section tells the page whether its step is
// done, and a key that changes whenever its state does (a job finishing, an approval); the page
// uses that to colour the Actions list and to have every other section fetch its view again, so
// a step that becomes possible shows at once instead of after a reload.

import { useEffect } from "react";

export const STEPS = [
    ["notes", "Draft show notes"],
    ["broll", "Generate b-roll images"],
    ["package", "Build the edit package for Descript"],
    ["descript", "Send to Descript"],
    ["final", "Get the final cut from Descript"],
    ["thumbnail", "Thumbnail and approval"],
    ["youtube", "Upload to YouTube"],
    ["shorts", "Make and approve shorts"],
] as const;

export type StepId = (typeof STEPS)[number][0];
export type ReportStep = (step: StepId, done: boolean, key: string) => void;

// Tells the page about a step, and loads the section's view again when another step changes.
export function useStep(o: { step: StepId; done: boolean; key: string | null; report?: ReportStep; revision?: number; enabled: boolean; load: () => unknown }) {
    const { step, done, key, report, revision = 0, enabled, load } = o;
    useEffect(() => {
        if (key !== null) report?.(step, done, key);
    }, [step, done, key, report]);
    useEffect(() => {
        if (enabled && revision) load();
        // Only a new revision reloads; `load` changing is handled by the section's own effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision]);
}
