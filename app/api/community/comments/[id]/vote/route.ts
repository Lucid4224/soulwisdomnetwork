// Vote on a comment: { value: 1 | 0 | -1 }.

import { requireMember, vote } from '@/lib/server/community';
import { handle } from '@/lib/server/staff';
import type { Vote } from '@/types/community';

export const dynamic = 'force-dynamic';

export const POST = handle<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
    const viewer = await requireMember(request);
    const { value } = await request.json() as { value?: Vote };
    return Response.json(await vote(viewer, 'comments', (await params).id, value ?? 0));
});
