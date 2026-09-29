// The Usage page: cost and time per episode, and the reports posted when episodes start and
// finish (lib/server/usage.ts). Admins only.

import { getUsage, postUsage } from '@/lib/server/usage';
import { handle, HttpError, requireRole } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

export const GET = handle(async request => {
    await requireRole(request, ['admin']);
    return Response.json(await getUsage());
});

// { episodeId }: post an analysis of that episode as it stands now.
export const POST = handle(async request => {
    await requireRole(request, ['admin']);
    const { episodeId } = await request.json().catch(() => ({})) as { episodeId?: unknown };
    if (typeof episodeId !== 'string') throw new HttpError(400, 'Which episode?');
    await postUsage(episodeId);
    return Response.json({ ok: true });
});
