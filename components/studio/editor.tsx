"use client";

// Editor Light (spec 015), phase 3: the transcript editor component.
// A controlled component with no data fetching: words, video, and edit state
// come from props. The transcript is grouped by speaker; cut words are
// struck through and dimmed; long pauses show as chips; the video preview
// skips cut ranges. Selection, delete, undo/redo, suggest/clear, search,
// review suggestions, and follow-video are wired.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpokenWord } from '@/lib/showNotes';
import type { Cut, EpisodeEdit } from '@/lib/edit';
import { keepRanges, editedDuration, suggestCuts } from '@/lib/edit';
import { primary, secondary, hint } from '@/components/studio/ui';

interface SpeakerPara {
    speaker: string;
    words: { word: SpokenWord; index: number }[];
}

// Group words into paragraphs by speaker.
function groupBySpeaker(words: SpokenWord[]): SpeakerPara[] {
    const paras: SpeakerPara[] = [];
    let current: SpeakerPara | null = null;
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!current || current.speaker !== w.speaker) {
            current = { speaker: w.speaker, words: [] };
            paras.push(current);
        }
        current.words.push({ word: w, index: i });
    }
    return paras;
}

// Check if a word index is inside any cut.
function isCut(index: number, words: SpokenWord[], cuts: Cut[]): boolean {
    if (index >= words.length) return false;
    const start = words[index].start;
    const end = words[index].end;
    return cuts.some(c => start >= c.startMs && end <= c.endMs);
}

// Find the cut that covers a word, if any.
function findCut(index: number, words: SpokenWord[], cuts: Cut[]): Cut | undefined {
    if (index >= words.length) return undefined;
    return cuts.find(c => words[index].start >= c.startMs && words[index].end <= c.endMs);
}

// Format mm:ss from ms.
function mmss(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Scroll the transcript box so the target element sits one third from the top.
// Never scrolls the page — only the box's scrollTop.
function scrollBoxTo(box: HTMLElement, target: HTMLElement) {
    const boxTop = box.scrollTop;
    const boxBottom = boxTop + box.clientHeight;
    const elTop = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const elBottom = elTop + target.offsetHeight;
    // If the target is already visible, do nothing.
    if (elTop >= boxTop && elBottom <= boxBottom) return;
    // Position the target one third from the top of the box.
    box.scrollTop = Math.max(0, elTop - box.clientHeight / 3);
}

export function Editor({ words, videoUrl, edit, onChange }: {
    words: SpokenWord[];
    videoUrl: string;
    edit: EpisodeEdit;
    onChange: (e: EpisodeEdit) => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const historyRef = useRef<EpisodeEdit[]>([edit]);
    const historyIdx = useRef(0);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const rafRef = useRef<number>(0);
    const [currentWord, setCurrentWord] = useState(-1);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMatches, setSearchMatches] = useState<number[]>([]);
    const [searchCursor, setSearchCursor] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);

    // Review suggestions state.
    const [reviewIdx, setReviewIdx] = useState(0);
    const [reviewKind, setReviewKind] = useState<string | null>(null);
    const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const chipRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const autoScrollPauseRef = useRef(0);

    // Play mode: 'edited' skips the cuts, 'original' plays everything, so the producer can compare.
    const [playMode, setPlayMode] = useState<'edited' | 'original'>('edited');
    // Hear it: while a preview runs, cuts are played (not skipped) and playback pauses at endMs.
    const previewRef = useRef<{ endMs: number } | null>(null);

    const paras = useMemo(() => groupBySpeaker(words), [words]);
    const [videoDuration, setVideoDuration] = useState(0);
    const ranges = useMemo(() => keepRanges(
        videoDuration || (words.length > 0 ? words[words.length - 1].end : 0),
        edit.cuts,
    ), [videoDuration, words, edit.cuts]);
    const editedMs = useMemo(() => editedDuration(ranges), [ranges]);

    // One total for both numbers: videoDuration || last word end.
    const totalMs = videoDuration || (words.length > 0 ? words[words.length - 1].end : 0);
    const timeSavedMs = Math.max(0, totalMs - editedMs);

    // Push edit to history when it changes.
    useEffect(() => {
        if (historyRef.current[historyIdx.current] !== edit) {
            historyRef.current = historyRef.current.slice(0, historyIdx.current + 1);
            historyRef.current.push(edit);
            historyIdx.current = historyRef.current.length - 1;
        }
        setCanUndo(historyIdx.current > 0);
        setCanRedo(historyIdx.current < historyRef.current.length - 1);
    }, [edit]);

    const updateEdit = useCallback((updater: (e: EpisodeEdit) => EpisodeEdit) => {
        onChange(updater({ ...edit, version: edit.version }));
    }, [edit, onChange]);

    const undo = useCallback(() => {
        if (historyIdx.current > 0) {
            historyIdx.current--;
            onChange(historyRef.current[historyIdx.current]);
            setCanUndo(historyIdx.current > 0);
            setCanRedo(historyIdx.current < historyRef.current.length - 1);
        }
    }, [onChange]);

    const redo = useCallback(() => {
        if (historyIdx.current < historyRef.current.length - 1) {
            historyIdx.current++;
            onChange(historyRef.current[historyIdx.current]);
            setCanUndo(historyIdx.current > 0);
            setCanRedo(historyIdx.current < historyRef.current.length - 1);
        }
    }, [onChange]);

    // Keyboard: Delete/Backspace to cut, Ctrl/Cmd+Z for undo/redo, Space to play/pause.
    // When focus is in a text box (INPUT, TEXTAREA, contentEditable), only Delete is
    // handled (it cuts the selected match). Typing, Backspace, Space and Ctrl/Cmd+Z
    // then work normally in the box.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const inTextBox = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
            // In a text box, only handle Delete (cut the selected match).
            if (inTextBox) {
                if (e.key === 'Delete' && selectedRange) {
                    e.preventDefault();
                    const [start, end] = selectedRange;
                    const startMs = words[start]?.start ?? 0;
                    const endMs = words[end]?.end ?? startMs;
                    // Never add a cut that matches an existing one.
                    if (!edit.cuts.some(c => c.startMs === startMs && c.endMs === endMs)) {
                        updateEdit(prev => ({
                            ...prev,
                            cuts: [...prev.cuts, { startMs, endMs, reason: 'manual' }],
                        }));
                    }
                    setSelectedRange(null);
                }
                return;
            }
            // Outside a text box, handle all keys.
            if (e.key === ' ') {
                e.preventDefault();
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) video.play(); else video.pause();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
                return;
            }
            if (selectedRange && (e.key === 'Delete' || e.key === 'Backspace')) {
                // Skip when the selection is only cut words.
                const [start, end] = selectedRange;
                let anyUncut = false;
                for (let i = start; i <= end; i++) {
                    if (!isCut(i, words, edit.cuts)) { anyUncut = true; break; }
                }
                if (!anyUncut) return;
                e.preventDefault();
                const startMs = words[start]?.start ?? 0;
                const endMs = words[end]?.end ?? startMs;
                // Never add a cut that matches an existing one.
                if (!edit.cuts.some(c => c.startMs === startMs && c.endMs === endMs)) {
                    updateEdit(prev => ({
                        ...prev,
                        cuts: [...prev.cuts, { startMs, endMs, reason: 'manual' }],
                    }));
                }
                setSelectedRange(null);
            }
        };
        el.addEventListener('keydown', handler);
        return () => el.removeEventListener('keydown', handler);
    }, [selectedRange, words, edit.cuts, updateEdit, undo, redo]);

    // Video time mapping: skip cut ranges during playback — jump only when
    // the time is outside every kept range (in a cut), to the next kept range.
    // Also track the word being spoken for the amber underline.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            const t = video.currentTime * 1000;
            const inKept = ranges.some(r => t >= r.startMs && t < r.endMs);
            if (!inKept && playMode === 'edited' && !previewRef.current) {
                const next = ranges.find(r => r.startMs > t);
                if (next) video.currentTime = next.startMs / 1000;
            }
            // Find the word being spoken — the last word whose [start, end) contains t.
            let cw = -1;
            for (let i = 0; i < words.length; i++) {
                if (t >= words[i].start && t < words[i].end) { cw = i; break; }
            }
            if (cw !== currentWord) setCurrentWord(cw);
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        return () => video.removeEventListener('timeupdate', onTimeUpdate);
    }, [ranges, words, currentWord, playMode]);

    // RAF loop for more precise cut-skipping.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const tick = () => {
            if (!video.paused) {
                const t = video.currentTime * 1000;
                // Hear it: stop at the end of the preview window.
                if (previewRef.current && t >= previewRef.current.endMs) {
                    video.pause();
                    previewRef.current = null;
                }
                const inKept = ranges.some(r => t >= r.startMs && t < r.endMs);
                if (!inKept && playMode === 'edited' && !previewRef.current) {
                    const next = ranges.find(r => r.startMs > t);
                    if (next) video.currentTime = next.startMs / 1000;
                }
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [ranges, playMode]);

    // A pause by any means ends a Hear it preview, so the next play skips cuts again.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onPause = () => { previewRef.current = null; };
        video.addEventListener('pause', onPause);
        return () => video.removeEventListener('pause', onPause);
    }, []);

    // Auto-scroll the spoken word into view while playing, unless the user
    // scrolled the box by hand (pause auto-scroll for 4 seconds).
    // Never use scrollIntoView — scroll only the transcript box.
    useEffect(() => {
        if (currentWord < 0) return;
        if (Date.now() < autoScrollPauseRef.current) return;
        const el = wordRefs.current[currentWord];
        const box = transcriptRef.current;
        if (el && box) scrollBoxTo(box, el);
    }, [currentWord]);

    // Detect manual scroll on the transcript box via wheel and touchmove
    // (not 'scroll' — the helper's own scrolling must not pause it).
    useEffect(() => {
        const box = transcriptRef.current;
        if (!box) return;
        const onPause = () => { autoScrollPauseRef.current = Date.now() + 4000; };
        box.addEventListener('wheel', onPause, { passive: true });
        box.addEventListener('touchmove', onPause, { passive: true });
        return () => {
            box.removeEventListener('wheel', onPause);
            box.removeEventListener('touchmove', onPause);
        };
    }, []);

    // Seek to a word's time.
    const seekTo = useCallback((index: number) => {
        if (videoRef.current && words[index]) {
            videoRef.current.currentTime = words[index].start / 1000;
        }
    }, [words]);

    // Seek to a time in seconds, pausing first for the review flow.
    const seekToTime = useCallback((seconds: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = seconds;
    }, []);

    // Word click: seek. Shift-click: extend selection. Double-click a cut word: bring it back.
    // A cut word is never selected — single click on a cut word seeks and clears selection.
    const onWordClick = (index: number, e: React.MouseEvent) => {
        const cut = isCut(index, words, edit.cuts);
        if (cut) {
            seekTo(index);
            setSelectedRange(null);
            return;
        }
        if (e.shiftKey && selectedRange) {
            const [start] = selectedRange;
            setSelectedRange([Math.min(start, index), Math.max(start, index)]);
        } else {
            setSelectedRange([index, index]);
            seekTo(index);
        }
    };

    const onWordDoubleClick = (index: number) => {
        const cut = findCut(index, words, edit.cuts);
        if (cut) onCutClick(cut);
    };

    // Word drag start.
    const onWordMouseDown = (index: number) => {
        if (isCut(index, words, edit.cuts)) return;
        setDragStart(index);
        setSelectedRange([index, index]);
    };

    // Word drag enter: extend selection.
    const onWordMouseEnter = (index: number) => {
        if (dragStart !== null) {
            setSelectedRange([Math.min(dragStart, index), Math.max(dragStart, index)]);
        }
    };

    // Drag end.
    useEffect(() => {
        const endDrag = () => setDragStart(null);
        document.addEventListener('mouseup', endDrag);
        return () => document.removeEventListener('mouseup', endDrag);
    }, []);

    // Click a cut to restore it.
    const onCutClick = useCallback((cut: Cut) => {
        updateEdit(prev => ({
            ...prev,
            cuts: prev.cuts.filter(c => !(c.startMs === cut.startMs && c.endMs === cut.endMs)),
        }));
    }, [updateEdit]);

    // Suggest filler words and long pauses.
    const onSuggest = () => {
        const suggested = suggestCuts(words);
        updateEdit(prev => ({ ...prev, cuts: [...prev.cuts, ...suggested] }));
        setReviewIdx(0);
        setReviewKind(null);
    };

    // Clear suggestions (remove all non-manual cuts).
    const onClearSuggestions = () => {
        updateEdit(prev => ({ ...prev, cuts: prev.cuts.filter(c => c.reason === 'manual') }));
        setReviewIdx(0);
        setReviewKind(null);
    };

    // Search: typing highlights matching words, Enter jumps to the next match.
    const onSearchChange = (q: string) => {
        setSearchQuery(q);
        if (!q.trim()) {
            setSearchMatches([]);
            return;
        }
        const lower = q.toLowerCase();
        const matches: number[] = [];
        for (let i = 0; i < words.length; i++) {
            if (words[i].text.toLowerCase().includes(lower)) matches.push(i);
        }
        setSearchMatches(matches);
        setSearchCursor(-1); // -1 means "not yet navigated"; first Enter goes to match 0.
    };

    const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && searchMatches.length > 0) {
            e.preventDefault();
            const next = searchCursor < 0 ? 0 : (searchCursor + 1) % searchMatches.length;
            setSearchCursor(next);
            const idx = searchMatches[next];
            setSelectedRange([idx, idx]);
            seekTo(idx);
        }
    };

    // Clear search: empties the box and its matches, and keeps focus in the box for a new search.
    const clearSearch = () => {
        onSearchChange('');
        setSearchCursor(-1);
        searchRef.current?.focus();
    };

    // Search matches as a Set for O(1) lookup per word.
    const matchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

    // Count cuts by reason.
    const reasonCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const c of edit.cuts) counts[c.reason] = (counts[c.reason] || 0) + 1;
        return counts;
    }, [edit.cuts]);

    // Suggested cuts (reason not 'manual'), sorted by start time.
    const suggestedCuts = useMemo(() =>
        edit.cuts.filter(c => c.reason !== 'manual').sort((a, b) => a.startMs - b.startMs),
    [edit.cuts]);

    // Filtered suggestions for the review row.
    const reviewCuts = useMemo(() =>
        reviewKind ? suggestedCuts.filter(c => c.reason === reviewKind) : suggestedCuts,
    [suggestedCuts, reviewKind]);

    // Review navigation: Previous/Next/Keep.
    const reviewCount = reviewCuts.length;

    // Clamp reviewIdx to the last valid item (after undo, redo, or a cut).
    const clampedReviewIdx = reviewCount > 0 ? Math.min(reviewIdx, reviewCount - 1) : 0;

    const reviewPrev = () => {
        if (reviewCount === 0) return;
        const idx = (clampedReviewIdx - 1 + reviewCount) % reviewCount;
        setReviewIdx(idx);
        const cut = reviewCuts[idx];
        seekToTime(Math.max(0, cut.startMs / 1000 - 1));
    };

    const reviewNext = () => {
        if (reviewCount === 0) return;
        const idx = (clampedReviewIdx + 1) % reviewCount;
        setReviewIdx(idx);
        const cut = reviewCuts[idx];
        seekToTime(Math.max(0, cut.startMs / 1000 - 1));
    };

    const reviewKeep = () => {
        if (reviewCount === 0) return;
        const cut = reviewCuts[clampedReviewIdx];
        onCutClick(cut);
        // Move to the next suggestion after removing this one.
        if (reviewCount > 1) setReviewIdx(Math.min(clampedReviewIdx, reviewCount - 2));
        else setReviewIdx(0);
    };

    // Scroll the reviewed cut's word or chip into view (box-only, never the page).
    useEffect(() => {
        if (reviewCount === 0) return;
        const cut = reviewCuts[clampedReviewIdx];
        if (!cut) return;
        // Find the word index at the cut start, or the chip just before it.
        let wordIdx = -1;
        for (let i = 0; i < words.length; i++) {
            if (words[i].start >= cut.startMs) { wordIdx = i; break; }
        }
        const box = transcriptRef.current;
        if (!box) return;
        if (wordIdx >= 0 && wordRefs.current[wordIdx]) {
            scrollBoxTo(box, wordRefs.current[wordIdx]!);
        }
    }, [clampedReviewIdx, reviewCuts, reviewCount, words]);

    // Check if a pause between words is long enough to show as a chip.
    const pauseThreshold = 800; // ms

    // The cut highlighted by the review row.
    const reviewCut = reviewCount > 0 ? reviewCuts[clampedReviewIdx] : null;

    // Hear it: play from 2 s before the reviewed mark to 2 s after it, the mark included,
    // so the producer hears it in context before choosing Keep this or Next.
    const hearCut = () => {
        const video = videoRef.current;
        if (!video || !reviewCut) return;
        previewRef.current = { endMs: reviewCut.endMs + 2000 };
        video.currentTime = Math.max(0, reviewCut.startMs - 2000) / 1000;
        void video.play();
    };

    // The reason button label for 'manual'.
    const reasonLabel = (reason: string): string =>
        reason === 'filler' ? 'Fillers' : reason === 'repeat' ? 'Repeats' : reason === 'pause' ? 'Pauses' : reason === 'manual' ? 'Your cuts' : reason;

    return (
        <div ref={containerRef} tabIndex={0} className="flex flex-col gap-4 outline-none">
            {/* Help line: how to edit, and the keys on Undo and Redo. */}
            <p className={hint}>Click a word, or drag across words, to select · Delete or Backspace cuts them · Double-click a cut word to bring it back · Space plays and pauses · Ctrl or ⌘ + Z undoes, Ctrl or ⌘ + Y redoes</p>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
                <button onClick={onSuggest} className={primary}>
                    Mark filler words and long pauses
                </button>
                <button onClick={onClearSuggestions} className={secondary}>
                    Clear suggestions
                </button>
                <button onClick={undo} className={secondary} disabled={!canUndo} title="Ctrl or ⌘ + Z">
                    Undo
                </button>
                <button onClick={redo} className={secondary} disabled={!canRedo} title="Ctrl or ⌘ + Y">
                    Redo
                </button>
                <span className={hint}>
                    Edited length {mmss(editedMs)} · saves {mmss(timeSavedMs)}
                </span>
                {/* Reason counts as buttons that filter the review. */}
                {Object.entries(reasonCounts).map(([reason, count]) => {
                    const label = reasonLabel(reason);
                    const isChosen = reviewKind === reason;
                    return (
                        <button
                            key={reason}
                            onClick={() => { setReviewKind(isChosen ? null : reason); setReviewIdx(0); }}
                            className={isChosen
                                ? "text-xs px-2 py-0.5 rounded border border-amber-400/60 text-amber-200 bg-amber-500/10"
                                : `${secondary} px-2 py-0.5`}
                        >
                            {label} {count}
                        </button>
                    );
                })}
                {/* Search box with a clear button that shows once there is text. */}
                <div className="ml-auto flex items-center gap-1">
                    <input
                        ref={searchRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => onSearchChange(e.target.value)}
                        onKeyDown={onSearchKeyDown}
                        placeholder="Search transcript…"
                        className="w-64 px-3 py-1.5 text-sm rounded bg-white/5 text-gray-200 placeholder-gray-500 outline-none focus:ring-1 ring-amber-400/50"
                    />
                    {searchQuery && (
                        <button type="button" onClick={clearSearch} aria-label="Clear search" title="Clear search" className={`${secondary} px-2 py-0.5`}>
                            ×
                        </button>
                    )}
                </div>
                {searchMatches.length > 0 && (
                    <span className={hint}>
                        {searchCursor < 0 ? `${searchMatches.length} matches` : `${searchCursor + 1}/${searchMatches.length}`}
                    </span>
                )}
            </div>

            {/* Hint line */}
            <div className={hint}>
                Amber = suggested · Grey = your cuts
            </div>

            {/* Review suggestions row */}
            {reviewCount > 0 && (
                <div className="flex items-center gap-2">
                    <button onClick={reviewPrev} className={secondary}>‹ Previous</button>
                    <span className={hint}>{clampedReviewIdx + 1} of {reviewCount}</span>
                    <button onClick={reviewNext} className={secondary}>Next ›</button>
                    <button onClick={reviewKeep} className={secondary}>Keep this</button>
                    <button onClick={hearCut} className={secondary} data-start-ms={reviewCut?.startMs} data-end-ms={reviewCut?.endMs}>Hear it</button>
                </div>
            )}

            {/* Hint line: shortcuts */}
            <div className={hint}>
                Space play/pause · Delete cut · Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo · Enter in search: next match
            </div>

            <div className="flex flex-col gap-4 md:flex-row">
                {/* Video preview */}
                <div className="md:w-1/2 md:sticky md:top-4 self-start">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full rounded-lg bg-black"
                        controls
                        onLoadedMetadata={e => setVideoDuration(e.currentTarget.duration * 1000)}
                    />
                    {/* Cuts map: every cut on one strip under the video; click a mark to jump there. */}
                    {totalMs > 0 && (
                        <div aria-label="Cuts map" className="relative mt-2 h-3 w-full rounded bg-white/5">
                            {edit.cuts.map((c, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    title={`Cut at ${mmss(c.startMs)}`}
                                    data-start-ms={c.startMs}
                                    data-end-ms={c.endMs}
                                    onClick={() => seekToTime(Math.max(0, c.startMs / 1000 - 1))}
                                    className={`absolute top-0 h-full rounded-sm ${c.reason === 'manual' ? 'bg-gray-400' : 'bg-amber-400'}`}
                                    style={{ left: `${(c.startMs / totalMs) * 100}%`, width: `max(2px, ${((c.endMs - c.startMs) / totalMs) * 100}%)` }}
                                />
                            ))}
                        </div>
                    )}
                    {/* Play switch: Edited skips the cuts, Original plays everything. */}
                    <div className="mt-2 flex items-center gap-2">
                        <span className={hint}>Play:</span>
                        {(['edited', 'original'] as const).map(mode => (
                            <button
                                key={mode}
                                type="button"
                                aria-pressed={playMode === mode}
                                onClick={() => setPlayMode(mode)}
                                className={playMode === mode
                                    ? "text-xs px-2 py-0.5 rounded border border-amber-400/60 text-amber-200 bg-amber-500/10"
                                    : `${secondary} px-2 py-0.5`}
                            >
                                {mode === 'edited' ? 'Edited' : 'Original'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Transcript */}
                <div ref={transcriptRef} className="md:w-1/2 h-[calc(100vh-220px)] min-h-[400px] overflow-y-auto rounded-lg bg-[#130b29] p-4">
                    {paras.map((para, pi) => (
                        <div key={pi} className="mb-4" style={{ contentVisibility: 'auto' }}>
                            <p className="text-sm font-bold text-amber-400 mb-1">
                                {para.speaker}
                                {/* Turn start time, so the producer can find a turn by its time. */}
                                <span className="ml-2 text-xs font-normal text-gray-400">{mmss(para.words[0].word.start)}</span>
                            </p>
                            <p className="text-sm leading-relaxed text-gray-200">
                                {para.words.map(({ word, index }, wi) => {
                                    const wordCut = findCut(index, words, edit.cuts);
                                    const cut = !!wordCut;
                                    const isManual = wordCut?.reason === 'manual';
                                    const isSelected = selectedRange &&
                                        index >= selectedRange[0] && index <= selectedRange[1];
                                    const isCurrent = index === currentWord;
                                    const isMatch = matchSet.has(index);
                                    const isReview = reviewCut && wordCut &&
                                        wordCut.startMs === reviewCut.startMs &&
                                        wordCut.endMs === reviewCut.endMs;
                                    // The silence before this word, also across a change of speaker. It shows
                                    // as a chip when it is long, or when a cut sits in it (a filler AssemblyAI
                                    // left out of the transcript), so every suggestion can be seen and undone.
                                    const prev = index > 0 ? words[index - 1] : null;
                                    const prevGap = prev ? word.start - prev.end : 0;
                                    const gapCuts = prev ? edit.cuts.filter(c =>
                                        c.startMs >= prev.end - 50 && c.endMs <= word.start + 50) : [];
                                    const gapCut = gapCuts.length > 0;
                                    const gapCutIsManual = gapCuts.every(c => c.reason === 'manual');
                                    const gapCutIsReview = reviewCut && gapCuts.some(c =>
                                        c.startMs === reviewCut.startMs && c.endMs === reviewCut.endMs);
                                    return (
                                        <span key={wi}>
                                            {prev && (prevGap > pauseThreshold || gapCut) && (
                                                <span
                                                    ref={el => { chipRefs.current[index] = el; }}
                                                    title={gapCut ? (gapCutIsManual ? 'Double-click to bring back' : 'Double-click to keep it') : 'Click to shorten this pause'}
                                                    className={`inline-block mx-1 px-1.5 py-0.5 rounded text-xs cursor-pointer ${
                                                        gapCut
                                                            ? gapCutIsManual
                                                                ? 'line-through text-gray-400'
                                                                : 'line-through decoration-amber-400 text-amber-200/70 bg-amber-400/10'
                                                            : 'bg-white/5 text-gray-400 hover:bg-white/10'
                                                    } ${gapCutIsReview ? ' ring-2 ring-amber-400' : ''}`}
                                                    onDoubleClick={(e) => {
                                                        if (gapCut) {
                                                            e.stopPropagation();
                                                            updateEdit(cur => ({ ...cur, cuts: cur.cuts.filter(c => !gapCuts.includes(c)) }));
                                                        }
                                                    }}
                                                    onClick={(e) => {
                                                        if (!gapCut) {
                                                            e.stopPropagation();
                                                            updateEdit(cur => ({ ...cur, cuts: [...cur.cuts, {
                                                                startMs: prev.end + Math.min(500, prevGap / 2),
                                                                endMs: word.start,
                                                                reason: 'pause',
                                                            }] }));
                                                        }
                                                    }}
                                                >
                                                    {gapCut
                                                        ? (gapCuts.some(c => c.reason === 'filler')
                                                            ? `um · ${(prevGap / 1000).toFixed(1)}s`
                                                            : `pause ${(prevGap / 1000).toFixed(1)}s → ${((prevGap - (gapCuts[0]?.endMs ?? 0) + (gapCuts[0]?.startMs ?? 0)) / 1000).toFixed(1)}s`)
                                                        : `pause ${(prevGap / 1000).toFixed(1)}s`}
                                                </span>
                                            )}
                                            <span
                                                ref={el => { if (index < words.length) wordRefs.current[index] = el; }}
                                                className={`cursor-pointer select-none ${
                                                    cut
                                                        ? isManual
                                                            ? 'line-through text-gray-400'
                                                            : 'line-through decoration-amber-400 text-amber-200/70'
                                                        : isSelected
                                                            ? 'bg-amber-500/30 rounded'
                                                            : 'text-gray-200'
                                                } ${isSelected ? 'ring-1 ring-amber-400/50' : ''} ${
                                                    isCurrent && !cut ? 'underline decoration-amber-400 decoration-2 underline-offset-2' : ''
                                                } ${isMatch && !cut ? 'bg-amber-400/10' : ''} ${
                                                    isReview ? ' ring-2 ring-amber-400' : ''
                                                }`}
                                                title={cut ? 'Double-click to bring back' : undefined}
                                                onClick={(e) => onWordClick(index, e)}
                                                onDoubleClick={() => onWordDoubleClick(index)}
                                                onMouseDown={() => onWordMouseDown(index)}
                                                onMouseEnter={() => onWordMouseEnter(index)}
                                            >
                                                {word.text}
                                            </span>
                                            {' '}
                                        </span>
                                    );
                                })}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
