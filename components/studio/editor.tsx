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

    const paras = useMemo(() => groupBySpeaker(words), [words]);
    const ranges = useMemo(() => keepRanges(
        words.length > 0 ? words[words.length - 1].end : 0,
        edit.cuts,
    ), [words, edit.cuts]);
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

    // Keyboard: Delete/Backspace to cut, Ctrl/Cmd+Z for undo/redo.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handler = (e: KeyboardEvent) => {
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

    // Video time mapping: skip cut ranges during playback.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onTimeUpdate = () => {
            const t = video.currentTime * 1000;
            // Check if current time falls in a cut — if so, jump to next kept range.
            for (const r of ranges) {
                if (t >= r.startMs && t < r.endMs) {
                    // Find the next kept range after this cut.
                    const nextRange = ranges.find(r2 => r2.startMs >= r.endMs);
                    if (nextRange) {
                        video.currentTime = nextRange.startMs / 1000;
                    }
                    break;
                }
            }
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        return () => video.removeEventListener('timeupdate', onTimeUpdate);
    }, [ranges]);

    // RAF loop for more precise cut-skipping.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const tick = () => {
            if (video.paused) { rafRef.current = requestAnimationFrame(tick); return; }
            const t = video.currentTime * 1000;
            for (const r of ranges) {
                if (t >= r.startMs && t < r.endMs) {
                    const nextRange = ranges.find(r2 => r2.startMs >= r.endMs);
                    if (nextRange) video.currentTime = nextRange.startMs / 1000;
                    break;
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
            </div>

            <div className="flex flex-col gap-4 md:flex-row">
                {/* Video preview */}
                <div className="md:w-1/2">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full rounded-lg bg-black"
                        controls
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
                                    const prevGap = wi > 0
                                        ? word.start - para.words[wi - 1].word.end : 0;
                                    return (
                                        <span key={wi}>
                                            {prevGap > pauseThreshold && (
                                                <span
                                                    className="inline-block mx-1 px-1.5 py-0.5 rounded bg-white/5 text-xs text-gray-400 cursor-pointer hover:bg-white/10"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const prevEnd = para.words[wi - 1].word.end;
                                                        updateEdit(prev => ({
                                                            ...prev,
                                                            cuts: [...prev.cuts, {
                                                                startMs: prevEnd,
                                                                endMs: word.start,
                                                                reason: 'pause',
                                                            }],
                                                        }));
                                                    }}
                                                >
                                                    ⏸ {(prevGap / 1000).toFixed(1)}s
                                                </span>
                                            )}
                                            <span
                                                className={`cursor-pointer select-none ${
                                                    cut ? 'line-through text-gray-600' :
                                                    isSelected ? 'bg-amber-500/30 rounded' : 'text-gray-200'
                                                } ${isSelected ? 'ring-1 ring-amber-400/50' : ''}`}
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
