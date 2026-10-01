"use client";

import { useMemo, useState } from "react";
import { Ban, MessageSquare, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { MAX_DEPTH } from "@/lib/community";
import { studioFetch } from "@/lib/studioClient";
import type { CommunityComment } from "@/types/community";
import Byline from "./Byline";
import CommentForm from "./CommentForm";
import LinkedText from "./LinkedText";
import VoteButtons from "./VoteButtons";
import { banAuthor } from "./moderation";

// Threaded comments, best first (score, then oldest). `onChanged` reloads the post.
export default function CommentTree({ postId, comments, onChanged }: {
    postId: string;
    comments: CommunityComment[];
    onChanged: () => void;
}) {
    const children = useMemo(() => {
        const map = new Map<string | null, CommunityComment[]>();
        for (const c of comments) map.set(c.parentId, [...(map.get(c.parentId) ?? []), c]);
        for (const list of map.values()) list.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
        return map;
    }, [comments]);

    const top = children.get(null) ?? [];
    if (!top.length) return <p className="text-sm text-ocean-500 dark:text-ocean-400 py-6 text-center">No comments yet. Start the conversation.</p>;
    return (
        <div className="space-y-4">
            {top.map(c => <Comment key={c.id} comment={c} replies={children} postId={postId} onChanged={onChanged} />)}
        </div>
    );
}

function Comment({ comment, replies, postId, onChanged }: {
    comment: CommunityComment;
    replies: Map<string | null, CommunityComment[]>;
    postId: string;
    onChanged: () => void;
}) {
    const { profile } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const [replying, setReplying] = useState(false);
    const [banned, setBanned] = useState(comment.author?.banned ?? false);
    const kids = replies.get(comment.id) ?? [];
    const author = comment.author;

    const remove = async () => {
        if (!confirm("Delete this comment?")) return;
        try {
            await studioFetch(`/api/community/comments/${comment.id}`, { method: "DELETE" });
            onChanged();
        } catch (error) {
            alert((error as Error).message);
        }
    };

    const action = "flex items-center gap-1 px-1.5 py-1 rounded text-xs font-bold text-ocean-500 dark:text-ocean-400 hover:bg-sand-100 dark:hover:bg-ocean-800";
    return (
        <div>
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
                    className="text-[10px] font-mono text-ocean-400 hover:text-gold-600 w-4" title={collapsed ? "Show" : "Hide"}>
                    {collapsed ? "[+]" : "[–]"}
                </button>
                <Byline author={author ? { ...author, banned } : null} createdAt={comment.createdAt} />
                {collapsed && kids.length > 0 && <span className="text-xs text-ocean-400">({kids.length} {kids.length === 1 ? "reply" : "replies"})</span>}
            </div>
            {!collapsed && (
                <div className="ml-2 pl-4 border-l-2 border-sand-200 dark:border-ocean-800 hover:border-gold-500/40">
                    {comment.deleted
                        ? <p className="text-sm italic text-ocean-400 py-1">[deleted]</p>
                        : <LinkedText text={comment.body} className="text-sm text-ocean-800 dark:text-ocean-200 py-1" />}
                    {!comment.deleted && (
                        <div className="flex flex-wrap items-center gap-1 -ml-1.5">
                            <VoteButtons path={`/api/community/comments/${comment.id}/vote`} score={comment.score} myVote={comment.myVote} />
                            {comment.depth < MAX_DEPTH && (
                                <button type="button" onClick={() => setReplying(!replying)} className={action}>
                                    <MessageSquare className="w-3.5 h-3.5" /> Reply
                                </button>
                            )}
                            {comment.canDelete && (
                                <button type="button" onClick={remove} className={`${action} hover:text-red-600`}>
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                </button>
                            )}
                            {profile?.role === "admin" && author && author.role === "user" && !banned && author.uid !== profile.uid && (
                                <button type="button" onClick={async () => setBanned(await banAuthor(author))} className={`${action} hover:text-red-600`}>
                                    <Ban className="w-3.5 h-3.5" /> Ban
                                </button>
                            )}
                        </div>
                    )}
                    {replying && (
                        <div className="my-2">
                            <CommentForm postId={postId} parentId={comment.id} autoFocus
                                onCancel={() => setReplying(false)}
                                onPosted={() => { setReplying(false); onChanged(); }} />
                        </div>
                    )}
                    {kids.length > 0 && (
                        <div className="space-y-3 mt-2">
                            {kids.map(c => <Comment key={c.id} comment={c} replies={replies} postId={postId} onChanged={onChanged} />)}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
