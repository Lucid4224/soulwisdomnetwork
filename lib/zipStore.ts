// A minimal ZIP writer (no compression, "stored" entries), enough to build a Word .docx in the
// browser or on the server without adding a dependency. Each file's bytes go in as they are,
// with the CRC-32 that ZIP readers check.

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// Files in the order given; names use forward slashes, e.g. "word/document.xml".
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = crc32(f.data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);       // local file header
        local.setUint16(4, 20, true);               // version needed
        local.setUint16(6, 0x0800, true);           // UTF-8 names
        local.setUint16(8, 0, true);                // stored
        local.setUint16(10, 0, true);               // time
        local.setUint16(12, 0x21, true);            // date: 1980-01-01
        local.setUint32(14, crc, true);
        local.setUint32(18, f.data.length, true);
        local.setUint32(22, f.data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, f.data);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);       // central directory header
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(10, 0, true);
        entry.setUint16(12, 0, true);
        entry.setUint16(14, 0x21, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, f.data.length, true);
        entry.setUint32(24, f.data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);          // where the local header starts
        central.push(new Uint8Array(entry.buffer), name);
        offset += 30 + name.length + f.data.length;
    }
    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);             // end of central directory
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
}
