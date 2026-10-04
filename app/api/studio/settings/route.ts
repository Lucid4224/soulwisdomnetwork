// Studio settings (lib/studioSettings.ts): anyone in the Studio can read them; only an admin
// can change them, since they choose the GitHub repository that runs the jobs.
import { getSettingsView, saveSettings } from '@/lib/server/studioSettings';
import { handle, requireRole, STUDIO_ROLES } from '@/lib/server/staff';

export const dynamic = 'force-dynamic';

export const GET = handle(async request => {
    await requireRole(request, STUDIO_ROLES);
    return Response.json(await getSettingsView());
});

export const PUT = handle(async request => {
    const { uid } = await requireRole(request, ['admin']);
    const body = await request.json().catch(() => ({})) as { settings?: unknown };
    return Response.json({ settings: await saveSettings(body.settings, uid) });
});
