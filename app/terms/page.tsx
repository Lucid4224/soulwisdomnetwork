import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
    title: "Terms of Service · Soul Wisdom Collective",
    description: "The terms for using the Soul Wisdom Collective website and community.",
};

export default function TermsPage() {
    return (
        <LegalPage title="Terms of Service" updated="28 September 2026">
            <p className="mt-8">
                These terms cover your use of soulwisdomcollective.com and its community, run by Soul Wisdom Collective
                (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By using the site you agree to them. If you do not agree, please do not use the site.
            </p>

            <h2>Your account</h2>
            <p>
                Keep your sign-in details to yourself and tell us if you think someone else is using your account. You are responsible
                for what is posted from it. You must be at least 13 years old to join.
            </p>

            <h2>Being part of the community</h2>
            <p>This is a place for open, kind conversation about consciousness, meaning and spiritual experience. Please do not:</p>
            <ul>
                <li>harass, threaten or demean anyone, or share someone else&rsquo;s private information;</li>
                <li>post anything unlawful, hateful, sexually explicit, or that infringes someone else&rsquo;s rights;</li>
                <li>spam, advertise without permission, or try to break or misuse the site.</li>
            </ul>
            <p>We may remove content or suspend accounts that break these rules.</p>

            <h2>Your content</h2>
            <p>
                You keep ownership of what you post. You give us permission to store and show it on the site to other members so the
                community can work. You can delete your posts, or ask us to delete your account.
            </p>

            <h2>Our content</h2>
            <p>
                The podcast episodes, show notes, artwork and other material on the site belong to Soul Wisdom Collective or its
                guests and licensors. You may share links to them, but please do not republish them without permission.
            </p>

            <h2>Not professional advice</h2>
            <p>
                Episodes and discussions share personal experiences, beliefs and ideas, including accounts of near-death and spiritual
                experiences. They are not medical, psychological, legal or financial advice. If you are struggling, please reach out to
                a qualified professional or local emergency services.
            </p>

            <h2>YouTube</h2>
            <p>
                Our episodes are published on YouTube, and our production tools use YouTube API Services. Watching or using our
                YouTube content is subject to the{" "}
                <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>.
            </p>

            <h2>The site is provided as it is</h2>
            <p>
                We work to keep the site running and accurate, but we provide it &ldquo;as is&rdquo;, without warranties. To the extent the
                law allows, we are not liable for indirect or consequential losses arising from your use of the site. Nothing in these
                terms limits rights you have that cannot be limited by law.
            </p>

            <h2>Changes</h2>
            <p>
                We may update these terms. We will change the date above and tell members about significant changes. Continuing to use
                the site after that means you accept the new terms.
            </p>

            <h2>Contact</h2>
            <p>Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </LegalPage>
    );
}
