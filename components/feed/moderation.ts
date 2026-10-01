import { studioFetch } from "@/lib/studioClient";
import type { Author } from "@/types/community";

// Admins can ban a post's or comment's author from where they see it. Returns true if done.
export async function banAuthor(author: Author): Promise<boolean> {
    if (!confirm(`Ban ${author.name}? They will be signed out and cannot sign in again until an admin unbans them in the Admin console. Their posts stay until you delete them.`)) return false;
    try {
        await studioFetch("/api/admin/users/ban", { method: "POST", body: JSON.stringify({ uid: author.uid, banned: true }) });
        return true;
    } catch (error) {
        alert((error as Error).message);
        return false;
    }
}

export async function shareLink(path: string) {
    const url = `${window.location.origin}${path}`;
    try {
        await navigator.clipboard.writeText(url);
        alert("Link copied. Only signed-in members can open it.");
    } catch {
        prompt("Copy this link:", url);
    }
}
