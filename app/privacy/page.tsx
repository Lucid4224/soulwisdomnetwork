import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
    title: "Privacy Policy · Soul Wisdom Collective",
    description: "How Soul Wisdom Collective collects, uses and protects information.",
};

export default function PrivacyPage() {
    return (
        <LegalPage title="Privacy Policy" updated="28 September 2026">
            <p className="mt-8">
                Soul Wisdom Collective (&ldquo;we&rdquo;, &ldquo;us&rdquo;) runs the Soul Wisdom Collective podcast and the community
                website at soulwisdomcollective.com. This policy explains what information we collect, why, and the choices you have.
                We do not sell personal information, and we do not show advertising on this site.
            </p>

            <h2>Information we collect from members</h2>
            <ul>
                <li><strong>Account details:</strong> your name, email address and profile photo when you sign in with Google, or your
                    email address when you sign up with a password.</li>
                <li><strong>What you add:</strong> your profile (such as a short bio), posts, comments, likes and the private messages
                    you send to other members.</li>
                <li><strong>Technical data:</strong> the sign-in information our hosting provider needs to keep you signed in and the
                    site secure. We do not use advertising or analytics trackers.</li>
            </ul>

            <h2>How we use it</h2>
            <ul>
                <li>To run the community: show your profile and posts to other members, deliver your messages, and let you sign in.</li>
                <li>To keep the site safe and working, and to reply when you contact us.</li>
            </ul>
            <p>Private messages are visible only to the members of that conversation and to the site&rsquo;s administrators when
                needed to deal with abuse.</p>

            <h2>Where it is stored</h2>
            <p>
                The site runs on Google Firebase (Authentication, Cloud Firestore and Cloud Storage), hosted in the United States.
                Google processes this data on our behalf under its own{" "}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>

            <h2>Podcast production</h2>
            <p>
                We record conversations with hosts and guests for the podcast. To produce each episode we use service providers that
                process the recording on our behalf, only to make the show:
            </p>
            <ul>
                <li>Google Drive and Google Cloud, to store recordings and finished episodes;</li>
                <li>AssemblyAI, to transcribe them;</li>
                <li>Anthropic (Claude), to draft show notes, chapters and titles, which people then review;</li>
                <li>OpenAI, to create illustrative images; these never show the likeness of a real person;</li>
                <li>Descript, to edit the episode;</li>
                <li>Resend, to send our own production emails.</li>
            </ul>
            <p>Guests who would like a recording or transcript removed can email us.</p>

            <h2>YouTube and Google API Services</h2>
            <p>
                Our production tools use YouTube API Services to upload episodes, thumbnails and captions to our own YouTube channel,
                and Google Drive to store our production files. They act only on accounts we own and do not collect information about
                YouTube viewers. By watching our videos you are subject to the{" "}
                <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a> and the{" "}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>.
            </p>
            <p>
                Soul Wisdom Collective&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
                <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
                    Google API Services User Data Policy</a>, including the Limited Use requirements. Access granted to our tools can be
                revoked at any time from your{" "}
                <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google Account permissions page</a>.
            </p>

            <h2>How long we keep it</h2>
            <p>
                We keep your account and what you have posted while your account is open. If you ask us to delete your account, we
                delete your profile and personal information within 30 days; posts may be removed or anonymised. Episode recordings
                and production files are kept for as long as the episode is published.
            </p>

            <h2>Your choices and rights</h2>
            <p>
                You can edit your profile at any time. You can ask us for a copy of your information, to correct it, or to delete your
                account by emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Depending on where you live you may have
                further rights under laws such as the GDPR or CCPA, and you can complain to your local data protection authority.
            </p>

            <h2>Children</h2>
            <p>The site is not intended for children under 13, and we do not knowingly collect their information.</p>

            <h2>Changes</h2>
            <p>If we change this policy we will update the date above, and tell members about significant changes.</p>
        </LegalPage>
    );
}
