// What the community routes (app/api/community) send the browser. Posts and comments are
// read and written only through those routes (firestore.rules), never directly.

import type { PostKind } from '@/lib/community';
import type { UserRole } from './user';

export interface Author {
    uid: string;
    name: string;
    photoURL: string | null;
    role: UserRole;
    banned: boolean;
}

export type Vote = -1 | 0 | 1;

export interface CommunityPost {
    id: string;
    title: string;
    body: string;
    kind: PostKind;
    url: string | null;            // link and youtube posts
    youtubeId: string | null;
    imageUrl: string | null;
    author: Author;
    createdAt: string;             // ISO
    score: number;
    commentCount: number;
    myVote: Vote;
    canDelete: boolean;            // the viewer wrote it, or is an admin
}

export interface CommunityComment {
    id: string;
    parentId: string | null;
    body: string;                  // '' once deleted
    author: Author | null;         // null once deleted
    createdAt: string;
    score: number;
    depth: number;
    deleted: boolean;
    myVote: Vote;
    canDelete: boolean;
}

export type FeedSort = 'hot' | 'new' | 'top';
