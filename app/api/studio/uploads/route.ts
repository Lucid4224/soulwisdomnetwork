// Uploads from the Studio (lib/server/uploads.ts). POST { action: 'start', kind, fileName,
// contentType, size } returns a one-time upload link; POST { action: 'finish', episodeId, path,
// title } turns an uploaded recording into an episode. Logos and intros: admins only.
import { finishEpisodeUpload, startUpload } from '@/lib/server/uploads';
import { handle, HttpError, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

export const POST = handle(async request => {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const kind = body.kind;
    await requireRole(request, body.action === 'start' && kind !== 'episode' ? ['admin'] : STUDIO_ROLES);
    if (body.action === 'start') {
        return Response.json(await startUpload(body, request.headers.get('origin') ?? ''));
    }
    if (body.action === 'finish') return Response.json(await finishEpisodeUpload(body));
    throw new HttpError(400, 'Unknown action');
});
