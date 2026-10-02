"use client";

// Editor Light demo page: renders the Editor with a sample clip and words,
// no Firebase. Visit /editor-demo to see the editor in action.

import { useState, useEffect } from "react";
import { Editor } from "@/components/studio/editor";
import type { EpisodeEdit } from "@/lib/edit";
import type { SpokenWord } from "@/lib/showNotes";

export default function EditorDemoPage() {
    const [words, setWords] = useState<SpokenWord[]>([]);
    const [edit, setEdit] = useState<EpisodeEdit>({ cuts: [], version: 0 });

    useEffect(() => {
        fetch("/editor-demo/words.json")
            .then(r => r.json())
            .then((data: SpokenWord[]) => setWords(data))
            .catch(() => setWords([]));
    }, []);

    return (
        <div className="min-h-screen bg-[#130b29] text-gray-100 p-8">
            <div className="max-w-5xl mx-auto">
                <h1 className="text-2xl font-bold text-amber-400 mb-6">Editor Light demo</h1>
                {words.length > 0 ? (
                    <Editor
                        words={words}
                        videoUrl="/editor-demo/sample.mp4"
                        edit={edit}
                        onChange={setEdit}
                    />
                ) : (
                    <p className="text-gray-400">Loading…</p>
                )}
            </div>
        </div>
    );
}
