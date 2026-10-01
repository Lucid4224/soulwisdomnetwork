// One post with all its comments; or delete it (its author or an admin).

import { deletePost, getPost, requireMember } from '@/lib/server/community';
import { handle } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    const viewer = await requireMember(request);
    return Response.json(await getPost(viewer, (await params).id));
});

export const DELETE = handle<Context>(async (request, { params }) => {
    const viewer = await requireMember(request);
    await deletePost(viewer, (await params).id);
    return Response.json({ ok: true });
});
