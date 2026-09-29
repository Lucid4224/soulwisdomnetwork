// Marks an episode Finished in the Podcast Studio (off the Accepted column, into Finished), or
// moves it back. Marking it Finished also posts a report to the Usage page (docs/specs/014-usage.md).

import { FieldValue } from 'firebase-admin/firestore';
import type { Episode } from '@/types/episode';
import { adminDb } from './firebaseAdmin';
import { HttpError } from './staff';
import { postUsage } from './usage';

export async function setFinished(id: string, finished: boolean, user: { uid: string }) {
    if (!/^[\w-]{10,}$/.test(id)) throw new HttpError(400, 'Not a valid episode ID');
    const ref = adminDb().collection('episodes').doc(id);
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new HttpError(404, 'Episode not found');
    if (finished && episode.status !== 'speakers_confirmed') throw new HttpError(409, 'Only accepted episodes can be marked Finished');
    if (!finished) {
        await ref.update({ finished: null, updatedAt: FieldValue.serverTimestamp() });
        return;
    }
    const profile = (await adminDb().collection('users').doc(user.uid).get()).data() ?? {};
    const name = (profile.displayName as string) || (profile.email as string) || 'a producer';
    await ref.update({ finished: { by: { uid: user.uid, name }, at: new Date() }, updatedAt: FieldValue.serverTimestamp() });
    // The report is a side note; a failure here should not undo the move.
    await postUsage(id).catch(error => console.warn(`Usage report for ${id} not posted: ${(error as Error).message}`));
}
