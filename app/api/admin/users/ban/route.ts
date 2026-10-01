// Bans or unbans a member. Admins only. A ban disables their sign-in (Firebase Auth) and
// ends their sessions, and marks the profile so every server route refuses them
// (requireRole) and the rules refuse their messages. Their posts stay until deleted.

import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { handle, HttpError, requireRole } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

export const POST = handle(async request => {
    const caller = await requireRole(request, ['admin']);
    const { uid, banned } = await request.json() as { uid?: string; banned?: boolean };

    if (!uid || typeof banned !== 'boolean') throw new HttpError(400, 'Choose a member');
    if (uid === caller.uid) throw new HttpError(400, 'You cannot ban yourself');

    const ref = adminDb().collection('users').doc(uid);
    const profile = await ref.get();
    if (!profile.exists) throw new HttpError(404, 'Member not found');
    if (banned && profile.get('role') !== 'user') throw new HttpError(400, 'Make them a Member first: staff cannot be banned');

    await adminAuth().updateUser(uid, { disabled: banned });
    if (banned) await adminAuth().revokeRefreshTokens(uid);
    await ref.update(banned
        ? { banned: true, bannedBy: caller.uid, bannedAt: FieldValue.serverTimestamp() }
        : { banned: FieldValue.delete(), bannedBy: FieldValue.delete(), bannedAt: FieldValue.delete() });
    return Response.json({ uid, banned });
});
