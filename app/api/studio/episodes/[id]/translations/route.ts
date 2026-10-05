// Why: the API route for caption translations (Part I): GET reads them, POST { languages } starts translating.

import { getTranslations, requestTranslations } from '@/lib/server/claudeEdits';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getTranslations((await params).id));
});

export const POST = handle<Context>(async (request, { params }) => {
    await requireRole(request, STUDIO_ROLES);
    const id = (await params).id;
    const body = (await request.json().catch(() => null)) ?? {};
    await requestTranslations(id, body);
    return Response.json({ started: true });
});
