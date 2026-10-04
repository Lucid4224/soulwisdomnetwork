// Why: a Word .docx download for meeting notes, built from zipStore so no dependency is added.
// The meeting's decisions and action items go into a readable document the producer can share.

import { zipStore } from './zipStore';
import type { ActionItem } from './showNotes';
import { mmss } from './showNotes';

// Escapes text for XML: & < > and the double quotes around attribute values.
function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// One paragraph in the document body, with an optional style.
function para(text: string, style?: string): string {
    return style
        ? `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

// Builds a Word .docx from the meeting's parts. US Letter page, 1 inch margins.
export function meetingDocx(m: {
    title: string;
    date: string | null;
    summary: string;
    decisions: string[];
    actionItems: ActionItem[];
    chapters: { startMs: number; title: string }[];
}): Uint8Array {
    const body: string[] = [];
    body.push(para(m.title, 'Title'));
    if (m.date) body.push(para(m.date));
    body.push(para('Summary', 'Heading1'));
    for (const line of m.summary.split('\n')) {
        if (line.trim()) body.push(para(line));
    }
    body.push(para('Decisions', 'Heading1'));
    if (m.decisions.length) {
        for (const d of m.decisions) body.push(para(`\u2022 ${d}`));
    } else {
        body.push(para('None recorded.'));
    }
    body.push(para('Action items', 'Heading1'));
    if (m.actionItems.length) {
        for (const item of m.actionItems) {
            let line = `\u2022 ${item.task}`;
            if (item.owner) line += ` (owner: ${item.owner})`;
            if (item.due) line += ` (due: ${item.due})`;
            body.push(para(line));
        }
    } else {
        body.push(para('None recorded.'));
    }
    if (m.chapters.length) {
        body.push(para('Chapters', 'Heading1'));
        for (const c of m.chapters) {
            body.push(para(`${mmss(c.startMs)}  ${c.title}`));
        }
    }

    const documentXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        body.join('') +
        `<w:sectPr>` +
        `<w:pgSz w:w="12240" w:h="15840"/>` +   // US Letter: 8.5" x 11" at 1440 twips/inch
        `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
        `</w:sectPr>` +
        `</w:body>` +
        `</w:document>`;

    const stylesXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>` +
        `</w:styles>`;

    const contentTypesXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `</Types>`;

    const relsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`;

    const documentRelsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`;

    const enc = new TextEncoder();
    return zipStore([
        { name: '[Content_Types].xml', data: enc.encode(contentTypesXml) },
        { name: '_rels/.rels', data: enc.encode(relsXml) },
        { name: 'word/_rels/document.xml.rels', data: enc.encode(documentRelsXml) },
        { name: 'word/document.xml', data: enc.encode(documentXml) },
        { name: 'word/styles.xml', data: enc.encode(stylesXml) },
    ]);
}
