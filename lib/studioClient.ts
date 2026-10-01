// Browser helper for the API routes (Studio, admin and community): attaches the signed-in
// user's ID token, which the server verifies (lib/server/staff.ts), and the App Check token
// once App Check is on (lib/server/community.ts).

import { getToken } from 'firebase/app-check';
import { appCheck, auth } from '@/lib/firebase/config';

export async function studioFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const check = appCheck ? await getToken(appCheck).then(t => t.token, () => '') : '';
    const res = await fetch(path, {
        ...init,
        headers: {
            ...init.headers,
            Authorization: `Bearer ${await user.getIdToken()}`,
            ...(check ? { 'X-Firebase-AppCheck': check } : {}),
            // A FormData body sets its own multipart type.
            ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body as T;
}
