// Comment on a post, or reply to a comment: { body, parentId? }.

import { addComment, requireMember } from '@/lib/server/community';
import { handle } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

export const POST = handle<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
    const viewer = await requireMember(request);
    const { body, parentId } = await request.json() as { body?: string; parentId?: string | null };
    return Response.json({ id: await addComment(viewer, (await params).id, String(body ?? ''), parentId || null) });
});
