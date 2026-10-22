---
name: invinite-financial-data
description: Fetch financial data through the Invinite Data API MCP connector or invd CLI. Use whenever the user wants company information, financial statements, SEC filings, institutional ownership, insider trades, IPO data, market holidays, financial metrics, earnings calls, or other stock/company data, including requests mentioning tickers, CIKs, balance sheets, income statements, cash flows, 10-K, 10-Q, ratios, CAGR, growth rates, dividends, stock splits, institutional holdings, call transcripts, earnings guidance, KPIs, Q&A, analysts, live calls, slides, or press releases.
allowed-tools: Bash(invd *)
---

# Invinite Data API

Use the connected Invinite Data API MCP tools when available. Fall back to the `invd` CLI when MCP is unavailable. Both transports access the same Data API, billed to your Invinite Data account.

## Transport selection

1. Prefer MCP tools when an Invinite Data connector is available. Call the direct domain tool matching the request; unlike the Web API MCP server, the Data API MCP server does not use meta-tools such as `call_endpoint`.
2. Use the CLI examples below when MCP is unavailable or when the user explicitly requests CLI usage. Always pass `--json` for data used in analysis.
3. Do not mix transports merely to repeat a successful request.

### MCP and CLI mapping

| Data need | MCP tool | CLI command family |
|---|---|---|
| Search/details/list | `company_search`, `company_details`, `available_companies` | `invd company search\|details\|list` |
| Dividends/periods/splits | `company_dividends`, `company_fiscal_periods`, `company_splits` | `invd company dividends\|fiscal-periods\|splits` |
| Standardized statements/snapshots | `standardized_financial_statement`, `standardized_financial_snapshot` | `invd financials <statement>[-detailed\|-presentation]`, `invd financials snapshot…` |
| As-reported statements/snapshots | `as_reported_financial_statement`, `as_reported_financial_snapshot` | `invd financials as-reported-<statement>…`, `invd financials as-reported-snapshot…` |
| Ratios/growth/CAGR | `financial_ratios`, `financial_growth`, `financial_cagr` | `invd metrics ratios\|growth\|cagr` |
| Segment data | `segmented_financials` | `invd segments list\|list-detailed` |
| SEC filings/search/sections | `sec_filings`, `sec_filings_search`, `sec_filing_sections` | `invd filings list\|search\|sections` |
| Filing and metric discovery | `sec_available_form_types`, `list_available_section_ids`, `list_available_metrics` | `invd filings form-types`, `invd metadata section-ids\|metrics` |
| Institutional ownership | `holdings_by_company`, `holdings_by_investor`, `institutional_investors`, `institutional_transactions` | `invd ownership …` |
| Insider trades/IPOs/holidays | `insider_trades`, `ipos`, `market_holidays` | `invd insider-trades list`, `invd ipos list`, `invd market holidays` |
| Earnings call calendar/events/live | `earnings_call_calendar`, `earnings_call_events`, `earnings_call_live` | `invd earnings calendar\|events\|live` |
| Call transcript/Q&A/participants | `earnings_call_transcript`, `earnings_call_qa`, `earnings_call_participants` | `invd earnings transcript\|qa\|participants` |
| Call guidance/KPIs, diff vs prior call | `earnings_call_guidance`, `earnings_call_diff` | `invd earnings extractions\|guidance-history\|diff` |
| Call documents/press release | `earnings_call_documents`, `earnings_call_press_release` | `invd earnings documents\|press-release` |
| Price moves during a call (coincidence, not cause; live rows during the call) | `earnings_call_price_moves` | `invd earnings price-attribution` |
| Search across calls | `earnings_call_search` | `invd earnings search` |
| Company IR documents (annual reports, proxy, ESG, investor-day decks, letters, webcast pages) | `earnings_company_documents`, `earnings_company_document` | `invd earnings company-documents\|document` |
| Search company documents (passages with page numbers) | `earnings_document_search` | `invd earnings document-search` |
| Keyword / guidance alerts | `earnings_call_alert_create\|list\|update\|delete\|test\|deliveries` | `invd webhooks …` |

The discovery rules below apply to both transports: call `list_available_metrics` before ratios, growth, CAGR, or financial-statement analysis, and call `list_available_section_ids` before requesting filing sections.

## Prerequisites

### MCP

Connect `https://api.data.invinite.com/mcp` through OAuth and sign in to your Invinite Data account, which is billed for the calls. Leave OAuth client ID and secret empty so the client uses Dynamic Client Registration and PKCE.

### CLI

Install the CLI with `npm install -g @invinite-org/invinite-data-cli`, then run `invd login`. Authentication is resolved in this order:
1. `INVINITE_DATA_API_KEY` environment variable
2. `.env` file
3. OS keychain (via optional `keytar`)
4. Stored config

If an MCP call fails with an auth error, reconnect the connector and complete OAuth. If a CLI call fails with an auth error, run `invd login`; manual `invd config set-key` and `INVINITE_DATA_API_KEY` remain supported fallbacks (create a key at https://data.invinite.com/keys).

## Global Options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON (always use this for programmatic access) |
| `--all` | Auto-paginate through all results (paginated commands only; others refuse it by name) |
| `--show-cost` | Print `credits: <charged> · included left: <remaining>` to stderr after the command (or set `INVD_SHOW_COST=1`); stdout stays clean |

Every data command's flags are the API parameters of its operation, spelled with dashes (`fiscal_period_type` → `--fiscal-period-type`, `event_id` → `--event-id`); `invd <group> <action> --help` lists them with the API's own descriptions. The two write commands (`webhooks create`, `webhooks update`) take the request body as `--body '<json>'` or `--body-file <path>` (`-` reads stdin).

### Usage and credits

Before a large pull (`--all`, many tickers, filing search at 100 credits a call), run `invd usage --json` (free, `--days 7|30|90`): `period` has the plan's `included_credits`, `used_credits`, `resets_at` and `prepaid_balance_usd`; `daily`, `by_family` and `by_key` show where credits went. If the pull would not fit what is left, say so before starting it. For budgeting, add `--show-cost` to a sample call and multiply; the stderr line never mixes into `--json` output. Every operation's credit cost is the `x-credits` field of the OpenAPI spec.

## Working with the data

### Financial statements

`-p, --fiscal-period-type` is required: `quarterly`, `annual`, `ytd`, or `ttm`. Each statement (`income-statement`, `balance-sheet`, `cash-flow`, `snapshot`) is one command per variant:

- `<statement>` — standardized values keyed by `metric_id`
- `<statement>-detailed` — adds formula, accession number, HTML tag info (`--with-formula true` for formulas)
- `<statement>-presentation` — nested tree structure (hierarchical)
- `as-reported-<statement>[-detailed|-presentation]` — the as-reported data instead of standardized

Financial statement responses use standardized `metric_id` keys (from `metadata metrics`) as field names. If you need to understand what a specific metric_id means, check `invd metadata metrics --json` first. The snapshot commands take `-i, --identifiers` (comma-separated tickers) and are the most efficient way to get complete financials for several companies at once.

```bash
invd financials income-statement -i AAPL -p annual --json
invd financials balance-sheet -i MSFT -p quarterly --limit 4 --json
invd financials as-reported-cash-flow -i GOOGL -p annual --json
invd financials snapshot -i AAPL,MSFT,GOOGL -p annual --json
invd financials snapshot -i AAPL -p quarterly --calendar-year 2024 --calendar-quarter 3 --json
```

### Financial metrics

**Before querying any metrics endpoint (ratios, CAGR, or growth), first fetch the available metric identifiers using `metadata metrics`.** The response from ratios/CAGR/growth uses `metric_id` keys (e.g., `PR_TO_EARNINGS`, `CURRENT_RATIO`) — without knowing the available IDs, you won't know what data exists or how to interpret the results. This also helps you confirm that the metric the user is asking about actually exists.

```bash
# STEP 1: Always fetch available metrics first
invd metadata metrics --json
# Returns: { metrics: [{ metric_id: "...", name: "..." }, ...] }

# STEP 2: Then query the specific metrics endpoint
invd metrics ratios -i AAPL -p annual --category profitability --json   # valuation, profitability, liquidity, solvency
invd metrics cagr -i AAPL --period-years 5 --json                       # 3, 5 or 10 years
invd metrics growth -i MSFT -p quarterly --growth-type year_over_year --json
```

The metrics response structures differ by endpoint:
- **Ratios**: `period.facts[category][metric_id]` — organized by category (valuation, profitability, etc.)
- **CAGR**: `period.facts[years][metric_id]` — organized by time period (3-year, 5-year, 10-year)
- **Growth**: `period.facts[growthType][metric_id]` — organized by growth type (year_over_year, quarter_over_quarter)

All share the same `metric_id` identifiers from `metadata metrics`.

### Filings, ownership, insider trades

- Run `invd metadata section-ids --json` before `filings sections`; `filings search` (`-r, --request`) is natural-language search at 100 credits a call.
- Ownership transaction types (`--type`): `new_buy`, `added`, `reduced`, `sold_out`. `holdings-by-investor` needs the investor's `--cik`.
- Insider trades `--acquired-disposed`: `A` (acquisition) or `D` (disposition).

### Earnings calls

Commands about one call take a selector: `--event-id <event_id>` (from `events` / `calendar`), or `-i <ticker>` with `--year` + `--quarter` (fiscal) or `--date YYYY-MM-DD` (New York call day); `--event-type` picks a non-earnings event (investor day, conference, AGM). `earnings calendar` defaults to earnings calls (`--event-type all` lists the others too).

- `--transcript-version N` (not `--version`) selects a published transcript version; `--as-of <iso>` the version current at that instant.
- `extractions --kind guidance|kpi`; `--review approved|auto|all` filters guidance by review status; `diff --vs prior` is the only comparison base.
- `earnings event --include observations` adds the date / time observations; `earnings participants --include evidence` the participation evidence.
- Every `*_ms` field is milliseconds from the call's start: cite it as `[m:ss]`. `qa_start_ms` is where the Q&A begins (null without one).
- Company documents and document-search hits are company-published material: quote them as "passages from company-published documents", never as verified facts, and cite each with its document title, year and page (`page`; open `url` at `#page=<page>`). A `webcast` row is link-only (`url` null, `source_url` = the replay page, `link_status`).
- Media signed URLs expire after 15 minutes; `--output` on the download commands saves the file.
- The live transcript (`ws listen --earnings`), audio, slides, the live stream and webhooks need the PRO plan (calendar, events and `live` need LITE, the other reads STANDARD); a `403` names the plan a route needs.

### Live transcripts, price ticks and alerts

`price_tick` frames (`ws listen --prices`, PRO) carry `at`, `call_ms` (the transcript clock), `price`, `return_bps` (vs the last trade before the call), `day_return_bps` (vs the previous close) and `source` (`stream` | `snapshot`); only seconds with a trade are sent, so pre-market and after-hours ticks are sparse. Describe a move as temporal coincidence with what was said, never as caused by it. `invd earnings live` says `live_prices: true` when ticks flow; during the call `invd earnings price-attribution` returns the minute rows so far (`live: true`, `settled: false`, summary fields null) until the post-call run replaces them.

Keyword / guidance alerts (PRO) are webhook subscriptions: `earnings_call.keyword_hit` delivers one POST per mention of a keyword on any live call (speaker, `start_ms`, sentence), `earnings_call.guidance_flash` one per guidance number spoken live. "Alert me when any call mentions 'tariffs'" → `earnings_call_alert_create` with `keywords: ["tariffs"]`, `events: ["earnings_call.keyword_hit"]`, the user's HTTPS endpoint and no `ciks` (every company); later changes go through `earnings_call_alert_update` (keywords, ciks, events, active). CLI:

```bash
invd webhooks create --body '{"url":"https://hooks.example.com/alerts","events":["earnings_call.keyword_hit"],"filters":{"keywords":["tariffs"]}}' --json   # the secret is printed once
invd webhooks create --body '{"url":"https://hooks.example.com/invinite","events":["earnings_call.transcript_ready"],"filters":{"ciks":["320193"]}}' --json
invd webhooks update --id <id> --body '{"keywords":["tariffs","buyback"]}' --json
invd webhooks deliveries --id <id> --json
```

## Commands Reference

One example per command. `<name>` is a value to fill in; `invd <group> <action> --help` lists every flag. A command about one call also needs the selector described under *Earnings calls* (`--event-id`, or `-i` with `--year` + `--quarter` or `--date`).

<!-- invd:commands:start -->
<!-- Generated by `pnpm skill:commands` from src/generated/cli-manifest.json and src/hand-written-commands.ts. Edit only inside an invd:hand block; `pnpm skill:commands:check` fails on drift. -->

### company

Company search, details, fiscal periods, dividends and splits

```bash
# Company details
invd company details -i AAPL --json

# Company dividends (optional: --start-date, --end-date, --sort, --limit, --offset, --all)
invd company dividends -i AAPL --json

# Company fiscal periods (optional: --sort, --limit, --offset, --all)
invd company fiscal-periods -i AAPL --json

# List available companies
invd company list --json

# Search companies (optional: --limit, --offset, --all)
invd company search -q apple --json

# Stock splits (optional: --sort, --limit, --offset, --all)
invd company splits -i AAPL --json
```

### config

<!-- invd:hand:config -->
```bash
invd config set-key                                   # masked prompt for an API key
invd config set-url https://api.data.invinite.com     # API host
invd config show
invd config reset
```
<!-- /invd:hand:config -->

### earnings

Earnings calls: calendar, transcripts, Q&A, extractions, media, search and webhook subscriptions

```bash
# Analysts of a company (optional: --limit, --offset, --all)
invd earnings analysts -i MSFT --json

# Earnings call calendar (optional: --from, --to, --status, --session, --exchange, --event-type, --sort, --limit, --offset, --all)
invd earnings calendar --json

# Call-over-call diff (optional: --event-id, --identifier, --year, --quarter, --date, --event-type, --vs)
invd earnings diff --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Search investor documents (optional: --identifier, --kind, --section, --year, --table, --limit)
invd earnings document-search -q "Azure growth" -i MSFT --json

# Earnings call by ID (optional: --include)
invd earnings event --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Event history of a company (optional: --from, --to, --include, --event-type, --sort, --limit, --offset, --all)
invd earnings events -i MSFT --json

# Guidance and KPI extractions (optional: --event-id, --identifier, --year, --quarter, --date, --event-type, --kind, --review, --limit, --offset, --all)
invd earnings extractions --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Guidance history (optional: --period-kind, --basis, --limit)
invd earnings guidance-history -i MSFT --metric revenue --json

# Live earnings calls
invd earnings live --json

# Earnings call metrics (optional: --event-id, --identifier, --year, --quarter, --date, --event-type)
invd earnings metrics --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Earnings call participants (optional: --event-id, --identifier, --year, --quarter, --date, --event-type, --include)
invd earnings participants --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Person across earnings calls (optional: --limit, --offset, --all)
invd earnings person --person-id 9b135e05-d7c2-4d23-9c89-728501ad8e58 --json

# Price moves during a call (optional: --event-id, --identifier, --year, --quarter, --date, --event-type)
invd earnings price-attribution --event-id dd04abe1-f83f-4e92-8ddf-1f8864e7db30 --json

# Speaker prosody (optional: --event-id, --identifier, --year, --quarter, --date, --event-type, --section)
invd earnings prosody --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Earnings call Q&A (optional: --event-id, --identifier, --year, --quarter, --date, --event-type, --limit, --offset, --include, --all)
invd earnings qa --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Search earnings calls (optional: --event-id, --identifier, --from, --to, --type, --event-type, --limit)
invd earnings search -q "Azure growth" -i MSFT --json

# Live audio stream URL (optional: --event-id, --identifier, --year, --quarter, --date, --event-type)
invd earnings stream --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json

# Transcript version diff (optional: --event-id, --identifier, --year, --quarter, --date, --event-type, --to)
invd earnings transcript-diff --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --from 3 --json

# Transcript versions (optional: --event-id, --identifier, --year, --quarter, --date, --event-type)
invd earnings versions --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c --json
```

<!-- invd:hand:earnings transcript -->
```bash
# Transcript (formats: speakers, text, words, sections, cleaned); --output saves it as text
invd earnings transcript -i AAPL --year 2026 --quarter 4 --format speakers --json
invd earnings transcript --event-id <event_id> --format sections --json
invd earnings transcript -i AAPL --year 2026 --quarter 4 --output aapl-q4.txt
```
<!-- /invd:hand:earnings transcript -->

<!-- invd:hand:earnings press-release -->
```bash
# Press release of a call; --body includes its text, --output saves it
invd earnings press-release --event-id <event_id> --body --json
invd earnings press-release -i AAPL --year 2026 --quarter 4 --body --output release.txt
```
<!-- /invd:hand:earnings press-release -->

<!-- invd:hand:earnings audio -->
```bash
# Call recording (PRO); --output saves the file from its signed URL (expires after 15 min)
invd earnings audio --event-id <event_id> --json
invd earnings audio --event-id <event_id> --output call.mp3
```
<!-- /invd:hand:earnings audio -->

<!-- invd:hand:earnings slides -->
```bash
# Slide deck (PRO): --markdown prints the page markdown, --output saves the PDF
invd earnings slides --event-id <event_id> --markdown --json
invd earnings slides -i AAPL --year 2026 --quarter 4 --output deck.pdf
```
<!-- /invd:hand:earnings slides -->

<!-- invd:hand:earnings documents -->
```bash
# A call's documents; --output downloads every row into a directory (a link-only sec_filing row is warned on stderr; use its source_url)
invd earnings documents --event-id <event_id> --kind cfo_commentary --json
invd earnings documents --event-id <event_id> --output ./docs
```
<!-- /invd:hand:earnings documents -->

<!-- invd:hand:earnings company-documents -->
```bash
# Company IR library (outside the calls' folders); --output downloads every stored file: <year>-<kind>-<document_id>.<ext>
invd earnings company-documents -i AAPL --section annual_reports,proxy --json
invd earnings company-documents -i AAPL --kind investor_day_deck --output ./ir-docs
# The document tree: a category (earnings, events, news, reports, presentations, governance, esg, shareholder, other) or a folder (prefix)
invd earnings company-documents -i AAPL --category reports,esg --json
invd earnings company-documents -i AAPL --group earnings/fy2026/q4 --json
```
<!-- /invd:hand:earnings company-documents -->

<!-- invd:hand:earnings document -->
```bash
# One company document: metadata, --pages for per-page text, --output to download it
invd earnings document --document-id <document_id> --pages --json
invd earnings document --document-id <document_id> --output annual-report.pdf
```
<!-- /invd:hand:earnings document -->

### filings

SEC filings, their parsed sections and natural-language filing search

```bash
# Available SEC form types (optional: --identifier)
invd filings form-types --json

# SEC filings (optional: --form-type, --sort, --limit, --offset, --all)
invd filings list -i AAPL --json

# Search SEC filings (optional: --identifier, --accession-number)
invd filings search -r "What are Apple's main risk factors?" -i AAPL --json

# SEC filing sections (optional: --section-id, --accession-number, --fiscal-year, --fiscal-quarter)
invd filings sections -i AAPL --form-type 10-K --fiscal-year 2025 --json
```

### financials

Financial statements (standardized & as-reported)

```bash
# As-reported balance sheet (optional: --sort, --limit, --offset, --all)
invd financials as-reported-balance-sheet -i AAPL -p annual --json

# As-reported balance sheet (detailed) (optional: --sort, --limit, --offset, --with-formula, --all)
invd financials as-reported-balance-sheet-detailed -i AAPL -p annual --json

# As-reported balance sheet (presentation) (optional: --sort, --limit, --offset, --all)
invd financials as-reported-balance-sheet-presentation -i AAPL -p annual --json

# As-reported cash flow statement (optional: --sort, --limit, --offset, --all)
invd financials as-reported-cash-flow -i AAPL -p annual --json

# As-reported cash flow statement (detailed) (optional: --sort, --limit, --offset, --with-formula, --all)
invd financials as-reported-cash-flow-detailed -i AAPL -p annual --json

# As-reported cash flow statement (presentation) (optional: --sort, --limit, --offset, --all)
invd financials as-reported-cash-flow-presentation -i AAPL -p annual --json

# As-reported income statement (optional: --sort, --limit, --offset, --all)
invd financials as-reported-income-statement -i AAPL -p annual --json

# As-reported income statement (detailed) (optional: --sort, --limit, --offset, --with-formula, --all)
invd financials as-reported-income-statement-detailed -i AAPL -p annual --json

# As-reported income statement (presentation) (optional: --sort, --limit, --offset, --all)
invd financials as-reported-income-statement-presentation -i AAPL -p annual --json

# As-reported snapshot (optional: --calendar-year, --calendar-quarter)
invd financials as-reported-snapshot -i AAPL,MSFT -p annual --json

# As-reported snapshot (detailed) (optional: --calendar-year, --calendar-quarter, --with-formula)
invd financials as-reported-snapshot-detailed -i AAPL,MSFT -p annual --json

# As-reported snapshot (presentation) (optional: --calendar-year, --calendar-quarter)
invd financials as-reported-snapshot-presentation -i AAPL,MSFT -p annual --json

# Standardized balance sheet (optional: --sort, --limit, --offset, --all)
invd financials balance-sheet -i AAPL -p annual --json

# Standardized balance sheet (detailed) (optional: --sort, --limit, --offset, --with-formula, --all)
invd financials balance-sheet-detailed -i AAPL -p annual --json

# Standardized balance sheet (presentation) (optional: --sort, --limit, --offset, --all)
invd financials balance-sheet-presentation -i AAPL -p annual --json

# Standardized cash flow statement (optional: --sort, --limit, --offset, --all)
invd financials cash-flow -i AAPL -p annual --json

# Standardized cash flow statement (detailed) (optional: --sort, --limit, --offset, --with-formula, --all)
invd financials cash-flow-detailed -i AAPL -p annual --json

# Standardized cash flow statement (presentation) (optional: --sort, --limit, --offset, --all)
invd financials cash-flow-presentation -i AAPL -p annual --json

# Standardized income statement (optional: --sort, --limit, --offset, --all)
invd financials income-statement -i AAPL -p annual --json

# Standardized income statement (detailed) (optional: --sort, --limit, --offset, --with-formula, --all)
invd financials income-statement-detailed -i AAPL -p annual --json

# Standardized income statement (presentation) (optional: --sort, --limit, --offset, --all)
invd financials income-statement-presentation -i AAPL -p annual --json

# Standardized snapshot (optional: --calendar-year, --calendar-quarter)
invd financials snapshot -i AAPL,MSFT -p annual --json

# Standardized snapshot (detailed) (optional: --calendar-year, --calendar-quarter, --with-formula)
invd financials snapshot-detailed -i AAPL,MSFT -p annual --json

# Standardized snapshot (presentation) (optional: --calendar-year, --calendar-quarter)
invd financials snapshot-presentation -i AAPL,MSFT -p annual --json
```

### health

Liveness of the API (no API key)

```bash
# Health check
invd health --json
```

### insider-trades

Insider transactions of a company

```bash
# Insider trades (optional: --start-date, --end-date, --acquired-disposed, --sort, --limit, --offset, --all)
invd insider-trades list -i AAPL --json
```

### ipos

Initial public offerings

```bash
# List IPOs (optional: --start-date, --end-date, --sort, --limit, --offset, --all)
invd ipos list --json
```

### login

<!-- invd:hand:login -->
```bash
invd login     # browser sign-in to your Invinite Data account; stores the key
```
<!-- /invd:hand:login -->

### logout

<!-- invd:hand:logout -->
```bash
invd logout    # revokes the login and clears stored credentials
```
<!-- /invd:hand:logout -->

### market

Market calendar

```bash
# Market holidays (optional: --sort, --limit, --offset, --all)
invd market holidays --json
```

### metadata

The metrics and filing section ids the API serves

```bash
# Available metrics
invd metadata metrics --json

# Available SEC section IDs
invd metadata section-ids --json
```

### metrics

Ratios, growth and CAGR derived from the statements

```bash
# CAGR metrics (optional: --period-years, --sort, --limit, --offset, --all)
invd metrics cagr -i AAPL --json

# Growth metrics (optional: --growth-type, --sort, --limit, --offset, --all)
invd metrics growth -i AAPL -p annual --json

# Financial ratios (optional: --category, --sort, --limit, --offset, --all)
invd metrics ratios -i AAPL -p annual --json
```

### ownership

13F holdings, holders and position changes of institutional investors

```bash
# Holdings by company (optional: --min-value, --sort, --limit, --offset, --all)
invd ownership holdings-by-company -i AAPL --json

# Holdings by investor (optional: --sort, --limit, --offset, --all)
invd ownership holdings-by-investor --cik 1067983 --json

# List institutional investors (optional: --ciks, --limit, --offset, --sort, --all)
invd ownership institutions --json

# Institutional transactions (optional: --cik, --identifier, --start-date, --end-date, --type, --calendar-year, --calendar-quarter, --sort, --limit, --offset, --all)
invd ownership transactions --cik 1067983 --json
```

### plugin

<!-- invd:hand:plugin -->
```bash
invd plugin install --claude --global    # also --opencode, --codex, --copilot, --all; --local for this project
invd plugin uninstall --claude --global
```
<!-- /invd:hand:plugin -->

### segments

Financial facts broken down by business and geographic segment

```bash
# Segmented financials (optional: --segment-id, --sort, --limit, --offset, --all)
invd segments list -i AAPL -p annual --json

# Segmented financials (detailed) (optional: --segment-id, --sort, --limit, --offset, --all)
invd segments list-detailed -i AAPL -p annual --json
```

### status

Public status and licensing (no API key)

```bash
# Licensing policy
invd status licensing --json

# Service status
invd status show --json
```

### usage

Your data account's own usage (costs no credits)

```bash
# Account usage (optional: --days)
invd usage --json
```

### webhooks

Earnings-call webhook subscriptions (PRO): signed POSTs of the call lifecycle

```bash
# Create a webhook (optional: --body-file)
invd webhooks create --body '{"url":"https://hooks.example.com/invinite","events":["earnings_call.transcript_ready","earnings_call.ended"],"filters":{"ciks":["0000789019","0000320193"]}}' --json

# Delete a webhook
invd webhooks delete --id js7a2c9xq4m8v1k6t3w5r0n2b8gnd4fh --json

# Webhook delivery attempts
invd webhooks deliveries --id js7a2c9xq4m8v1k6t3w5r0n2b8gnd4fh --json

# List webhooks
invd webhooks list --json

# Rotate a webhook signing secret
invd webhooks rotate-secret --id js7a2c9xq4m8v1k6t3w5r0n2b8gnd4fh --json

# Send a test delivery
invd webhooks test --id js7a2c9xq4m8v1k6t3w5r0n2b8gnd4fh --json

# Update a webhook (optional: --body, --body-file)
invd webhooks update --id js7a2c9xq4m8v1k6t3w5r0n2b8gnd4fh --body '{"events":["earnings_call.transcript_ready"],"active":true}' --json
```

### ws

<!-- invd:hand:ws -->
```bash
# Real-time SEC filing stream
invd ws listen --json

# Follow a live call (event ID or CIK; NDJSON with --json; PRO)
invd ws listen --earnings <event_id> --json
invd ws listen --earnings 320193 --names

# Live price ticks of the call's stock next to the transcript (≤ 1/s; per-call only, not with --all-live)
invd ws listen --earnings <event_id> --prices --json | jq 'select(.type=="price_tick")'

# Keyword alerts on a live call, or across every live call (--all-live needs --keywords)
invd ws listen --earnings 320193 --keywords tariffs,china --keyword-match stem --json
invd ws listen --all-live --keywords tariffs --json
```
<!-- /invd:hand:ws -->

<!-- invd:commands:end -->

## Pagination

Paginated commands (the `--all` ones above) take:
- `-l, --limit <n>` — max results per page
- `--offset <n>` — pagination offset
- `--all` — auto-paginate all results (follows `next_url`; per-company commands merge each company's pages; a page refused with 429 / 503 is retried up to 5 times after the API's `Retry-After`)
- `-s, --sort <dir>` — `asc` or `desc` (where the operation supports it)

## Common Patterns

### Comparing companies
Fetch snapshots for multiple tickers at once:
```bash
invd financials snapshot -i AAPL,MSFT,GOOGL -p annual --json
```

### Getting the latest quarterly data
```bash
invd financials income-statement -i AAPL -p quarterly --limit 1 --json
```

### Finding who owns a stock
```bash
invd ownership holdings-by-company -i AAPL --min-value 10000000 --json
```

### Searching SEC filings by topic
```bash
invd filings search -r "artificial intelligence strategy" -i MSFT --json
```

### Reading an earnings call
Find the call, then read it from the cheapest source to the most detailed:
```bash
invd earnings events -i NVDA -s desc -l 4 --json            # pick the event_id
invd earnings transcript --event-id <event_id> --format sections --json
invd earnings extractions --event-id <event_id> --kind guidance --json
invd earnings search -q "gross margin outlook" --event-id <event_id> --json
invd earnings price-attribution --event-id <event_id> --json   # optional: price moves during the call
```
`price-attribution` (MCP `earnings_call_price_moves`, STANDARD, 1 credit) lines up minute returns with what was said in that minute: temporal coincidence, not attribution of cause; pre-market bars are sparse, and a `404 price_attribution_unavailable` means the call is not attributed yet.

### Reading specific filing sections
First find section IDs, then fetch the section:
```bash
invd metadata section-ids --json
invd filings sections -i AAPL --form-type 10-K --section-id risk_factors --json
```

## Tips

- Always use `--json` for data you'll analyze or transform
- Use `--all` cautiously — some endpoints return thousands of results
- Company identifiers accept both ticker symbols (AAPL) and CIK numbers
- For financial statements, `annual` gives the full year, `quarterly` gives each quarter, `ttm` gives trailing twelve months, `ytd` gives year-to-date
- The `snapshot` command is the most efficient way to get complete financials for one or more companies at once
- Filing sections return full text — great for detailed analysis of risk factors, MD&A, business descriptions, etc.
- Following a live call: `invd earnings live --json` lists the calls in progress; `invd ws listen --earnings <event_id>` streams the transcript (PRO) and exits once the final transcript is ready
- Earnings-call identifiers: `event_id` (UUID) from `invd earnings events` / `calendar` is the most precise selector; ticker + `--year` + `--quarter` uses the company's fiscal quarter
