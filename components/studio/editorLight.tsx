// Why: Editor Light (spec 015) panel moved out of the show notes page, so the show
// notes page imports it and the full-page editor reuses it with workspace. It loads
// the edit via GET, saves via PUT with useAutosave, and renders the Editor component.
// `workspace` is the full-page editor.

"use client";

import { useCallback, useEffect, useState } from 'react';
import { Editor } from '@/components/studio/editor';
import { hint as small, primary, secondary } from '@/components/studio/ui';
import { useAutosave } from '@/components/studio/useAutosave';
import { mmss, type SpokenWord } from '@/lib/showNotes';
import type { EpisodeEdit } from '@/lib/edit';
import type { EditRenderView } from '@/lib/server/editRender';
import { studioFetch } from '@/lib/studioClient';

export function EditorLightStage({ episodeId, words, videoUrl, workspace = false }: {
    episodeId: string; words: SpokenWord[]; videoUrl: string; workspace?: boolean;
}) {
    const [edit, setEdit] = useState<EpisodeEdit>({ cuts: [], version: 0 });
    const [loaded, setLoaded] = useState(false);
    const { change, reset, flush, saveState, saveError } = useAutosave<EpisodeEdit>(
        async (value, version) => {
            const res = await studioFetch<{ version: number }>(`/api/studio/episodes/${episodeId}/edit`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edit: value, version }),
            });
            return res.version;
        }
    );

    useEffect(() => {
        studioFetch<{ edit: EpisodeEdit }>(`/api/studio/episodes/${episodeId}/edit`)
            .then((data) => {
                setEdit(data.edit);
                reset(data.edit.version);
                setLoaded(true);
            })
            .catch(() => { setLoaded(true); });
    }, [episodeId, reset]);

    // The render of the saved edit: checked on load and every 15 s while it runs.
    const [render, setRender] = useState<EditRenderView | null>(null);
    const [renderError, setRenderError] = useState('');
    const loadRender = useCallback(() => {
        studioFetch<EditRenderView>(`/api/studio/episodes/${episodeId}/edit-render`)
            .then(setRender)
            .catch(e => setRenderError((e as Error).message));
    }, [episodeId]);
    useEffect(() => { loadRender(); }, [loadRender]);
    const rendering = !!render?.status && ['queued', 'downloading', 'rendering', 'saving'].includes(render.status);
    useEffect(() => {
        if (!rendering) return;
        const timer = setInterval(loadRender, 15_000);
        return () => clearInterval(timer);
    }, [rendering, loadRender]);

    // Saves any pending change first, so the render uses the edit as it is on screen.
    const startRender = async () => {
        setRenderError('');
        if (!(await flush())) return;
        try {
            await studioFetch(`/api/studio/episodes/${episodeId}/edit-render`, { method: 'POST' });
            loadRender();
        } catch (e) {
            setRenderError((e as Error).message);
        }
    };

    // Watch the finished render: toggles a video player for the render's video.
    const [watching, setWatching] = useState(false);

    if (!loaded) return <p className={small}>Loading editor…</p>;

    // Save status in plain words, same labels and colours as the show notes autosave.
    const saveStatus = (
        <p className={`${small} ${workspace ? '' : 'mb-2'} ${saveState === 'error' ? 'text-red-300 font-bold' : saveState === 'saved' ? 'text-green-300' : 'text-gray-400'}`}>
            {{ saved: '✓ Saved', unsaved: 'Unsaved changes…', saving: 'Saving…', error: 'Not saved' }[saveState]}
            {saveState === 'error' && `: ${saveError}`}
        </p>
    );

    // The editor component.
    const editor = (
        <Editor
            words={words}
            videoUrl={videoUrl}
            edit={edit}
            workspace={workspace}
            onChange={(e) => { setEdit(e); change(e); }}
        />
    );

    // Render this edit: GitHub Actions makes the finished video and saves it to "04 Final".
    const renderControls = (
        <div className={`${workspace ? '' : 'mt-4'} flex flex-wrap items-center gap-3`}>
            <button onClick={() => { void startRender(); }} disabled={rendering || render?.canStart === false} className={primary}>
                {render?.status === 'ready' ? 'Render this edit again' : 'Render this edit'}
            </button>
            {render?.status === 'ready' && render.videoUrl && (
                <button onClick={() => setWatching(w => !w)} className={secondary}>
                    {watching ? 'Hide the render' : '▶ Watch the render'}
                </button>
            )}
            {rendering && <span className={small}>Rendering ({render?.status})… this can take a few hours for a long episode.</span>}
            {render?.status === 'ready' && (render.driveUrl || render.videoUrl) && (
                <span className={small}>
                    Rendered{render.durationSeconds !== null && ` (${mmss(render.durationSeconds * 1000)}, ${render.cuts ?? 0} cuts)`}:{' '}
                    {/* Drive when it is set up; otherwise a short-lived link to the video in Cloud Storage. */}
                    <a href={render.driveUrl ?? render.videoUrl ?? undefined} target="_blank" rel="noreferrer" className="text-amber-300 underline">
                        {render.driveUrl ? 'open in Drive' : 'watch or download'}
                    </a>
                    {render.stale && ' · the edit has changed since; render again to include the changes'}
                </span>
            )}
            {render?.status === 'failed' && <span className="text-sm text-red-300">Render failed: {render.error}</span>}
            {renderError && <span className="text-sm text-red-300">{renderError}</span>}
        </div>
    );

    // The render player and the warnings list.
    const renderResult = (
        <>
            {watching && render?.status === 'ready' && render.videoUrl && (
                <video src={render.videoUrl} controls preload="metadata" aria-label="The finished render" className="mt-3 w-full max-w-3xl rounded-lg bg-black" />
            )}
            {render?.status === 'ready' && render.warnings.length > 0 && (
                <ul className={`${small} mt-2 list-disc pl-5`}>
                    {render.warnings.map(w => <li key={w}>{w}</li>)}
                </ul>
            )}
        </>
    );

    // workspace: the full-page editor pins saving and rendering in a bar under the site header,
    // as Descript keeps Export at the top.
    if (workspace) {
        return (
            <>
                <div aria-label="Editor bar" className="sticky top-[65px] z-20 -mx-4 sm:-mx-6 mb-3 px-4 sm:px-6 py-2 flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0d0720]/95 backdrop-blur">
                    {saveStatus}<span className="grow" />{renderControls}
                </div>
                {renderResult}
                {editor}
            </>
        );
    }

    return (
        <>
            {saveStatus}
            {editor}
            {renderControls}
            {renderResult}
        </>
    );
}
