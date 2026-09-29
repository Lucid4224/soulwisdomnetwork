// Posts to the Usage page (usage_reports in Firestore, shown at /admin/usage): when an
// episode starts (its transcript is ready), what it should take, from the finished episodes;
// when it is on YouTube, what it did take. lib/usage.ts does the sums.

import type { Firestore } from 'firebase-admin/firestore';
import { analyseEpisode, projectUsage, type UsageReport } from '../../../lib/usage';
import type { Episode } from '../../../types/episode';

export const REPORTS = 'usage_reports';

// Never fails the job that calls it: the report is a side note.
export async function postUsageReport(db: Firestore, episodeId: string, kind: UsageReport['kind']) {
    try {
        const episode = (await db.collection('episodes').doc(episodeId).get()).data() as Episode | undefined;
        if (!episode) return;
        const usage = analyseEpisode(episodeId, episode);
        let projection: UsageReport['projection'] = null;
        if (kind === 'started') {
            const finished = await db.collection(REPORTS).where('kind', '==', 'finished').get();
            // The latest finished report per episode.
            const latest = new Map<string, UsageReport>();
            for (const d of finished.docs) {
                const r = d.data() as UsageReport;
                if (r.episodeId !== episodeId && (latest.get(r.episodeId)?.at ?? 0) < r.at) latest.set(r.episodeId, r);
            }
            projection = projectUsage(usage.lengthMinutes, [...latest.values()].map(r => r.usage));
        }
        const report: UsageReport = { episodeId, title: episode.title, kind, at: Date.now(), usage, projection };
        await db.collection(REPORTS).add(report);
        console.log(`  📊 Usage report (${kind}) posted`);
    } catch (error) {
        console.warn(`  ⚠️ Could not post the usage report: ${(error as Error).message}`);
    }
}
