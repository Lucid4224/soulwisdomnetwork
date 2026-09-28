import { forgetYoutube, getYoutube, requestYoutube } from '@/lib/server/youtube';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getYoutube((await params).id));
});

// Uploads the approved episode, or updates the video already on YouTube.
export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await requestYoutube((await params).id);
    return Response.json({ started: true });
});

// Forgets the upload (after the video was deleted in YouTube Studio), so the next one is a new video.
export const DELETE = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await forgetYoutube((await params).id);
    return Response.json({ forgotten: true });
});
