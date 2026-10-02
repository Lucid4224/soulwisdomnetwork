"use client";

// Editor Light (spec 015), phase 3: the transcript editor component.
// A controlled component with no data fetching: words, video, and edit state
// come from props. The transcript is grouped by speaker; cut words are
// struck through and dimmed; long pauses show as chips; the video preview
// skips cut ranges. Selection, delete, undo/redo, and suggest/clear are wired.

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

// Format mm:ss from ms.
function mmss(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Editor({ words, videoUrl, edit, onChange }: {
    words: SpokenWord[];
    videoUrl: string;
    edit: EpisodeEdit;
    onChange: (e: EpisodeEdit) => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
    const [dragStart, setDragStart] = useState<number | null>(null);
    const historyRef = useRef<EpisodeEdit[]>([edit]);
    const historyIdx = useRef(0);
    const rafRef = useRef<number>(0);
    const [currentWord, setCurrentWord] = useState(-1);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchMatches, setSearchMatches] = useState<number[]>([]);
    const [searchCursor, setSearchCursor] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);

    const paras = useMemo(() => groupBySpeaker(words), [words]);
    const [videoDuration, setVideoDuration] = useState(0);
    const ranges = useMemo(() => keepRanges(
        videoDuration || (words.length > 0 ? words[words.length - 1].end : 0),
        edit.cuts,
    ), [videoDuration, words, edit.cuts]);
    const editedMs = useMemo(() => editedDuration(ranges), [ranges]);

    // Push edit to history when it changes.
    useEffect(() => {
        if (historyRef.current[historyIdx.current] !== edit) {
            historyRef.current = historyRef.current.slice(0, historyIdx.current + 1);
            historyRef.current.push(edit);
            historyIdx.current = historyRef.current.length - 1;
        }
    }, [edit]);

    const updateEdit = useCallback((updater: (e: EpisodeEdit) => EpisodeEdit) => {
        onChange(updater({ ...edit, version: edit.version }));
    }, [edit, onChange]);

    const undo = useCallback(() => {
        if (historyIdx.current > 0) {
            historyIdx.current--;
            onChange(historyRef.current[historyIdx.current]);
        }
    }, [onChange]);

    const redo = useCallback(() => {
        if (historyIdx.current < historyRef.current.length - 1) {
            historyIdx.current++;
            onChange(historyRef.current[historyIdx.current]);
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
                    updateEdit(prev => ({
                        ...prev,
                        cuts: [...prev.cuts, { startMs, endMs, reason: 'manual' }],
                    }));
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
                e.preventDefault();
                const [start, end] = selectedRange;
                const startMs = words[start]?.start ?? 0;
                const endMs = words[end]?.end ?? startMs;
                updateEdit(prev => ({
                    ...prev,
                    cuts: [...prev.cuts, { startMs, endMs, reason: 'manual' }],
                }));
                setSelectedRange(null);
            }
        };
        el.addEventListener('keydown', handler);
        return () => el.removeEventListener('keydown', handler);
    }, [selectedRange, words, updateEdit, undo, redo]);

    // Video time mapping: skip cut ranges during playback — jump only when
    // the time is outside every kept range (in a cut), to the next kept range.
    // Also track the word being spoken for the amber underline.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            const t = video.currentTime * 1000;
            const inKept = ranges.some(r => t >= r.startMs && t < r.endMs);
            if (!inKept) {
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
    }, [ranges, words, currentWord]);

    // RAF loop for more precise cut-skipping.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const tick = () => {
            if (!video.paused) {
                const t = video.currentTime * 1000;
                const inKept = ranges.some(r => t >= r.startMs && t < r.endMs);
                if (!inKept) {
                    const next = ranges.find(r => r.startMs > t);
                    if (next) video.currentTime = next.startMs / 1000;
                }
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [ranges]);

    // Seek to a word's time.
    const seekTo = useCallback((index: number) => {
        if (videoRef.current && words[index]) {
            videoRef.current.currentTime = words[index].start / 1000;
        }
    }, [words]);

    // Word click: seek. Shift-click: extend selection.
    const onWordClick = (index: number, e: React.MouseEvent) => {
        if (e.shiftKey && selectedRange) {
            const [start] = selectedRange;
            setSelectedRange([Math.min(start, index), Math.max(start, index)]);
        } else {
            setSelectedRange([index, index]);
            seekTo(index);
        }
    };

    // Word drag start.
    const onWordMouseDown = (index: number) => {
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
    const onCutClick = (cut: Cut) => {
        updateEdit(prev => ({
            ...prev,
            cuts: prev.cuts.filter(c => !(c.startMs === cut.startMs && c.endMs === cut.endMs)),
        }));
    };

    // Suggest filler words and long pauses.
    const onSuggest = () => {
        const suggested = suggestCuts(words);
        updateEdit(prev => ({ ...prev, cuts: [...prev.cuts, ...suggested] }));
    };

    // Clear suggestions (remove all non-manual cuts).
    const onClearSuggestions = () => {
        updateEdit(prev => ({ ...prev, cuts: prev.cuts.filter(c => c.reason === 'manual') }));
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

    // Search matches as a Set for O(1) lookup per word.
    const matchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

    // Count cuts by reason.
    const reasonCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const c of edit.cuts) counts[c.reason] = (counts[c.reason] || 0) + 1;
        return counts;
    }, [edit.cuts]);

    const totalDuration = words.length > 0 ? words[words.length - 1].end : 0;
    const timeSavedMs = totalDuration - editedMs;

    // Check if a pause between words is long enough to show as a chip.
    const pauseThreshold = 800; // ms

    return (
        <div ref={containerRef} tabIndex={0} className="flex flex-col gap-4 outline-none">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
                <button onClick={onSuggest} className={primary}>
                    Mark filler words and long pauses
                </button>
                <button onClick={onClearSuggestions} className={secondary}>
                    Clear suggestions
                </button>
                <span className={hint}>
                    Edited length {mmss(editedMs)} · saves {mmss(timeSavedMs)}
                </span>
                {Object.entries(reasonCounts).map(([reason, count]) => (
                    <span key={reason} className={hint}>
                        {reason}: {count}
                    </span>
                ))}
                <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search transcript…"
                    className="ml-auto px-2 py-1 text-sm rounded bg-white/5 text-gray-200 placeholder-gray-500 outline-none focus:ring-1 ring-amber-400/50"
                />
                {searchMatches.length > 0 && (
                    <span className={hint}>
                        {searchCursor < 0 ? `${searchMatches.length} matches` : `${searchCursor + 1}/${searchMatches.length}`}
                    </span>
                )}
            </div>

            <div className="flex flex-col gap-4 md:flex-row">
                {/* Video preview */}
                <div className="md:w-1/2">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full rounded-lg bg-black"
                        controls
                        onLoadedMetadata={e => setVideoDuration(e.currentTarget.duration * 1000)}
                    />
                </div>

                {/* Transcript */}
                <div className="md:w-1/2 max-h-[600px] overflow-y-auto rounded-lg bg-[#130b29] p-4">
                    {paras.map((para, pi) => (
                        <div key={pi} className="mb-4" style={{ contentVisibility: 'auto' }}>
                            <p className="text-sm font-bold text-amber-400 mb-1">{para.speaker}</p>
                            <p className="text-sm leading-relaxed text-gray-200">
                                {para.words.map(({ word, index }, wi) => {
                                    const cut = isCut(index, words, edit.cuts);
                                    const isSelected = selectedRange &&
                                        index >= selectedRange[0] && index <= selectedRange[1];
                                    const isCurrent = index === currentWord;
                                    const isMatch = matchSet.has(index);
                                    // The silence before this word, also across a change of speaker. It shows
                                    // as a chip when it is long, or when a cut sits in it (a filler AssemblyAI
                                    // left out of the transcript), so every suggestion can be seen and undone.
                                    const prev = index > 0 ? words[index - 1] : null;
                                    const prevGap = prev ? word.start - prev.end : 0;
                                    const gapCuts = prev ? edit.cuts.filter(c =>
                                        c.startMs >= prev.end - 50 && c.endMs <= word.start + 50) : [];
                                    const gapCut = gapCuts.length > 0;
                                    return (
                                        <span key={wi}>
                                            {prev && (prevGap > pauseThreshold || gapCut) && (
                                                <span
                                                    title={gapCut ? 'Cut: click to keep it' : 'Click to shorten this pause'}
                                                    className={`inline-block mx-1 px-1.5 py-0.5 rounded text-xs cursor-pointer ${
                                                        gapCut ? 'bg-amber-400/10 text-gray-500 line-through ring-1 ring-amber-400/40'
                                                            : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        updateEdit(cur => gapCut
                                                            ? { ...cur, cuts: cur.cuts.filter(c => !gapCuts.includes(c)) }
                                                            : { ...cur, cuts: [...cur.cuts, {
                                                                startMs: prev.end + Math.min(500, prevGap / 2),
                                                                endMs: word.start,
                                                                reason: 'pause',
                                                            }] });
                                                    }}
                                                >
                                                    {gapCuts.some(c => c.reason === 'filler') ? 'um?' : '⏸'} {(prevGap / 1000).toFixed(1)}s
                                                </span>
                                            )}
                                            <span
                                                className={`cursor-pointer select-none ${
                                                    cut ? 'line-through text-gray-600' :
                                                    isSelected ? 'bg-amber-500/30 rounded' : 'text-gray-200'
                                                } ${isSelected ? 'ring-1 ring-amber-400/50' : ''} ${
                                                    isCurrent && !cut ? 'underline decoration-amber-400 decoration-2 underline-offset-2' : ''
                                                } ${isMatch && !cut ? 'bg-amber-400/10' : ''}`}
                                                onClick={(e) => cut
                                                    ? onCutClick(edit.cuts.find(c =>
                                                        word.start >= c.startMs && word.end <= c.endMs)!)
                                                    : onWordClick(index, e)}
                                                onMouseDown={() => !cut && onWordMouseDown(index)}
                                                onMouseEnter={() => !cut && onWordMouseEnter(index)}
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
