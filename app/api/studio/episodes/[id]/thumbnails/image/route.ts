import { getThumbnailImage } from '@/lib/server/thumbnails';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

// One thumbnail image by name (frame-0…, ai, approved), for the Studio to draw with.
export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    const name = new URL(request.url).searchParams.get('name') ?? '';
    const { bytes, contentType } = await getThumbnailImage((await params).id, name);
    return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' },
    });
});
