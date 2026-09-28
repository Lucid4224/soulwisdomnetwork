// Shared layout for the privacy policy and terms (app/privacy, app/terms): plain, readable text.

import Link from "next/link";

export const CONTACT_EMAIL = "soulwisdomcollective@gmail.com";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-[#0a0a0f] text-gray-300">
            <article className="max-w-3xl mx-auto px-4 sm:px-6 py-16 leading-relaxed
                [&_h2]:text-xl [&_h2]:font-heading [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-3
                [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_li]:mb-1.5
                [&_a]:text-amber-300 [&_a:hover]:underline [&_strong]:text-gray-100">
                <h1 className="text-3xl sm:text-4xl font-heading font-bold text-white">{title}</h1>
                <p className="text-sm text-gray-500 mt-2">Last updated {updated}</p>
                {children}
                <p className="mt-12 text-sm text-gray-500">
                    Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our{" "}
                    <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>.
                </p>
            </article>
        </div>
    );
}
