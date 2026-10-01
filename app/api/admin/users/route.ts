import { listMembers } from '@/lib/server/members';
import { handle, requireRole } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

// Every member with their sign-in email, for the admin console. Admins only.
export const GET = handle(async request => {
    await requireRole(request, ['admin']);
    return Response.json({ members: await listMembers() });
});
