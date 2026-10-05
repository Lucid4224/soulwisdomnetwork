// Why: the Descript-style timeline under the editor — a ruler, speaker turns in
// colour, cut marks, a red playhead, zoom in and out, click anywhere to jump there.

"use client";

import { useEffect, useRef, useState } from 'react';
import type { SpokenWord } from '@/lib/showNotes';
import type { Cut } from '@/lib/edit';
import {
    msAt, pct, speakerBlocks, speakerColors, tickLabel, ticks, zoomIn, zoomOut, ZOOMS,
} from '@/lib/timeline';
import { secondary } from '@/components/studio/ui';

// mmss local, to format block/cut titles.
function mmss(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// The playhead scrolls to stay a third of the way in when zoomed and out of view.
function usePlayheadScroll(scrollRef: React.RefObject<HTMLDivElement | null>, widthPx: number, zoom: number, currentMs: number, totalMs: number) {
    const lastMs = useRef(currentMs);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || zoom <= 1 || totalMs <= 0) { lastMs.current = currentMs; return; }
        const posPct = pct(currentMs, totalMs);
        const leftPx = posPct / 100 * widthPx;
        if (leftPx < el.scrollLeft || leftPx > el.scrollLeft + el.clientWidth) {
            el.scrollLeft = Math.max(0, leftPx - el.clientWidth / 3);
        }
        lastMs.current = currentMs;
    }, [scrollRef, widthPx, zoom, currentMs, totalMs]);
}

export function Timeline({ words, cuts, totalMs, currentMs, editedMs, onSeek }: {
    words: SpokenWord[]; cuts: Cut[]; totalMs: number; currentMs: number; editedMs: number; onSeek: (ms: number) => void;
}) {
    const [zoom, setZoom] = useState(1);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [visibleWidth, setVisibleWidth] = useState(0);

    // Keep the scroller's visible width in state with a ResizeObserver.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const update = () => setVisibleWidth(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const widthPx = visibleWidth * zoom;
    const blocks = speakerBlocks(words);
    const colors = speakerColors(blocks);

    usePlayheadScroll(scrollRef, widthPx, zoom, currentMs, totalMs);

    if (totalMs <= 0) return null;

    const tickList = ticks(totalMs, widthPx);

    // Block placement: left pct(start)%, width max(2px, pct(end) - pct(start)%).
    const blockStyle = (b: { startMs: number; endMs: number }): React.CSSProperties => ({
        left: `${pct(b.startMs, totalMs)}%`,
        width: `max(2px, ${pct(b.endMs, totalMs) - pct(b.startMs, totalMs)}%)`,
    });
    const cutStyle = (c: Cut): React.CSSProperties => ({
        left: `${pct(c.startMs, totalMs)}%`,
        width: `max(2px, ${pct(c.endMs, totalMs) - pct(c.startMs, totalMs)}%)`,
    });

    const playheadPct = pct(currentMs, totalMs);

    return (
        <section aria-label="Timeline" className="rounded-lg bg-[#130b29] border border-white/5 p-3 flex flex-col gap-2">
            {/* Header: title, hint, spacer, zoom controls. */}
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold text-gray-200">Timeline</span>
                <span className="text-xs text-gray-400">
                    {tickLabel(currentMs)} · edited length {tickLabel(editedMs)} of {tickLabel(totalMs)}
                </span>
                <div className="flex-1" />
                <button
                    aria-label="Zoom out"
                    disabled={zoom === 1}
                    onClick={() => setZoom(z => zoomOut(z))}
                    className={`${secondary} px-2 py-0.5`}
                >−</button>
                <span className="text-xs text-gray-300 w-10 text-center">{zoom}×</span>
                <button
                    aria-label="Zoom in"
                    disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                    onClick={() => setZoom(z => zoomIn(z))}
                    className={`${secondary} px-2 py-0.5`}
                >+</button>
                <button
                    onClick={() => setZoom(1)}
                    disabled={zoom === 1}
                    className={`${secondary} px-2 py-0.5`}
                >Fit</button>
            </div>

            {/* Horizontal scroller; its visible width drives the ruler. */}
            <div ref={scrollRef} className="overflow-x-auto">
                <div
                    className="relative cursor-pointer select-none"
                    style={{ width: `${zoom * 100}%` }}
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onSeek(msAt(e.clientX - rect.left, rect.width, totalMs));
                    }}
                >
                    {/* Ruler: a 20px row; a label per tick at left pct(t)%. */}
                    <div className="relative h-5" aria-hidden={false}>
                        {tickList.map((t, i) => (
                            <div
                                key={i}
                                className="absolute top-0 h-full border-l border-white/20 text-[10px] text-gray-400 pl-1 whitespace-nowrap"
                                style={{ left: `${pct(t, totalMs)}%` }}
                            >
                                {tickLabel(t)}
                            </div>
                        ))}
                    </div>

                    {/* Speakers: a 20px row, one span per block, coloured, opacity 70%. */}
                    <div className="relative h-5 mt-1" aria-label="Speakers">
                        {blocks.map((b, i) => (
                            <span
                                key={i}
                                className="absolute top-0 h-full rounded-sm"
                                style={{
                                    ...blockStyle(b),
                                    backgroundColor: colors[b.speaker],
                                    opacity: 0.7,
                                }}
                                title={`${b.speaker} ${mmss(b.startMs)}`}
                            />
                        ))}
                    </div>

                    {/* Cuts: a 16px row, faint background; one span per cut, grey for manual, amber otherwise. */}
                    <div className="relative h-4 mt-1 bg-white/5 rounded" aria-label="Cuts">
                        {cuts.map((c, i) => (
                            <span
                                key={i}
                                className={`absolute top-0 h-full rounded-sm ${c.reason === 'manual' ? 'bg-gray-400' : 'bg-amber-400'}`}
                                style={cutStyle(c)}
                                title={`Cut ${mmss(c.startMs)}`}
                            />
                        ))}
                    </div>

                    {/* Playhead: a 2px red line over all rows at left pct(currentMs)%. */}
                    <div
                        aria-hidden
                        className="absolute top-0 h-full bg-red-400 pointer-events-none"
                        style={{ left: `${playheadPct}%`, width: '2px', height: '100%' }}
                    />
                </div>
            </div>

            {/* Legend: a swatch and name per speaker, and the click hint. */}
            <div className="flex items-center flex-wrap gap-3 text-xs text-gray-400">
                {Object.entries(colors).map(([speaker, color]) => (
                    <span key={speaker} className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                        {speaker}
                    </span>
                ))}
                <span className="ml-auto">Click anywhere to jump there.</span>
            </div>
        </section>
    );
}
