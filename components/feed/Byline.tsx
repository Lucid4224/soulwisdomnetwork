import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import type { Author } from "@/types/community";

// "Name · Team · 3 hours ago". Staff get a badge, so nobody can pass as the hosts by name alone.
export default function Byline({ author, createdAt }: { author: Author | null; createdAt: string }) {
    return (
        <div className="flex items-center gap-1.5 text-xs text-ocean-500 dark:text-ocean-400 min-w-0">
            {author ? (
                <>
                    {author.photoURL ? (
                        <img src={author.photoURL} alt="" className="w-5 h-5 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                        <span className="w-5 h-5 rounded-full bg-sand-200 dark:bg-ocean-800 flex items-center justify-center text-[10px] font-bold text-ocean-500">
                            {author.name[0]?.toUpperCase()}
                        </span>
                    )}
                    <Link href={`/profile/${author.uid}`} className="font-bold text-ocean-800 dark:text-ocean-200 hover:underline truncate">
                        {author.name}
                    </Link>
                    {author.role !== "user" && (
                        <span className="px-1.5 rounded bg-gold-500/15 text-gold-600 dark:text-gold-400 font-bold text-[10px] uppercase tracking-wide">Team</span>
                    )}
                    {author.banned && <span className="text-red-500 font-bold">banned</span>}
                </>
            ) : (
                <span className="italic">[deleted]</span>
            )}
            <span aria-hidden>·</span>
            <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()} className="whitespace-nowrap">
                {formatDistanceToNowStrict(new Date(createdAt), { addSuffix: true })}
            </time>
        </div>
    );
}
