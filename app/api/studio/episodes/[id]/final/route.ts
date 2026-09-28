import { getFinal, requestFinal } from '@/lib/server/final';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getFinal((await params).id));
});

// Publishes the edited episode from Descript and re-times the show notes on it.
export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    await requestFinal((await params).id);
    return Response.json({ started: true });
});
