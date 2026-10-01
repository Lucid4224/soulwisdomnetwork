// The community feed: list posts (Hot, New, Top, or one member's) and create one.
// docs/specs/016-community-feed.md

import { createPost, listPosts, requireMember } from '@/lib/server/community';
import { handle } from '@/lib/server/staff';
import type { FeedSort } from '@/types/community';

export const dynamic = 'force-dynamic';

const SORTS: FeedSort[] = ['hot', 'new', 'top'];

export const GET = handle(async request => {
    const viewer = await requireMember(request);
    const params = new URL(request.url).searchParams;
    const sort = SORTS.find(s => s === params.get('sort')) ?? 'hot';
    return Response.json(await listPosts(viewer, sort, params.get('after'), params.get('author')));
});

// Multipart form: kind, title, body, url, image.
export const POST = handle(async request => {
    const viewer = await requireMember(request);
    return Response.json({ id: await createPost(viewer, await request.formData()) });
});
