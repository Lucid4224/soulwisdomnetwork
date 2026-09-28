import { getThumbnails, requestThumbnails, saveThumbnailChoices } from '@/lib/server/thumbnails';
import { handle, HttpError, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function body(request: Request) {
    const value = await request.json().catch(() => null);
    if (!value || typeof value !== 'object') throw new HttpError(400, 'Expected a JSON body');
    return value as Record<string, unknown>;
}

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getThumbnails((await params).id));
});

// Makes the thumbnail options, or with { only: 'image', idea, style } just a new AI background.
export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await requestThumbnails((await params).id, await body(request));
    return Response.json({ started: true });
});

// Saves the producer's picks: { text?, frame?, choice? }.
export const PATCH = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await saveThumbnailChoices((await params).id, await body(request));
    return Response.json({ saved: true });
});
