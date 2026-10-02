// Editor Light (spec 015): GET and PUT the episode edit, behind NEXT_PUBLIC_EDITOR_LIGHT.
// Matches the notes route pattern: requireRole, version check on PUT (409 on mismatch).
import { handle, requireRole, STUDIO_ROLES, HttpError } from '@/lib/server/staff';
import { adminDb } from '@/lib/server/firebaseAdmin';
import type { EpisodeEdit } from '@/lib/edit';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    const id = (await params).id;
    const doc = await adminDb().collection('episodes').doc(id).get();
    if (!doc.exists) throw new HttpError(404, 'Episode not found');
    return Response.json({ edit: (doc.data() as { edit?: EpisodeEdit }).edit ?? { cuts: [], version: 0 } });
});

export const PUT = handle<Context>(async (request, { params }) => {
    const { uid } = await requireRole(request, STUDIO_ROLES);
    const id = (await params).id;
    const body = await request.json().catch(() => ({})) as { edit?: EpisodeEdit; version?: number };
    if (!body.edit) throw new HttpError(400, 'Missing edit');
    if (body.version === undefined) throw new HttpError(400, 'Missing version');

    const ref = adminDb().collection('episodes').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'Episode not found');

    const current = (snap.data() as { edit?: { version: number } }).edit;
    if (current && body.version !== current.version) {
        throw new HttpError(409, 'Version mismatch — someone else edited');
    }

    const newVersion = (current?.version ?? 0) + 1;
    await ref.update({
        edit: { ...body.edit, version: newVersion, updatedAt: new Date().toISOString(), updatedBy: uid },
    });
    return Response.json({ version: newVersion });
});
