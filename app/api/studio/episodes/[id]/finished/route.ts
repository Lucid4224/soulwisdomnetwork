import { setFinished } from '@/lib/server/finished';
import { handle, HttpError, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// { finished: true } moves the episode from Accepted to Finished; false moves it back.
export const POST = handle<Context>(async (request, { params }) => {
    const user = await requireRole(request, STUDIO_ROLES);
    const { finished } = await request.json().catch(() => ({})) as { finished?: unknown };
    if (typeof finished !== 'boolean') throw new HttpError(400, 'Say whether it is finished');
    await setFinished((await params).id, finished, user);
    return Response.json({ ok: true });
});
