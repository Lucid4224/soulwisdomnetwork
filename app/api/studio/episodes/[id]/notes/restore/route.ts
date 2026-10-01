import { restoreApproval } from '@/lib/server/notes';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// Body: { version, to }. Makes the earlier approval `to`, which later steps were made from, the
// approved notes again; returns the new version.
export const POST = handle<Context>(async (request, { params }) => {
    const user = await requireRole(request, STUDIO_ROLES);
    const { version, to } = await request.json().catch(() => ({})) as { version?: unknown; to?: unknown };
    return Response.json({ version: await restoreApproval((await params).id, version, to, user) });
});
