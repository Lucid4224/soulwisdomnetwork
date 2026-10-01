"use client";

import { useState } from "react";
import { LIMITS } from "@/lib/community";
import { studioFetch } from "@/lib/studioClient";

// A comment on the post (no parentId) or a reply to a comment.
export default function CommentForm({ postId, parentId = null, onPosted, onCancel, autoFocus = false }: {
    postId: string;
    parentId?: string | null;
    onPosted: () => void;
    onCancel?: () => void;
    autoFocus?: boolean;
}) {
    const [body, setBody] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!body.trim() || busy) return;
        setBusy(true);
        try {
            await studioFetch(`/api/community/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body, parentId }) });
            setBody("");
            onPosted();
        } catch (error) {
            alert((error as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="rounded-lg border border-ocean-200 dark:border-ocean-700 bg-white dark:bg-ocean-950 focus-within:border-gold-500">
            <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                maxLength={LIMITS.comment}
                autoFocus={autoFocus}
                rows={parentId ? 3 : 4}
                placeholder={parentId ? "Write a reply" : "What are your thoughts?"}
                className="w-full bg-transparent px-3 py-2 text-sm text-ocean-900 dark:text-ocean-100 placeholder-ocean-400 outline-none resize-y"
                disabled={busy}
            />
            <div className="flex justify-end gap-2 px-2 pb-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-full text-xs font-bold text-ocean-500 hover:bg-sand-100 dark:hover:bg-ocean-800">Cancel</button>
                )}
                <button type="submit" disabled={!body.trim() || busy}
                    className="px-4 py-1.5 rounded-full text-xs font-bold bg-gold-500 hover:bg-gold-600 text-ocean-950 disabled:opacity-40">
                    {busy ? "Posting…" : parentId ? "Reply" : "Comment"}
                </button>
            </div>
        </form>
    );
}
