// Checks every service the Podcast Studio depends on, so setup problems show up as one
// clear line each instead of a broken page later.

import { getSettings } from '@/lib/server/studioSettings';
import { checkFolderAccess, isVideo, listFolderFiles } from '@/agent/src/podcast/drive';
import { DRIVE_FOLDERS, studioDrive } from '@/lib/server/drive';
import { adminBucket, adminDb } from '@/lib/server/firebaseAdmin';
import { latestIngestRuns } from '@/lib/server/github';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Check = { ok: boolean; detail: string };

async function check(fn: () => Promise<string>): Promise<Check> {
    try {
        return { ok: true, detail: await fn() };
    } catch (error) {
        return { ok: false, detail: (error as Error).message };
    }
}

export const GET = handle(async request => {
    await requireRole(request, STUDIO_ROLES);

    const [firestore, storage, drive, github] = await Promise.all([
        check(async () => {
            const count = (await adminDb().collection('episodes').count().get()).data().count;
            return `${count} episode(s)`;
        }),
        check(async () => {
            const [files] = await adminBucket().getFiles({ prefix: 'episodes/', maxResults: 1 });
            if (!files.length) return 'Bucket readable (no episode files yet)';
            // Signing needs Service Account Token Creator; the review page uses these links.
            await files[0].getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60_000 });
            return 'Bucket readable, video links can be signed';
        }),
        check(async () => {
            // Drive is optional (Studio settings); without it the Studio works from uploads only.
            if (!(await getSettings()).useDrive) return 'Not used: recordings are uploaded in the Studio';
            const d = studioDrive();
            const parts: string[] = [];
            for (const [label, id] of Object.entries(DRIVE_FOLDERS)) {
                if (!id) { parts.push(`${label}: folder ID not set`); continue; }
                const name = await checkFolderAccess(d, id, label);
                const videos = (await listFolderFiles(d, id)).filter(isVideo).length;
                parts.push(`"${name}": ${videos} video(s)`);
            }
            if (parts.some(p => p.includes('not set'))) throw new Error(parts.join(' · '));
            return parts.join(' · ');
        }),
        check(async () => {
            const [run] = await latestIngestRuns(1);
            return run ? `Last ingest run: ${run.conclusion ?? run.status}, ${run.createdAt}` : 'No ingest runs yet';
        }),
    ]);

    return Response.json({ checks: { firestore, storage, drive, github } });
});
