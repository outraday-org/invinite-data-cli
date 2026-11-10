---
name: analyze-earnings-call
description: Analyze a company's latest (or a given quarter's) earnings call — results vs guidance, raised or lowered guidance, analyst focus, tone change against the prior call — with timestamped evidence.
argument-hint: <ticker> [fiscal year + quarter, e.g. 2026 Q3]
---

# Analyze Earnings Call

Analyze the earnings call requested in `$ARGUMENTS` using Invinite Data. Prefer the MCP tools when connected (`list_events`, `get_event`, `search_transcripts`, `get_news`; the server also offers the `analyse_earnings_call` prompt); otherwise use the `invd events` commands below with `--json`.

1. **Find the call.** Without a quarter, take the latest call that already happened: `invd events AAPL --status ended --sort -scheduled_at --limit 1 --json` (MCP `list_events`). With a quarter, pass the company and fiscal period wherever an `event_id` goes (`invd events get AAPL 2026Q3 --json`); invd resolves the event and notes it on stderr. Use the call's `event_id` for every later step. If `has_transcript` is false, say so and stop.
2. **Fetch in parallel** (all with `--json`; MCP `get_event` unless noted):
   - press release: `invd events press-release <event_id>`
   - guidance: `invd guidance AAPL --event <event_id>` and KPIs: `invd guidance kpis AAPL --event <event_id>`
   - Q&A: `invd events qa <event_id>` and participants: `invd people participants --event <event_id>`
   - comparison with the prior call: `invd events comparison <event_id>`
   - call statistics (talk time, Q&A length): `invd events stats <event_id>`
   - optional, price moves during the call: `invd events price-attribution <event_id>` — minute returns next to what was being said; skip it when the call is not attributed
   - only when a claim needs the exact wording: `invd events transcript-text <event_id> --split sections`, `invd events transcript AAPL 2026Q3` (turns with `start_ms`), or `invd search transcripts "<keywords>" --event <event_id>` (MCP `search_transcripts`; `--mode literal` for an exact figure, term or quote)
   - when the call has documents (`has_documents`): `invd investor-documents AAPL --event <event_id>` (CFO commentary, shareholder letter, data sheets); for context beyond the call (annual report, investor-day deck) `invd search investor-documents "<keywords>" --company AAPL`; a `meta.coverage` of `pending` / `partial` means no hits is not proof the topic is absent
3. **Summarise**:
   - **Results vs guidance** — reported figures from the press release against the guidance given on the prior call (`invd guidance AAPL --metric revenue` for a metric's series across calls).
   - **Guidance changes** — each item raised, lowered, maintained, introduced or withdrawn (`direction`), with the period and basis (GAAP / non-GAAP).
   - **Analyst focus** — the recurring Q&A themes, who asked (firm), and where management deflected.
   - **Tone change** — the comparison's tone shift, hedging / uncertainty changes and new or dropped topics.
   - **Price moves during the call** (only when fetched) — the largest minutes and what was being said then. Word it as temporal coincidence, never as the cause of the move; pre-market bars are sparse.
4. **Cite evidence** — every quote or claim carries its `[m:ss]` timestamp (from `start_ms`) and the speaker; a passage from a company document carries its title, year and page and is described as company-published, not as a verified fact; separate what was said from your interpretation.
5. Flag what is missing (no press release, no guidance extracted, prior call not covered) instead of inferring it.
