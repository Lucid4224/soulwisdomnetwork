import Link from 'next/link';
import { Compass, Heart, MessagesSquare, Mic, Radio, Users } from 'lucide-react';
import HomeCta from '@/components/HomeCta';

// The home page: the podcast, the community, the site, and what we hold to.

const MANIFESTO = [
    {
        title: 'We listen first.',
        body: 'Before we answer, advise or compare, we let someone finish. Most people have never been fully heard about the thing that changed them.',
    },
    {
        title: 'Every experience is welcome here.',
        body: 'No one has to prove what happened to them. We can wonder about it together without needing to agree on what it means.',
    },
    {
        title: 'We hold beliefs lightly and people gently.',
        body: 'Curiosity over certainty. You can be a scientist, a mystic, a skeptic or all three, and still belong.',
    },
    {
        title: 'Nobody carries the profound alone.',
        body: 'A near-death experience, a loss, an awakening, a moment that rearranged everything: these can be hard to explain at home. Here you can find people who understand, and take the time you need.',
    },
    {
        title: 'We support; we don’t fix.',
        body: 'We offer company, questions and our own stories, not prescriptions. When someone is struggling, we stay with them.',
    },
    {
        title: 'We practise gratitude in ordinary days.',
        body: 'Many people come back from the edge of life noticing small things: light, a voice, a cup of tea. We share them, and help each other notice more.',
    },
    {
        title: 'We share; we don’t sell.',
        body: 'No pitches, no recruiting, no paid paths to enlightenment. What helped you is a gift, not a product.',
    },
    {
        title: 'We keep each other’s stories safe.',
        body: 'What someone tells us in trust stays with us. Members choose the name they show, and their contact details are never shared.',
    },
];

export default function Home() {
    return (
        <div className="min-h-screen bg-[#130b29] text-gray-100 font-sans selection:bg-amber-500/30">
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] left-[20%] w-[60%] h-[60%] bg-purple-900/20 rounded-full blur-[120px] opacity-40"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-900/10 rounded-full blur-[100px] opacity-30"></div>
            </div>

            <div className="relative z-10 max-w-5xl mx-auto px-6">

                {/* --- Hero --- */}
                <section className="text-center max-w-3xl mx-auto pt-24 pb-20 space-y-6">
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400/80">Soul Wisdom Collective</p>
                    <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight text-white">
                        Some experiences change everything.
                        <span className="block text-amber-400">You don’t have to make sense of them alone.</span>
                    </h1>
                    <p className="text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
                        A podcast and a community for people who have touched something larger than themselves,
                        and for anyone curious about what it means to be alive.
                    </p>
                    <HomeCta />
                </section>

                {/* --- The podcast --- */}
                <section className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-10 items-start py-14 border-t border-white/5">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                        <Mic className="w-6 h-6 text-amber-400" />
                    </div>
                    <div className="space-y-4 max-w-2xl">
                        <h2 className="text-2xl md:text-3xl font-bold text-white">The podcast</h2>
                        <p className="text-gray-300 leading-relaxed">
                            The Soul Wisdom Collective podcast is hosted by Daniel Endy and Tom Wood. In long, unhurried
                            conversations, guests tell what happened to them: near-death experiences, encounters they
                            can’t explain, moments that changed how they see life and death. Then we ask what it
                            taught them, and what it might teach the rest of us.
                        </p>
                        <p className="text-gray-300 leading-relaxed">
                            We come to every story with warmth and curiosity. We don’t tell you what to believe, and we
                            don’t treat anyone’s experience as proof of anything. We just listen closely, and follow the
                            questions where they lead: consciousness, love, purpose, and what matters most.
                        </p>
                    </div>
                </section>

                {/* --- The community --- */}
                <section className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-10 items-start py-14 border-t border-white/5">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
                        <Users className="w-6 h-6 text-purple-300" />
                    </div>
                    <div className="space-y-4 max-w-2xl">
                        <h2 className="text-2xl md:text-3xl font-bold text-white">The community</h2>
                        <p className="text-gray-300 leading-relaxed">
                            The conversation doesn’t end when an episode does. The Collective is a place to keep it going:
                            to share your own story, ask the question you’ve never asked out loud, pass on a video or a
                            book that helped, and find people who have been somewhere similar.
                        </p>
                        <p className="text-gray-300 leading-relaxed">
                            It is for members only, and moderated with care. You choose the name other people see, and
                            your email is never shown to anyone.
                        </p>
                    </div>
                </section>

                {/* --- The site --- */}
                <section className="py-14 border-t border-white/5 space-y-8">
                    <h2 className="text-2xl md:text-3xl font-bold text-white">What you’ll find here</h2>
                    <div className="grid sm:grid-cols-2 gap-4">
                        <Feature href="/dashboard" Icon={MessagesSquare} title="The Feed">
                            Posts from members: stories, questions, images, links and videos. Vote for what moves you,
                            and reply in threads.
                        </Feature>
                        <Feature href="/members" Icon={Users} title="Members">
                            The people of the Collective, each with a short profile in their own words.
                        </Feature>
                        <Feature href="/messages" Icon={Heart} title="Messages">
                            Private conversations with other members, for when a reply in public isn’t enough.
                        </Feature>
                        <Feature href="/signal" Icon={Radio} title="Signal">
                            A selection of videos on consciousness and frontier science from across YouTube, picked to
                            skip the clickbait.
                        </Feature>
                    </div>
                </section>

                {/* --- Manifesto --- */}
                <section className="py-16 border-t border-white/5">
                    <div className="max-w-2xl mb-10 space-y-3">
                        <div className="flex items-center gap-2 text-amber-400">
                            <Compass className="w-5 h-5" />
                            <span className="text-sm font-bold uppercase tracking-[0.2em]">What we hold to</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white">A manifesto for the Collective</h2>
                        <p className="text-gray-300 leading-relaxed">
                            How we hope to be with each other, in the feed, in messages, and beyond the screen.
                        </p>
                    </div>
                    <ol className="grid md:grid-cols-2 gap-x-10 gap-y-8">
                        {MANIFESTO.map((item, i) => (
                            <li key={item.title} className="flex gap-4">
                                <span className="text-2xl font-bold text-amber-400/60 tabular-nums w-8 shrink-0">{i + 1}</span>
                                <div className="space-y-1.5">
                                    <h3 className="text-lg font-bold text-white">{item.title}</h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">{item.body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <p className="mt-12 max-w-2xl text-sm text-gray-400 leading-relaxed border-l-2 border-amber-500/40 pl-4">
                        This community is a place for friendship and shared experience, not a substitute for medical or
                        mental-health care. If you are in crisis or thinking about harming yourself, please contact your
                        local emergency number or a crisis line now. In the US, call or text 988.
                    </p>
                </section>

                {/* --- Closing --- */}
                <section className="text-center py-20 border-t border-white/5 space-y-6">
                    <h2 className="text-3xl md:text-4xl font-bold text-white">Come as you are.</h2>
                    <p className="text-gray-300 max-w-xl mx-auto leading-relaxed">
                        Whether you have a story to tell or just a question you can’t put down, there is a seat for you here.
                    </p>
                    <HomeCta />
                </section>

                <footer className="border-t border-white/5 py-8 text-center text-xs text-gray-600">
                    <p>&copy; 2026 Soul Wisdom Collective. All rights reserved.</p>
                    <div className="flex justify-center gap-4 mt-2">
                        <Link href="/privacy" className="hover:text-gray-400">Privacy Policy</Link>
                        <Link href="/terms" className="hover:text-gray-400">Terms of Service</Link>
                        <a href="mailto:soulwisdomcollective@gmail.com" className="hover:text-gray-400">Contact</a>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function Feature({ href, Icon, title, children }: {
    href: string;
    Icon: typeof Mic;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <Link href={href} className="group p-6 rounded-2xl bg-[#1E1035]/50 border border-white/5 hover:border-amber-500/30 hover:bg-[#1E1035] transition-colors">
            <Icon className="w-5 h-5 text-amber-400 mb-4" />
            <h3 className="text-lg font-bold text-white mb-2 group-hover:text-amber-400 transition-colors">{title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{children}</p>
        </Link>
    );
}
