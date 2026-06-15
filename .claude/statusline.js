#!/usr/bin/env node
// Claude Code status line — model, context, 5h limit, weekly limit.
// Reads the session JSON from stdin (see https://code.claude.com/docs/en/statusline).
// Cross-platform: Node is guaranteed present wherever Claude Code runs.

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    raw += chunk;
});
process.stdin.on("end", () => {
    if (!raw.trim()) return;
    let d;
    try {
        d = JSON.parse(raw);
    } catch {
        return;
    }

    const ESC = "\x1b";
    const R = `${ESC}[0m`;
    const DIM = `${ESC}[2m`;
    const CYA = `${ESC}[36m`;
    const MAG = `${ESC}[35m`;

    const color = (pct) => {
        const p = Number(pct);
        if (!Number.isFinite(p)) return `${ESC}[32m`;
        if (p >= 90) return `${ESC}[31m`;
        if (p >= 70) return `${ESC}[33m`;
        return `${ESC}[32m`;
    };

    const fmtTokens = (n) => {
        const v = Number(n) || 0;
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
        return `${Math.round(v)}`;
    };

    const fmtReset = (epoch) => {
        if (!epoch) return "";
        const dt = new Date(Number(epoch) * 1000);
        const now = new Date();
        const hh = String(dt.getHours()).padStart(2, "0");
        const mm = String(dt.getMinutes()).padStart(2, "0");
        const sameDay = dt.toDateString() === now.toDateString();
        if (sameDay) return `${hh}:${mm}`;
        const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
        return `${wd} ${hh}:${mm}`;
    };

    // Model
    let model = (d?.model?.display_name || "Claude").replace("(1M context)", "(1M)");

    // Context window
    const ctxUsed = d?.context_window?.total_input_tokens ?? 0;
    const ctxTotal = d?.context_window?.context_window_size ?? 200000;
    const ctxPct = d?.context_window?.used_percentage ?? 0;
    const ctxStr = `${fmtTokens(ctxUsed)}/${fmtTokens(ctxTotal)} ${Math.floor(Number(ctxPct) || 0)}%`;

    // 5-hour rolling limit
    const h5Pct = d?.rate_limits?.five_hour?.used_percentage;
    const h5Rs = fmtReset(d?.rate_limits?.five_hour?.resets_at);
    const h5Str = h5Pct != null ? `${Math.round(Number(h5Pct))}/100%${h5Rs ? ` ${DIM}${h5Rs}${R}` : ""}` : "n/a";

    // 7-day (weekly) rolling limit
    const wkPct = d?.rate_limits?.seven_day?.used_percentage;
    const wkRs = fmtReset(d?.rate_limits?.seven_day?.resets_at);
    const wkStr = wkPct != null ? `${Math.round(Number(wkPct))}/100%${wkRs ? ` ${DIM}${wkRs}${R}` : ""}` : "n/a";

    const sep = `${DIM}|${R}`;
    process.stdout.write(
        `${MAG}${model}${R} ${CYA}ctx${R} ${color(ctxPct)}${ctxStr}${R} ${sep} ` +
            `${CYA}5h${R} ${color(h5Pct)}${h5Str}${R} ${sep} ` +
            `${CYA}wk${R} ${color(wkPct)}${wkStr}${R}\n`
    );
});
