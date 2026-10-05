"use client";

// Studio settings (lib/studioSettings.ts): the show or channel, its speakers, the kind of
// recording and how Claude writes for it, the brand look, the intro and teasers, who makes the
// final cut, and where recordings come from. Everyone in the Studio can see them; an admin saves.
// Part I: captions burned into the render (their look) and the languages captions are translated into.

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/auth/AuthGuard";
import { ErrorNote } from "@/components/studio/ErrorNote";
import { field, hint, primary } from "@/components/studio/ui";
import { UploadAsset } from "@/components/studio/upload";
import { LookFields } from "@/components/studio/onScreen";
import { LANGUAGES, LANGUAGES_MAX } from "@/lib/translate";
import type { CaptionStyle } from "@/lib/onScreen";
import { useAuth } from "@/context/AuthContext";
import { DEFAULT_SETTINGS, FORMAT_LABELS, FORMATS, type StudioSettings } from "@/lib/studioSettings";
import { studioFetch } from "@/lib/studioClient";
import type { SettingsView } from "@/lib/server/studioSettings";

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
    return (
        <section className="bg-[#1E1035]/40 border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
            <header>
                <h2 className="font-semibold text-gray-100">{title}</h2>
                {intro && <p className={`${hint} mt-1`}>{intro}</p>}
            </header>
            {children}
        </section>
    );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-200">{label}</span>
            {children}
            {help && <span className={hint}>{help}</span>}
        </label>
    );
}

function Choice({ name, value, current, label, help, onPick, disabled }: {
    name: string; value: string; current: string; label: string; help?: string; onPick: () => void; disabled: boolean;
}) {
    return (
        <label className="flex items-start gap-2 text-sm text-gray-200">
            <input type="radio" name={name} value={value} checked={current === value} onChange={onPick} disabled={disabled} className="mt-1" />
            <span>{label}{help && <span className={`block ${hint}`}>{help}</span>}</span>
        </label>
    );
}

export default function StudioSettingsPage() {
    const { profile, loading } = useAuth();
    const allowed = profile?.role === "admin" || profile?.role === "producer";
    const isAdmin = profile?.role === "admin";
    const [s, setS] = useState<StudioSettings | null>(null);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [introUrl, setIntroUrl] = useState<string | null>(null);
    const [hostsText, setHostsText] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (loading || !allowed) return;
        studioFetch<SettingsView>("/api/studio/settings")
            .then(v => { setS(v.settings); setLogoUrl(v.logoUrl); setIntroUrl(v.introUrl); setHostsText(v.settings.hosts.join("\n")); })
            .catch(e => setError((e as Error).message));
    }, [loading, allowed]);

    const set = <K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) => {
        setS(prev => (prev ? { ...prev, [key]: value } : prev));
        setNotice("");
        setDirty(true);
    };

    // While there are unsaved changes, ask before leaving the page.
    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    async function save() {
        if (!s) return;
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const hosts = hostsText.split(/\n|,/).map(h => h.trim()).filter(Boolean);
            const saved = await studioFetch<{ settings: StudioSettings }>("/api/studio/settings", {
                method: "PUT",
                body: JSON.stringify({ settings: { ...s, hosts } }),
            });
            setS(saved.settings);
            setHostsText(saved.settings.hosts.join("\n"));
            const v = await studioFetch<SettingsView>("/api/studio/settings");
            setLogoUrl(v.logoUrl);
            setIntroUrl(v.introUrl);
            setNotice("Saved. New jobs use these settings from now on.");
            setDirty(false);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-8 text-center text-white">Loading...</div>;
    if (!allowed) {
        return (
            <div className="min-h-screen bg-[#130b29] flex items-center justify-center p-4">
                <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-8 max-w-md text-center">
                    <h1 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h1>
                    <p className="text-gray-300">The Podcast Studio is for admins and producers.</p>
                </div>
            </div>
        );
    }

    const off = !isAdmin || saving;
    return (
        <AuthGuard>
            <div className="min-h-screen bg-[#130b29] text-gray-100 p-4 sm:p-8">
                <div className="max-w-3xl mx-auto flex flex-col gap-6">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-amber-400">Studio settings</h1>
                            <p className={`${hint} mt-1`}>
                                Everything here was fixed to one podcast before. Each choice starts at what the Studio always did; change what fits your show or channel.
                                {!isAdmin && " Only an admin can save changes."}
                            </p>
                        </div>
                        <Link href="/admin/podcast" className="text-sm text-gray-400 hover:text-white">← Studio</Link>
                    </div>
                    <ErrorNote message={error} />
                    {!s ? <p className={hint}>Loading…</p> : (
                        <>
                            <Section title="Show or channel" intro="Used in Claude's writing, the YouTube description and the emails.">
                                <Field label="Name"><input className={field} value={s.showName} onChange={e => set("showName", e.target.value)} disabled={off} maxLength={80} /></Field>
                                <Field label="What it is about" help='Finishes the sentence "The show …", e.g. "explores how small teams build products".'>
                                    <input className={field} value={s.about} onChange={e => set("about", e.target.value)} disabled={off} maxLength={300} />
                                </Field>
                                <Field label="Who it is for" help='Finishes "… for …", e.g. "founders and product leads". Leave empty to skip.'>
                                    <input className={field} value={s.audience} onChange={e => set("audience", e.target.value)} disabled={off} maxLength={200} />
                                </Field>
                                <Field label="Website" help="Named in every YouTube description. Leave empty for no website line.">
                                    <input className={field} value={s.siteUrl} onChange={e => set("siteUrl", e.target.value)} disabled={off} placeholder="https://" />
                                </Field>
                                <Field label="Words before the website link">
                                    <input className={field} value={s.siteLinkText} onChange={e => set("siteLinkText", e.target.value)} disabled={off} maxLength={120} />
                                </Field>
                                <Field label="Subscribe line" help="Added after the chapters. Leave empty for none.">
                                    <input className={field} value={s.subscribeLine} onChange={e => set("subscribeLine", e.target.value)} disabled={off} maxLength={200} />
                                </Field>
                                <Field label="This Studio's web address" help="Used for the links in emails, e.g. https://yoursite.com.">
                                    <input className={field} value={s.studioUrl} onChange={e => set("studioUrl", e.target.value)} disabled={off} placeholder="https://" />
                                </Field>
                            </Section>

                            <Section title="Speakers" intro="Names that are always offered when the transcript is made, and on the speaker review page. One per line. Others are named during speaker review.">
                                <textarea className={`${field} min-h-24`} value={hostsText} onChange={e => { setHostsText(e.target.value); setNotice(""); setDirty(true); }} disabled={off} aria-label="Speaker names" />
                            </Section>

                            <Section title="Kind of recording and writing" intro="Shapes how Claude writes the show notes, chapters, YouTube description, Shorts and thumbnail text.">
                                <div className="flex flex-col gap-2">
                                    {FORMATS.map(f => <Choice key={f} name="format" value={f} current={s.format} label={FORMAT_LABELS[f]} onPick={() => set("format", f)} disabled={off} />)}
                                </div>
                                <Field label="YouTube descriptions to choose from" help="Claude writes this many, each from a different angle; you pick one on the show notes page.">
                                    <select value={s.descriptionChoices} onChange={e => set("descriptionChoices", Number(e.target.value))} disabled={off} className={field}>
                                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </Field>
                                <Field label="Extra instructions for all writing" help='Anything Claude should always do, e.g. "List action items with their owners" or "Keep descriptions under 150 words".'>
                                    <textarea className={`${field} min-h-28`} value={s.extraInstructions} onChange={e => set("extraInstructions", e.target.value)} disabled={off} maxLength={3000} />
                                </Field>
                            </Section>

                            <Section title="Look" intro="Colours and logo for Shorts and thumbnails, and the style of AI images.">
                                <div className="flex flex-wrap gap-6">
                                    {([["background", "Background (top)"], ["backgroundBottom", "Background (bottom)"], ["accent", "Accent (highlighted words, lines)"]] as const).map(([k, label]) => (
                                        <label key={k} className="flex items-center gap-2 text-sm text-gray-200">
                                            <input type="color" value={s.colors[k]} onChange={e => set("colors", { ...s.colors, [k]: e.target.value })} disabled={off} aria-label={label} />
                                            {label}
                                        </label>
                                    ))}
                                </div>
                                <div className="flex flex-wrap items-center gap-4">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={logoUrl ?? "/logo.png"} alt="Logo" className="w-16 h-16 object-contain rounded bg-black/30" />
                                    <div className="flex flex-col gap-1">
                                        {isAdmin && <UploadAsset kind="logo" label="Upload a logo (square PNG)" accept="image/png,image/jpeg" onUploaded={p => { set("logoPath", p); setLogoUrl(null); setNotice("Logo uploaded. Press Save to use it."); }} />}
                                        {s.logoPath && isAdmin && <button className="text-xs text-gray-400 hover:text-white self-start" onClick={() => { set("logoPath", null); setLogoUrl(null); }}>Use the site&apos;s logo instead</button>}
                                    </div>
                                </div>
                                <Field label="AI image style" help="Describes the look of AI b-roll and thumbnail images. Leave empty for the built-in Soul Wisdom styles.">
                                    <textarea className={`${field} min-h-24`} value={s.imageStyle} onChange={e => set("imageStyle", e.target.value)} disabled={off} maxLength={1500}
                                        placeholder="e.g. Clean, bright, modern office photography, soft daylight, blue and white palette." />
                                </Field>
                                {/* Part H: also make each b-roll moment as an AI video clip (OpenAI Sora). */}
                                <label className="flex items-start gap-2 text-sm text-gray-200">
                                    <input type="checkbox" checked={s.brollVideo} onChange={e => set("brollVideo", e.target.checked)} disabled={off} className="mt-1" />
                                    <span>Also make each b-roll moment as an AI video clip (OpenAI Sora)<span className={`block ${hint}`}>About $0.80 for an 8-second clip, on the OpenAI key; the account needs at least $10 of API credit for Sora. The Editor Light render uses the clip in place of the still; if a clip fails, the still is used.</span></span>
                                </label>
                            </Section>

                            {/* Part H: background music for the Editor Light render. */}
                            <Section title="Background music" intro="Plays quietly under the episode in the Editor Light render and dips whenever someone speaks. Teasers, intro and outro keep their own sound.">
                                <div className="flex flex-col gap-2">
                                    <Choice name="music" value="none" current={s.music} label="No music" disabled={off} onPick={() => set("music", "none")} />
                                    <Choice name="music" value="upload" current={s.music} label="My own music track" disabled={off} onPick={() => set("music", "upload")} />
                                    <Choice name="music" value="generate" current={s.music} label="Music composed by AI (ElevenLabs)" disabled={off} onPick={() => set("music", "generate")} />
                                </div>
                                {s.music === "upload" && (
                                    <div className="flex flex-col gap-2 pl-6">
                                        {s.musicPath && <p className={hint}>A track is uploaded. Use music you have the rights to; YouTube may claim music that is not yours.</p>}
                                        {isAdmin && (
                                            <UploadAsset kind="music" label={s.musicPath ? "Replace the track (MP3, M4A or WAV)" : "Upload a track (MP3, M4A or WAV)"}
                                                accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac"
                                                onUploaded={p => { set("musicPath", p); setNotice("Track uploaded. Press Save to use it."); }} />
                                        )}
                                    </div>
                                )}
                                {s.music === "generate" && (
                                    <div className="flex flex-col gap-2 pl-6">
                                        <Field label="What the music should sound like" help="Composed as an instrumental, three minutes long, looped under the episode. It needs the ELEVENLABS_API_KEY secret in GitHub; without it the render has no music and says so.">
                                            <textarea className={`${field} min-h-24`} value={s.musicPrompt} onChange={e => set("musicPrompt", e.target.value)} disabled={off} maxLength={500} />
                                        </Field>
                                    </div>
                                )}
                                {s.music !== "none" && (
                                    <Field label="How loud the music is" help="How far under the voice it sits. -24 dB is a gentle bed.">
                                        <select value={s.musicVolumeDb} onChange={e => set("musicVolumeDb", Number(e.target.value))} disabled={off} className={field}>
                                            <option value={-30}>-30 dB</option>
                                            <option value={-27}>-27 dB</option>
                                            <option value={-24}>-24 dB (suggested)</option>
                                            <option value={-21}>-21 dB</option>
                                            <option value={-18}>-18 dB</option>
                                        </select>
                                    </Field>
                                )}
                            </Section>

                            {/* Part I: captions burned into the Editor Light render, and the languages they are translated into. */}
                            <Section title="Captions" intro="Captions burned into the picture help the many people who watch with the sound off. Each video can change this in the full-page editor's On screen panel.">
                                <label className="flex items-center gap-2 text-sm text-gray-200">
                                    <input type="checkbox" checked={s.burnCaptions} onChange={e => set("burnCaptions", e.target.checked)} disabled={off} />
                                    Burn captions into the Editor Light render
                                </label>
                                <fieldset disabled={off} className="flex flex-col gap-1">
                                    <span className="text-sm text-gray-200">How they look</span>
                                    <LookFields look={s.captionStyle} onChange={c => set("captionStyle", { ...s.captionStyle, ...c } as CaptionStyle)} />
                                    <span className={hint}>Font, size, colour, background and position. The full-page editor shows them over the video as it plays.</span>
                                </fieldset>
                                <fieldset disabled={off} className="flex flex-col gap-1">
                                    <span className="text-sm text-gray-200">Languages to translate the captions into</span>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-sm text-gray-200">
                                        {LANGUAGES.map(l => (
                                            <label key={l.code} className="flex items-center gap-2">
                                                <input type="checkbox" checked={s.captionLanguages.includes(l.code)}
                                                    onChange={() => set("captionLanguages", s.captionLanguages.includes(l.code)
                                                        ? s.captionLanguages.filter(c => c !== l.code)
                                                        : s.captionLanguages.length < LANGUAGES_MAX ? [...s.captionLanguages, l.code] : s.captionLanguages)} />
                                                {l.name}
                                            </label>
                                        ))}
                                    </div>
                                    <span className={hint}>Ticked first on each episode&apos;s show notes page, where Claude translates the final cut&apos;s captions, title and description (about $0.40 a language). Each goes to YouTube as its own caption track.</span>
                                </fieldset>
                            </Section>

                            <Section title="Finished video" intro="What plays around the episode, and who makes the final cut.">
                                <div className="flex flex-col gap-2">
                                    <Choice name="intro" value="show" current={s.intro} label="The show's intro at the start and end" disabled={off} onPick={() => set("intro", "show")} />
                                    <Choice name="intro" value="custom" current={s.intro} label="My own intro at the start and end" disabled={off} onPick={() => set("intro", "custom")} />
                                    <Choice name="intro" value="none" current={s.intro} label="No intro" disabled={off} onPick={() => set("intro", "none")} />
                                </div>
                                {s.intro === "custom" && (
                                    <div className="flex flex-col gap-2 pl-6">
                                        {introUrl && <video src={introUrl} controls className="w-64 rounded" />}
                                        {s.introPath && !introUrl && <p className={hint}>Intro uploaded. Press Save to use it.</p>}
                                        {isAdmin && <UploadAsset kind="intro" label={s.introPath ? "Replace my intro (MP4)" : "Upload my intro (MP4)"} accept="video/mp4,video/quicktime" onUploaded={p => { set("introPath", p); setIntroUrl(null); }} />}
                                    </div>
                                )}
                                <label className="flex items-start gap-2 text-sm text-gray-200">
                                    <input type="checkbox" checked={s.teasers} onChange={e => set("teasers", e.target.checked)} disabled={off} className="mt-1" />
                                    <span>&ldquo;In this episode&rdquo; teaser clips before the intro<span className={`block ${hint}`}>Taken from the teaser clips in the approved show notes.</span></span>
                                </label>
                                <div className="flex flex-col gap-2">
                                    <Choice name="final" value="descript" current={s.finalSource} label="Descript makes the final cut" disabled={off} onPick={() => set("finalSource", "descript")}
                                        help="The edit happens in Descript and the final cut is published from there." />
                                    <Choice name="final" value="editorLight" current={s.finalSource} label="Editor Light makes the final cut" disabled={off} onPick={() => set("finalSource", "editorLight")}
                                        help="Edit in “Edit here instead” on the show notes page and press “Render this edit”. Thumbnails, Shorts and the YouTube upload then use that video. No Descript needed." />
                                </div>
                            </Section>

                            <Section title="Behind the scenes" intro="Leave these as they are unless you run your own copy of the Studio.">
                                <label className="flex items-start gap-2 text-sm text-gray-200">
                                    <input type="checkbox" checked={s.useDrive} onChange={e => set("useDrive", e.target.checked)} disabled={off} className="mt-1" />
                                    <span>Recordings also come in through Google Drive<span className={`block ${hint}`}>Turn off to work only with recordings uploaded on the Studio page.</span></span>
                                </label>
                                <Field label="GitHub repository that runs the jobs" help="owner/repository, e.g. yourname/soulwisdomnetwork.">
                                    <input className={field} value={s.githubRepo} onChange={e => set("githubRepo", e.target.value)} disabled={off} />
                                </Field>
                            </Section>

                            {isAdmin && (
                                <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#130b29]/95 backdrop-blur px-4 py-3 sm:rounded-xl">
                                    <button onClick={() => void save()} disabled={saving} className={primary}>{saving ? "Saving…" : "Save settings"}</button>
                                    <button onClick={() => { setS({ ...DEFAULT_SETTINGS }); setHostsText(DEFAULT_SETTINGS.hosts.join("\n")); setNotice("Back to the original settings. Press Save to keep them."); setDirty(true); }}
                                        className="text-xs text-gray-400 hover:text-white">Reset to the original settings</button>
                                    {notice
                                        ? <span className="text-sm text-green-300">{notice}</span>
                                        : dirty && <span className="text-sm text-amber-300">Unsaved changes</span>}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </AuthGuard>
    );
}
