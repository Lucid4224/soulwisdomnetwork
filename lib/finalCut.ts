// Whether the final cut still matches the episode. It comes from Descript (Tom's flow) or, when
// the Studio settings choose it, from the Editor Light render. A Descript cut is current while it
// came from the Descript project and notes as they are now; an Editor Light cut while it came
// from the saved edit and notes as they are now. Shared by the thumbnails, Shorts and final cut
// views so all three agree.

import type { Episode } from '../types/episode';

export function finalIsCurrent(episode: Episode): boolean {
    const f = episode.final;
    if (f?.status !== 'ready') return false;
    if (f.notesVersion !== episode.notes?.approvedVersion) return false;
    return f.source === 'editorLight'
        ? f.editVersion === episode.edit?.version
        : f.projectId === episode.descript?.projectId;
}
