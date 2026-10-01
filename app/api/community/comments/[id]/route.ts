// Delete a comment (its author or an admin).

import { deleteComment, requireMember } from '@/lib/server/community';
import { handle } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

export const DELETE = handle<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
    const viewer = await requireMember(request);
    await deleteComment(viewer, (await params).id);
    return Response.json({ ok: true });
});
