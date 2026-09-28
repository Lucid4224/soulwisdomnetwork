import { approveEpisode, withdrawApproval } from '@/lib/server/thumbnails';
import { handle, HttpError, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// Checkpoint D: { kind, text, image } with the thumbnail as a base64 JPEG.
export const POST = handle<Context>(async (request, { params }) => {
    const user = await requireRole(request, STUDIO_ROLES);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON body');
    await approveEpisode((await params).id, body, user);
    return Response.json({ approved: true });
});

export const DELETE = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await withdrawApproval((await params).id);
    return Response.json({ withdrawn: true });
});
