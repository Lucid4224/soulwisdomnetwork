// Studio settings for the GitHub Actions jobs (lib/studioSettings.ts), read from Firestore with
// the defaults filled in, and the Storage bucket of whichever Firebase project the job's service
// account belongs to.

import type { Firestore } from 'firebase-admin/firestore';
import { SETTINGS_DOC, withDefaults, type StudioSettings } from '../../../lib/studioSettings';

export async function loadSettings(db: Firestore): Promise<StudioSettings> {
    return withDefaults((await db.collection(SETTINGS_DOC.collection).doc(SETTINGS_DOC.id).get()).data());
}

// PODCAST_STORAGE_BUCKET when set; otherwise the default bucket of the service account's own
// project, which for Tom's project is the bucket the jobs always used.
export function storageBucket(serviceAccount: { project_id?: string }): string {
    return process.env.PODCAST_STORAGE_BUCKET
        || (serviceAccount.project_id ? `${serviceAccount.project_id}.firebasestorage.app` : 'soulwisdomnetwork.firebasestorage.app');
}
