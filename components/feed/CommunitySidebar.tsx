import Link from "next/link";

// About the community and its rules, beside the feed. One community for now.
export default function CommunitySidebar() {
    return (
        <aside className="space-y-4">
            <section className="bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 overflow-hidden">
                <div className="h-10 bg-gradient-to-r from-ocean-700 to-gold-500" />
                <div className="p-4 space-y-3">
                    <h2 className="font-bold text-ocean-900 dark:text-ocean-100">Soul Wisdom Collective</h2>
                    <p className="text-sm text-ocean-600 dark:text-ocean-300">
                        A place for listeners of the Soul Wisdom podcast to share what is moving them:
                        insights, questions, videos and links.
                    </p>
                    <Link href="/dashboard/submit" className="block text-center py-2 rounded-full bg-gold-500 hover:bg-gold-600 text-ocean-950 text-sm font-bold">
                        Create post
                    </Link>
                </div>
            </section>
            <section className="bg-white dark:bg-ocean-900 rounded-lg border border-sand-200 dark:border-ocean-800 p-4">
                <h2 className="text-xs font-bold uppercase tracking-wide text-ocean-500 mb-2">Community rules</h2>
                <ol className="text-sm text-ocean-700 dark:text-ocean-300 space-y-2 list-decimal list-inside">
                    <li>Be kind. Disagree with ideas, not people.</li>
                    <li>Share, don&apos;t sell: no spam or self-promotion.</li>
                    <li>Keep it on soul wisdom and the podcast.</li>
                    <li>Keep other people&apos;s private details private.</li>
                </ol>
            </section>
        </aside>
    );
}
