// Drafts show notes for one episode with several models or effort levels and emails a
// side-by-side report. Read-only: nothing on the episode changes. Runs in GitHub Actions
// (.github/workflows/podcast_notes_compare.yml), started by hand from the Actions tab.
//
// NOTES_RUNS lists model:effort pairs, e.g. "claude-opus-5:high,claude-opus-5-5:medium".

import Anthropic from '@anthropic-ai/sdk';
import { appendFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { mmss, StoredShowNotesSchema, type ShowNotes } from '../../../lib/showNotes';
import type { Episode } from '../../../types/episode';
import { loadAlert } from './config';
import { draftNotes, type Draft, type Effort, type ReviewedLine } from './notesDraft';
import { sendEmail } from './notify';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

const episodeId = required('EPISODE_ID');
if (!/^[\w-]{10,}$/.test(episodeId)) throw new Error(`Not a valid episode ID: ${episodeId}`);
const runs = (process.env.NOTES_RUNS || 'claude-opus-5:high,claude-opus-5-5:medium,claude-opus-5-5:high')
    .split(',').map(r => r.trim()).filter(Boolean).map(r => {
        const [model, effort = 'high'] = r.split(':').map(s => s.trim());
        if (!/^claude-[a-z0-9-]+$/.test(model) || !EFFORTS.includes(effort as Effort)) throw new Error(`Not a valid run: ${r}`);
        return { model, effort: effort as Effort, label: `${model} · ${effort}` };
    });
if (!runs.length || runs.length > 6) throw new Error('Give between one and six runs');
initializeApp({
    credential: cert(JSON.parse(required('PODCAST_SA_JSON'))),
    storageBucket: process.env.PODCAST_STORAGE_BUCKET || 'soulwisdomnetwork.firebasestorage.app',
});

type Column = { label: string; notes: ShowNotes; draft?: Draft };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const secs = (a: number, b: number) => `${Math.round((b - a) / 1000)}s`;

function section(title: string, columns: Column[], render: (n: ShowNotes) => string) {
    return `<h2>${esc(title)}</h2><div class="row">${columns.map(c =>
        `<div class="col"><h3>${esc(c.label)}</h3>${render(c.notes)}</div>`).join('')}</div>`;
}

function report(episode: Episode, columns: Column[]) {
    const list = (items: string[]) => `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
    const stats = columns.map(c => {
        const d = c.draft;
        const clipSecs = c.notes.teaserClips.reduce((t, x) => t + (x.endMs - x.startMs), 0) / 1000;
        return `<tr><td>${esc(c.label)}</td><td>${d ? esc(d.model) : 'approved'}</td><td>${d ? `${d.seconds}s` : ''}</td>` +
            `<td>${d ? d.inputTokens.toLocaleString() : ''}</td><td>${d ? d.outputTokens.toLocaleString() : ''}</td>` +
            `<td>${d ? `$${d.usd.toFixed(2)}` : ''}</td><td>${c.notes.quotes.length}</td>` +
            `<td>${c.notes.teaserClips.length} (${Math.round(clipSecs)}s)</td><td>${c.notes.chapters.length}</td>` +
            `<td>${d ? d.unverified.length : ''}</td></tr>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Show notes comparison</title><style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#222}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}
.row{display:flex;gap:16px;align-items:flex-start}.col{flex:1;min-width:0;border-top:3px solid #6b8cff;padding-top:4px}
h2{margin-top:32px}h3{font-size:13px;color:#555;margin:0 0 8px}.meta{color:#777;font-size:12px}p{white-space:pre-wrap}
</style></head><body>
<h1>Show notes comparison: ${esc(episode.title)}</h1>
<p class="meta">Same transcript and prompt for every run. "Unverified" counts quotes and clips not found word for word in the transcript.</p>
<table><tr><th>Run</th><th>Model that answered</th><th>Time</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th><th>Quotes</th><th>Clips</th><th>Chapters</th><th>Unverified</th></tr>${stats}</table>
${section('"In this episode" clips', columns, n => list(n.teaserClips.map(c =>
        `<span class="meta">${mmss(c.startMs)}, ${secs(c.startMs, c.endMs)}, ${esc(c.speaker)}</span><br>${esc(c.text)}`)))}
${section('Titles', columns, n => list(n.titles.map(esc)))}
${section('YouTube description', columns, n => `<p>${esc(n.description)}</p><p class="meta">${esc(n.hashtags.join(' '))}</p>`)}
${section('Website summary', columns, n => `<p>${esc(n.summary)}</p>`)}
${section('Chapters', columns, n => list(n.chapters.map(c => `${mmss(c.startMs)} ${esc(c.title)}`)))}
${section('Key quotes', columns, n => list(n.quotes.map(q =>
        `<span class="meta">${mmss(q.startMs)}, ${q.endMs > q.startMs ? secs(q.startMs, q.endMs) : '?'}, ${esc(q.speaker)}</span><br>${esc(q.text)}`)))}
${section('B-roll ideas', columns, n => list(n.broll.map(b =>
        `<span class="meta">${mmss(b.startMs)} for ${b.durationSeconds}s, ${b.style}</span><br>${esc(b.idea)}<br><span class="meta">${esc(b.why)}</span>`)))}
${section('Tags, themes and topics', columns, n => `<p>${esc(n.tags.join(', '))}</p><p class="meta">Themes: ${esc(n.themes.join(', '))}</p><p class="meta">Topics: ${esc(n.topics.join(', '))}</p>`)}
</body></html>`;
}

async function main() {
    const ref = getFirestore().collection('episodes').doc(episodeId);
    const episode = (await ref.get()).data() as Episode | undefined;
    if (!episode) throw new Error(`Episode ${episodeId} not found`);
    const reviewedPath = episode.review?.reviewedPath;
    if (!reviewedPath) throw new Error('The transcript has not been accepted yet');
    const [raw] = await getStorage().bucket().file(reviewedPath).download();
    const lines = (JSON.parse(raw.toString('utf8')) as { lines: ReviewedLine[] }).lines;
    console.log(`📝 ${episode.title}: ${lines.length} lines; ${runs.map(r => r.label).join(', ')}`);

    const client = new Anthropic({ apiKey: required('ANTHROPIC_API_KEY') });
    const results = await Promise.allSettled(runs.map(async r => {
        const draft = await draftNotes(client, episode, lines, r.model, r.effort);
        console.log(`✅ ${r.label}: ${draft.model}, ${draft.seconds}s, ${draft.inputTokens} in, ${draft.outputTokens} out, $${draft.usd}`);
        return draft;
    }));

    const columns: Column[] = [];
    const failures: string[] = [];
    results.forEach((res, i) => {
        if (res.status === 'fulfilled') columns.push({ label: runs[i].label, notes: res.value.notes, draft: res.value });
        else failures.push(`${runs[i].label}: ${(res.reason as Error).message}`);
    });
    // What the producer approved, for reference.
    const approved = episode.notes?.status === 'approved' ? StoredShowNotesSchema.safeParse(episode.notes.approved) : null;
    if (approved?.success) columns.push({ label: 'Approved notes', notes: approved.data });
    if (!columns.some(c => c.draft)) throw new Error(`Every run failed. ${failures.join('; ')}`);

    const html = report(episode, columns);
    const summary = [
        `## Show notes comparison: ${episode.title}`, '',
        '| Run | Answered by | Time | In | Out | Cost | Quotes | Clips | Unverified |', '|---|---|---|---|---|---|---|---|---|',
        ...columns.filter(c => c.draft).map(({ label, notes, draft: d }) =>
            `| ${label} | ${d!.model} | ${d!.seconds}s | ${d!.inputTokens} | ${d!.outputTokens} | $${d!.usd.toFixed(2)} | ${notes.quotes.length} | ${notes.teaserClips.length} | ${d!.unverified.length} |`),
        ...failures.map(f => `\nFailed: ${f}`),
    ].join('\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    // Only the numbers go in the run log, which is public: the notes themselves go by email.
    console.log(summary);

    await sendEmail({ alert: loadAlert() }, `Show notes comparison: ${episode.title}`,
        `${summary}\n\nThe attached page puts the runs side by side. Nothing on the episode was changed.`,
        [{ filename: 'show-notes-comparison.html', content: html }]);
    if (failures.length) process.exit(1);
}

main().catch(error => {
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
});
