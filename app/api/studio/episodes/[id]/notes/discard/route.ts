import { discardChanges } from '@/lib/server/notes';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// Body: { version }. Puts the draft back to the approved notes; returns the new version.
export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    const { version } = await request.json().catch(() => ({})) as { version?: unknown };
    return Response.json({ version: await discardChanges((await params).id, version) });
});
