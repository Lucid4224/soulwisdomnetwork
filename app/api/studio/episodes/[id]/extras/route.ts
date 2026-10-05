// Why: the API route for the social posts and follow-up email — GET reads them, POST requests them.

import { getExtras, requestExtras } from '@/lib/server/extras';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getExtras((await params).id));
});

export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    const id = (await params).id;
    const body = (await request.json().catch(() => null)) ?? {};
    await requestExtras(id, body);
    return Response.json({ started: true });
});
