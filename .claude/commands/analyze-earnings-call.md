---
name: analyze-earnings-call
description: Analyze a company's latest (or a given quarter's) earnings call — results vs guidance, raised or lowered guidance, analyst focus, tone change against the prior call — with timestamped evidence.
argument-hint: <ticker> [fiscal year + quarter, e.g. 2026 Q3]
---

# Analyze Earnings Call

Analyze the earnings call requested in `$ARGUMENTS` using Invinite Data. Prefer the MCP tools (`earnings_call_*`) when connected; otherwise use the `invd earnings` commands below with `--json`.

1. **Find the call.** Without a quarter, take the latest call that already happened: `invd earnings events -i <TICKER> --to <today> -s desc -l 1 --json` (MCP `earnings_call_events`). With a quarter, select it directly with `-i <TICKER> --year <YYYY> --quarter <Q>`. Use the call's `event_id` for every later step (`--event <event_id>`). If the call has no transcript yet, say so and stop.
2. **Fetch in parallel** (all with `--event <event_id> --json`):
   - press release: `invd earnings press-release` (`earnings_call_press_release`)
   - guidance: `invd earnings extractions --kind guidance` and KPIs: `invd earnings extractions --kind kpi` (`earnings_call_guidance`)
   - Q&A: `invd earnings qa` (`earnings_call_qa`) and participants: `invd earnings participants` (`earnings_call_participants`)
   - diff vs the prior call: `invd earnings diff` (`earnings_call_diff`)
   - only when a claim needs the exact wording: `invd earnings transcript` (`earnings_call_transcript`) or `invd earnings search -q "<topic>" --event <event_id>` (`earnings_call_search`)
3. **Summarise**:
   - **Results vs guidance** — reported figures from the press release against the guidance given on the prior call (`invd earnings guidance-history -i <TICKER> --metric <metric>` for a metric's series).
   - **Guidance changes** — each item raised, lowered, maintained, introduced or withdrawn (`direction`), with the period and basis (GAAP / non-GAAP).
   - **Analyst focus** — the recurring Q&A themes, who asked (firm), and where management deflected.
   - **Tone change** — the diff's tone shift, hedging / uncertainty changes and new or dropped topics.
4. **Cite evidence** — every quote or claim carries its `[m:ss]` timestamp (from `start_ms`) and the speaker; separate what was said from your interpretation.
5. Flag what is missing (no press release, no guidance extracted, prior call not covered) instead of inferring it.
