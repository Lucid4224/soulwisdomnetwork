// Editor Light (spec 015): where the render of the saved edit stands (GET), and start it (POST).
import { getEditRender, requestEditRender } from '@/lib/server/editRender';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getEditRender((await params).id));
});

// Renders the edit as saved now, in GitHub Actions.
export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await requestEditRender((await params).id);
    return Response.json({ started: true });
});
