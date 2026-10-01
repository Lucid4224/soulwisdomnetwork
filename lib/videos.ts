// Formatting for the Videos pages (app/videos). Fixed locale and time zone, so the server and
// the browser print the same.

export function duration(seconds: number): string {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function views(n: number): string {
    return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)} ${n === 1 ? "view" : "views"}`;
}

export function date(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function counts(all: { short: boolean }[] | null): { episodes: number; shorts: number } {
    const shorts = all?.filter(v => v.short).length ?? 0;
    return { episodes: (all?.length ?? 0) - shorts, shorts };
}
