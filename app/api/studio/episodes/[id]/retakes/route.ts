// Why: the API route for retakes (Part I): GET reads what Claude found, POST starts a new search.

import { getRetakes, requestRetakes } from '@/lib/server/claudeEdits';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getRetakes((await params).id));
});

export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await requestRetakes((await params).id);
    return Response.json({ started: true });
});
