import { approveShort, getShorts, requestShorts, saveShorts } from '@/lib/server/shorts';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getShorts((await params).id));
});

// Starts a job: { mode: 'titles' | 'render' | 'upload', firstAt?, timeZone? }, or approves one
// short at Checkpoint E: { approve: itemId, approved: boolean }.
export const POST = handle<Context>(async (request, { params }) => {
    const user = await requireRole(request, STUDIO_ROLES);
    const id = (await params).id;
    const body = (await request.json().catch(() => null)) ?? {};
    if (typeof body.approve === 'string') {
        await approveShort(id, { item: body.approve, approved: body.approved === true }, user);
        return Response.json({ approved: body.approved === true });
    }
    await requestShorts(id, body);
    return Response.json({ started: true });
});

// Saves the producer's edits: { version, aspect, items }. Returns the new version.
export const PATCH = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json({ version: await saveShorts((await params).id, await request.json().catch(() => null)) });
});
