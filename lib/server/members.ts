// Members for the admin console (/admin), with their sign-in emails. Emails are not kept on
// users/{uid}, which every signed-in member can read (firestore.rules); they come from Firebase
// Auth here, for admins only. Profiles made before that had an email field: it is removed the
// first time an admin opens the list.

import { FieldValue } from 'firebase-admin/firestore';
import type { Member, UserRole } from '@/types/user';
import { adminAuth, adminDb } from './firebaseAdmin';

export async function listMembers(): Promise<Member[]> {
    const docs = (await adminDb().collection('users').get()).docs;
    const emails = new Map<string, string | null>();
    // Auth answers at most 100 users per call.
    for (let i = 0; i < docs.length; i += 100) {
        const { users } = await adminAuth().getUsers(docs.slice(i, i + 100).map(d => ({ uid: d.id })));
        for (const u of users) emails.set(u.uid, u.email ?? null);
    }

    const old = docs.filter(d => d.get('email') !== undefined);
    for (let i = 0; i < old.length; i += 400) {
        const batch = adminDb().batch();
        for (const d of old.slice(i, i + 400)) batch.update(d.ref, { email: FieldValue.delete() });
        await batch.commit();
    }

    return docs.map(d => ({
        uid: d.id,
        displayName: (d.get('displayName') as string | undefined) ?? null,
        email: emails.get(d.id) ?? null,
        role: (d.get('role') as UserRole | undefined) ?? 'user',
        banned: d.get('banned') === true,
    }));
}
