// Draws the three thumbnail options (docs/specs/011-thumbnails.md) on a 1280x720 canvas, in the
// browser, so a text edit or another frame shows at once. What is drawn here is exactly what is
// approved and uploaded. Type: Outfit Black, the site's heading font; gold for *marked* words.

import { hookWords, THUMB_HEIGHT as H, THUMB_WIDTH as W, type ThumbKind } from "@/lib/thumbnail";
import { DEFAULT_SETTINGS, lighten, type StudioSettings } from "@/lib/studioSettings";

// The brand colours: the Studio settings' (lib/studioSettings.ts), set by drawThumbnail before
// each drawing. By default the deep violet of the logo's ground and the gold.
let INK = "#140a2e";
let GOLD = "#f7c65b";
let GLOW = ["#4a2f9c", "#23145a"];
let INK_RGB = "20, 10, 46";
let GOLD_RGB = "247, 198, 91";
const WHITE = "#ffffff";

const rgbList = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");

function applyPalette(colors: StudioSettings["colors"]) {
    const d = DEFAULT_SETTINGS.colors;
    INK = colors.background;
    GOLD = colors.accent;
    GLOW = colors.background === d.background ? ["#4a2f9c", "#23145a"] : [lighten(colors.background, 0.25), lighten(colors.background, 0.08)];
    INK_RGB = rgbList(colors.background);
    GOLD_RGB = rgbList(colors.accent);
}

export interface ThumbImages {
    frame: ImageBitmap | null;
    ai: ImageBitmap | null;
    logo: ImageBitmap | null;
}

type Word = { text: string; gold: boolean };

// Fills the box with the image, cropping the overflow around the focus point.
function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number, focusX = 0.5) {
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale, sh = h / scale;
    const sx = Math.min(Math.max(0, img.width * focusX - sw / 2), img.width - sw);
    ctx.drawImage(img, sx, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// Largest size at which the words wrap into at most `maxLines` lines of `maxWidth`.
function fit(ctx: CanvasRenderingContext2D, words: Word[], family: string, maxWidth: number, maxLines: number, maxSize: number, minSize: number) {
    for (let size = maxSize; ; size -= 4) {
        ctx.font = `900 ${size}px ${family}`;
        const space = ctx.measureText(" ").width;
        const lines: Word[][] = [];
        let line: Word[] = [], width = 0, tooWide = false;
        for (const word of words) {
            const w = ctx.measureText(word.text).width;
            if (w > maxWidth) tooWide = true;
            if (line.length && width + space + w > maxWidth) {
                lines.push(line);
                line = [];
                width = 0;
            }
            width += (line.length ? space : 0) + w;
            line.push(word);
        }
        if (line.length) lines.push(line);
        if ((lines.length <= maxLines && !tooWide) || size - 4 < minSize) return { size, lines };
    }
}

// Text block with its top at `top`; returns its height. A dark outline and glow keep it
// readable over any picture.
function drawText(ctx: CanvasRenderingContext2D, lines: Word[][], size: number, family: string, x: number, top: number) {
    const lineHeight = size * 1.02;
    ctx.font = `900 ${size}px ${family}`;
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    const space = ctx.measureText(" ").width;
    lines.forEach((line, i) => {
        const y = top + size * 0.86 + i * lineHeight;
        let cx = x;
        for (const word of line) {
            ctx.save();
            ctx.shadowColor = "rgba(10, 0, 30, 0.8)";
            ctx.shadowBlur = size * 0.3;
            ctx.lineWidth = size * 0.09;
            ctx.strokeStyle = INK;
            ctx.strokeText(word.text, cx, y);
            ctx.restore();
            ctx.fillStyle = word.gold ? GOLD : WHITE;
            ctx.fillText(word.text, cx, y);
            cx += ctx.measureText(word.text).width + space;
        }
    });
    return lines.length * lineHeight;
}

function accent(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = GOLD;
    ctx.fillRect(x, y, 110, 9);
}

function logo(ctx: CanvasRenderingContext2D, img: ImageBitmap | null, x: number, y: number, size: number) {
    if (!img) return;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 16;
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

export function drawThumbnail(ctx: CanvasRenderingContext2D, kind: ThumbKind, text: string, images: ThumbImages, family: string,
    colors: StudioSettings["colors"] = DEFAULT_SETTINGS.colors) {
    applyPalette(colors);
    const words = hookWords(text);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, W, H);

    if (kind === "frame") {
        // The face fills the picture; the text sits along the bottom.
        if (images.frame) cover(ctx, images.frame, 0, 0, W, H);
        const shade = ctx.createLinearGradient(0, H * 0.4, 0, H);
        shade.addColorStop(0, `rgba(${INK_RGB}, 0)`);
        shade.addColorStop(1, `rgba(${INK_RGB}, 0.92)`);
        ctx.fillStyle = shade;
        ctx.fillRect(0, H * 0.4, W, H * 0.6);
        const { size, lines } = fit(ctx, words, family, W - 128, 2, 150, 56);
        const height = lines.length * size * 1.02;
        const top = H - 52 - height;
        accent(ctx, 64, top - 26);
        drawText(ctx, lines, size, family, 64, top);
        logo(ctx, images.logo, W - 184, 18, 166);
    } else if (kind === "ai") {
        // The picture's subject is on the right; the text in the calm left third.
        if (images.ai) cover(ctx, images.ai, 0, 0, W, H, 0.55);
        const shade = ctx.createLinearGradient(0, 0, W * 0.62, 0);
        shade.addColorStop(0, `rgba(${INK_RGB}, 0.88)`);
        shade.addColorStop(1, `rgba(${INK_RGB}, 0)`);
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, W * 0.62, H);
        const { size, lines } = fit(ctx, words, family, 590, 4, 140, 52);
        const height = lines.length * size * 1.02;
        const top = (H - height) / 2 + 10;
        accent(ctx, 64, top - 30);
        drawText(ctx, lines, size, family, 64, top);
        logo(ctx, images.logo, W - 184, 18, 166);
    } else {
        // The same layout every episode, so the channel reads as one series.
        const glow = ctx.createRadialGradient(W * 0.72, H * 0.5, 40, W * 0.72, H * 0.5, W * 0.7);
        glow.addColorStop(0, GLOW[0]);
        glow.addColorStop(0.55, GLOW[1]);
        glow.addColorStop(1, INK);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = `rgba(${GOLD_RGB}, 0.55)`;
        ctx.lineWidth = 3;
        ctx.strokeRect(18, 18, W - 36, H - 36);

        const px = 668, py = 96, pw = 548, ph = 528;
        ctx.save();
        ctx.shadowColor = `rgba(${GOLD_RGB}, 0.45)`;
        ctx.shadowBlur = 40;
        roundRect(ctx, px, py, pw, ph, 28);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.restore();
        ctx.save();
        roundRect(ctx, px, py, pw, ph, 28);
        ctx.clip();
        if (images.frame) cover(ctx, images.frame, px, py, pw, ph);
        ctx.restore();
        roundRect(ctx, px, py, pw, ph, 28);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 6;
        ctx.stroke();

        logo(ctx, images.logo, 48, 34, 190);
        const { size, lines } = fit(ctx, words, family, 560, 3, 112, 48);
        const height = lines.length * size * 1.02;
        const top = Math.max(280, 250 + (H - 250 - height) / 2);
        accent(ctx, 64, top - 30);
        drawText(ctx, lines, size, family, 64, top);
    }
}

// The canvas as a JPEG for YouTube (under 2 MB), base64 without the data: prefix.
export async function canvasJpeg(canvas: HTMLCanvasElement, maxBytes: number) {
    for (const quality of [0.92, 0.85, 0.75, 0.6]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob) throw new Error("Could not export the thumbnail");
        if (blob.size <= maxBytes) {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return btoa(binary);
        }
    }
    throw new Error("The thumbnail is over YouTube's 2 MB limit");
}
