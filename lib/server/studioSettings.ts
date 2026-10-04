// Studio settings on the server (lib/studioSettings.ts): read with the defaults filled in, saved
// by an admin, and shown to the Settings page with short-lived links to the logo and intro.

import { FieldValue } from 'firebase-admin/firestore';
import { SETTINGS_DOC, StudioSettingsSchema, withDefaults, type StudioSettings } from '@/lib/studioSettings';
import { adminBucket, adminDb } from './firebaseAdmin';
import { HttpError } from './staff';

const LINK_MS = 60 * 60_000;

const ref = () => adminDb().collection(SETTINGS_DOC.collection).doc(SETTINGS_DOC.id);

export async function getSettings(): Promise<StudioSettings> {
    return withDefaults((await ref().get()).data());
}

export interface SettingsView {
    settings: StudioSettings;
    logoUrl: string | null;          // signed link to the uploaded logo, if any
    introUrl: string | null;         // signed link to the uploaded intro, if any
}

const signed = (path: string | null) => path
    ? adminBucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + LINK_MS }).then(([u]) => u).catch(() => null)
    : Promise.resolve(null);

export async function getSettingsView(): Promise<SettingsView> {
    const settings = await getSettings();
    const [logoUrl, introUrl] = await Promise.all([signed(settings.logoPath), signed(settings.introPath)]);
    return { settings, logoUrl, introUrl };
}

// Uploaded logos and intros live under settings/ (lib/server/uploads.ts); nothing else may be named.
const ownFile = (path: string | null) => path === null || /^settings\/(logo|intro)-\d+\.(png|jpg|jpeg|mp4|mov)$/i.test(path);

export async function saveSettings(input: unknown, uid: string): Promise<StudioSettings> {
    const parsed = StudioSettingsSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    const s = parsed.data;
    if (!ownFile(s.logoPath) || !ownFile(s.introPath)) throw new HttpError(400, 'Upload the logo and intro on the Settings page');
    if (s.intro === 'custom' && !s.introPath) throw new HttpError(400, 'Upload your intro video, or choose another intro option');
    await ref().set({ ...s, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
    return s;
}
