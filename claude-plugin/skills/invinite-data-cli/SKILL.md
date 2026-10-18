---
name: invinite-financial-data
description: Fetch financial data through the Invinite Data API MCP connector or invd CLI. Use whenever the user wants company information, financial statements, SEC filings, institutional ownership, insider trades, IPO data, market holidays, financial metrics, earnings calls, or other stock/company data, including requests mentioning tickers, CIKs, balance sheets, income statements, cash flows, 10-K, 10-Q, ratios, CAGR, growth rates, dividends, stock splits, institutional holdings, call transcripts, earnings guidance, KPIs, Q&A, analysts, live calls, slides, or press releases.
allowed-tools: Bash(invd *)
---

# Invinite Data API

Use the connected Invinite Data API MCP tools when available. Fall back to the `invd` CLI when MCP is unavailable. Both transports access the same team-billed Data API.

## Transport selection

1. Prefer MCP tools when an Invinite Data connector is available. Call the direct domain tool matching the request; unlike the Web API MCP server, the Data API MCP server does not use meta-tools such as `call_endpoint`.
2. Use the CLI examples below when MCP is unavailable or when the user explicitly requests CLI usage. Always pass `--json` for data used in analysis.
3. Do not mix transports merely to repeat a successful request.

### MCP and CLI mapping

| Data need | MCP tool | CLI command family |
|---|---|---|
| Search/details/list | `company_search`, `company_details`, `available_companies` | `invd company ...` |
| Dividends/periods/splits | `company_dividends`, `company_fiscal_periods`, `company_splits` | `invd company ...` |
| Standardized statements/snapshots | `standardized_financial_statement`, `standardized_financial_snapshot` | `invd financials ...` |
| As-reported statements/snapshots | `as_reported_financial_statement`, `as_reported_financial_snapshot` | `invd financials ... --as-reported` |
| Ratios/growth/CAGR | `financial_ratios`, `financial_growth`, `financial_cagr` | `invd metrics ...` |
| Segment data | `segmented_financials` | `invd segments ...` |
| SEC filings/search/sections | `sec_filings`, `sec_filings_search`, `sec_filing_sections` | `invd filings ...` |
| Filing and metric discovery | `sec_available_form_types`, `list_available_section_ids`, `list_available_metrics` | `invd filings form-types`, `invd metadata ...` |
| Institutional ownership | `holdings_by_company`, `holdings_by_investor`, `institutional_investors`, `institutional_transactions` | `invd ownership ...` |
| Insider trades/IPOs/holidays | `insider_trades`, `ipos`, `market_holidays` | `invd insider-trades`, `invd ipos`, `invd market ...` |
| Earnings call calendar/events/live | `earnings_call_calendar`, `earnings_call_events`, `earnings_call_live` | `invd earnings calendar\|events\|live` |
| Call transcript/Q&A/participants | `earnings_call_transcript`, `earnings_call_qa`, `earnings_call_participants` | `invd earnings transcript\|qa\|participants` |
| Call guidance/KPIs, diff vs prior call | `earnings_call_guidance`, `earnings_call_diff` | `invd earnings extractions\|guidance-history\|diff` |
| Call documents/press release | `earnings_call_documents`, `earnings_call_press_release` | `invd earnings documents\|press-release` |
| Price moves during a call (coincidence, not cause; live rows during the call) | `earnings_call_price_moves` | `invd earnings price-attribution` |
| Search across calls | `earnings_call_search` | `invd earnings search` |
| Keyword / guidance alerts | `earnings_call_alert_create\|list\|update\|delete\|test\|deliveries` | `invd webhooks …` |

The discovery rules below apply to both transports: call `list_available_metrics` before ratios, growth, CAGR, or financial-statement analysis, and call `list_available_section_ids` before requesting filing sections.

## Prerequisites

### MCP

Connect `https://data.invinite.com/t/<teamId>/mcp` through OAuth (the team-pinned URL is shown on the Data API dashboard's keys page, https://invinite.com/data-api/keys). The team in the URL controls data billing. Leave OAuth client ID and secret empty so the client uses Dynamic Client Registration and PKCE.

### CLI

Install the CLI with `npm install -g @invinite-org/invinite-data-cli`, then run `invd login` or `invd login --team <teamId>`. Authentication is resolved in this order:
1. `INVINITE_DATA_API_KEY` environment variable
2. `.env` file
3. OS keychain (via optional `keytar`)
4. Stored config

If an MCP call fails with an auth error, reconnect the connector and complete OAuth. If a CLI call fails with an auth error, run `invd login`; manual `invd config set-key` and `INVINITE_DATA_API_KEY` remain supported fallbacks.

## Global Options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON (always use this for programmatic access) |
| `--all` | Auto-paginate through all results |
| `--show-cost` | Print `credits: <charged> · included left: <remaining>` to stderr after the command (or set `INVD_SHOW_COST=1`); stdout stays clean |

### Usage and credits

Before a large pull (`--all`, many tickers, filing search at 100 credits a call), run `invd usage --json` (free, `--days 7|30|90`): `period` has the plan's `included_credits`, `used_credits`, `resets_at` and `prepaid_balance_usd`; `daily`, `by_family` and `by_key` show where credits went. If the pull would not fit what is left, say so before starting it. For budgeting, add `--show-cost` to a sample call and multiply; the stderr line never mixes into `--json` output. Every operation's credit cost is the `x-credits` field of the OpenAPI spec.

## Commands Reference

### Company Data

```bash
# List all companies
invd company list --json

# Search by ticker or name
invd company search -q "Apple" --json
invd company search -q MSFT --limit 5 --json

# Company details (ticker or CIK)
invd company details -i AAPL --json

# Dividends (with optional date range)
invd company dividends -i AAPL --json
invd company dividends -i AAPL --start-date 2023-01-01 --end-date 2024-01-01 --json

# Fiscal periods
invd company fiscal-periods -i MSFT --json

# Stock splits
invd company splits -i AAPL --json
```

### Financial Statements

Period is required: `quarterly`, `annual`, `ytd`, or `ttm`.

Financial statement responses use standardized `metric_id` keys (from `metadata metrics`) as field names. If you need to understand what a specific metric_id means, check `invd metadata metrics --json` first.

```bash
# Income statement
invd financials income-statement -i AAPL -p annual --json
invd financials income-statement -i AAPL -p quarterly --limit 4 --json

# Balance sheet
invd financials balance-sheet -i MSFT -p quarterly --limit 4 --json

# Cash flow statement
invd financials cash-flow -i GOOGL -p annual --json

# Financial snapshot (multiple companies, comma-separated)
invd financials snapshot -i AAPL,MSFT,GOOGL -p annual --json
invd financials snapshot -i AAPL -p quarterly --calendar-year 2024 --calendar-quarter 3 --json
```

Statement options:
- `--detailed` — includes formula, accession number, HTML tag info
- `--presentation` — returns nested tree structure (hierarchical)
- `--as-reported` — uses as-reported data instead of standardized
- `--with-formula` — includes formula info (requires `--detailed`)
- `--detailed` and `--presentation` are mutually exclusive

### Financial Metrics

**Before querying any metrics endpoint (ratios, CAGR, or growth), first fetch the available metric identifiers using `metadata metrics`.** The response from ratios/CAGR/growth uses `metric_id` keys (e.g., `PR_TO_EARNINGS`, `CURRENT_RATIO`) — without knowing the available IDs, you won't know what data exists or how to interpret the results. This also helps you confirm that the metric the user is asking about actually exists.

```bash
# STEP 1: Always fetch available metrics first
invd metadata metrics --json
# Returns: { metrics: [{ metric_id: "...", name: "..." }, ...] }
# Use this to understand what metric_id keys appear in ratios/CAGR/growth responses

# STEP 2: Then query the specific metrics endpoint
# Ratios (categories: valuation, profitability, liquidity, solvency)
invd metrics ratios -i AAPL -p annual --json
invd metrics ratios -i AAPL -p annual --category profitability --json

# CAGR (periods: 3, 5, or 10 years)
invd metrics cagr -i AAPL --json
invd metrics cagr -i AAPL --period-years 5 --json

# Growth metrics (year_over_year or quarter_over_quarter)
invd metrics growth -i MSFT -p quarterly --growth-type year_over_year --json
```

The metrics response structures differ by endpoint:
- **Ratios**: `period.facts[category][metric_id]` — organized by category (valuation, profitability, etc.)
- **CAGR**: `period.facts[years][metric_id]` — organized by time period (3-year, 5-year, 10-year)
- **Growth**: `period.facts[growthType][metric_id]` — organized by growth type (year_over_year, quarter_over_quarter)

All share the same `metric_id` identifiers from `metadata metrics`.

### Segments

```bash
# Segmented financials
invd segments list -i AAPL -p annual --json
invd segments list -i AAPL -p annual --detailed --json
```

### SEC Filings

```bash
# List filings (filter by form type: 10-K, 10-Q, 8-K, etc.)
invd filings list -i AAPL --json
invd filings list -i AAPL --form-type 10-K --json

# Natural language search through filings
invd filings search -r "revenue recognition policy changes" -i AAPL --json

# Fetch filing sections (full text content)
invd filings sections -i AAPL --form-type 10-K --section-id risk_factors --json
invd filings sections -i AAPL --form-type 10-K --accession-number 0000320193-23-000106 --json

# Available form types
invd filings form-types --json
invd filings form-types -i AAPL --json

# Available section IDs
invd metadata section-ids --json
```

### Institutional Ownership

```bash
# Holdings by investor (requires CIK)
invd ownership holdings-by-investor --cik 0001067983 --json

# Holdings by company
invd ownership holdings-by-company -i AAPL --json
invd ownership holdings-by-company -i AAPL --min-value 1000000 --json

# Ownership transactions
invd ownership transactions -i AAPL --type new_buy --json
invd ownership transactions --cik 0001067983 --calendar-year 2024 --json

# List institutional investors
invd ownership institutions --json
invd ownership institutions --ciks 0001067983,0001364742 --json
```

Transaction types: `new_buy`, `added`, `reduced`, `sold_out`

### Insider Trades

```bash
# Insider transactions
invd insider-trades list -i AAPL --json
invd insider-trades list -i TSLA --acquired-disposed D --limit 20 --json
invd insider-trades list -i AAPL --start-date 2024-01-01 --json
```

`--acquired-disposed`: `A` (acquisition) or `D` (disposition)

### IPOs

```bash
invd ipos list --json
invd ipos list --start-date 2024-01-01 --end-date 2024-12-31 --json
```

### Market Data

```bash
invd market holidays --json
```

### Metadata (query before using metrics or filing sections)

These are discovery endpoints — use them before querying data that depends on specific identifiers.

```bash
# List all available metric IDs — run this BEFORE querying ratios, CAGR, or growth
invd metadata metrics --json
# Returns: { metrics: [{ metric_id: "PR_TO_EARNINGS", name: "Price-to-Earnings Ratio" }, ...] }

# List available section IDs — run this BEFORE querying filing sections
invd metadata section-ids --json
```

### Earnings Calls

Commands about one call take a selector: `--event <event_id>` (from `events` / `calendar`), or `-i <ticker>` with `--year` + `--quarter` (fiscal) or `--date YYYY-MM-DD` (New York call day).

```bash
# Calendar across companies, a company's calls, calls being captured right now
# --event-type: earnings_call (calendar default), investor_day, conference, agm, other, all (events default)
invd earnings calendar --from 2026-10-20 --to 2026-10-31 --json
invd earnings calendar --event-type all --json   # investor days, conferences, AGMs too
invd earnings events -i AAPL -s desc -l 4 --json
invd earnings live --json
invd earnings event <event_id> --json

# Transcript (formats: speakers, text, words, sections, cleaned), versions, word diff between versions
# qa_start_ms = where the Q&A begins (ms into the call, null without one)
invd earnings transcript -i AAPL --year 2026 --quarter 4 --format speakers --json
invd earnings versions --event <event_id> --json
invd earnings transcript-diff --event <event_id> --from 1 --json

# Q&A pairs, speakers, analysts of a company, one person's appearances
invd earnings qa --event <event_id> --json
invd earnings participants --event <event_id> --json
invd earnings analysts -i AAPL --json
invd earnings person <person_id> --json

# Press release, guidance / KPI extractions, a metric's guidance across calls
invd earnings press-release --event <event_id> --body --json
invd earnings extractions --event <event_id> --kind guidance --json
invd earnings extractions --event <event_id> --kind kpi --json
invd earnings guidance-history -i AAPL --metric revenue --json

# Derived: diff vs the prior call, call metrics, prosody, price moves during the call
invd earnings diff --event <event_id> --json
invd earnings metrics --event <event_id> --json
invd earnings prosody --event <event_id> --section qa --json
invd earnings price-attribution --event <event_id> --json   # minute returns (bps) next to what was said; coincidence, not cause

# Media (signed URLs expire after 15 min; --output saves the file)
invd earnings audio --event <event_id> --output call.mp3
invd earnings slides --event <event_id> --markdown --json
invd earnings documents --event <event_id> --kind cfo_commentary --json
invd earnings documents --event <event_id> --output ./docs   # a row without url (link-only sec_filing) is warned on stderr; use its source_url
invd earnings stream --event <event_id> --json   # live HLS URL of a call in progress (PRO)

# Semantic search over transcripts and slides
invd earnings search -q "data center demand" -i NVDA --json
```

- `--transcript-version N` (not `--version`) selects a published transcript version; `--as-of <iso>` the version current at that instant.
- `extractions --review approved|auto|all` filters guidance by review status; `diff --vs prior` is the only comparison base.
- Every `*_ms` field is milliseconds from the call's start: cite it as `[m:ss]`.
- The live transcript (`ws listen --earnings`), audio, slides, the live stream and webhooks need the PRO plan (calendar, events and `live` need LITE, the other reads STANDARD); a `403` names the plan a route needs.

### Live transcripts and webhooks

```bash
# Follow a live call over the WebSocket (event ID or CIK; NDJSON with --json)
invd ws listen --earnings <event_id> --json
invd ws listen --earnings 320193 --names

# Live price ticks of the call's stock next to the transcript (≤ 1/s; per-call only, not with --all-live)
invd ws listen --earnings <event_id> --prices --json | jq 'select(.type=="price_tick")'

# Keyword alerts on a live call, or across every live call (--all-live needs --keywords)
invd ws listen --earnings 320193 --keywords tariffs,china --keyword-match stem --json
invd ws listen --all-live --keywords tariffs --json

# Earnings-call webhook subscriptions (the secret is printed once)
invd webhooks list --json
invd webhooks create --url https://hooks.example.com/invinite --events earnings_call.transcript_ready --ciks 320193
invd webhooks create --url https://hooks.example.com/alerts --events earnings_call.keyword_hit --keywords tariffs   # every company
invd webhooks update <id> --keywords tariffs,buyback --json
invd webhooks deliveries <id> --json
```

`price_tick` frames (`--prices`, PRO) carry `at`, `call_ms` (the transcript clock), `price`, `return_bps` (vs the last trade before the call), `day_return_bps` (vs the previous close) and `source` (`stream` | `snapshot`); only seconds with a trade are sent, so pre-market and after-hours ticks are sparse. Describe a move as temporal coincidence with what was said, never as caused by it. `invd earnings live` says `live_prices: true` when ticks flow; during the call `invd earnings price-attribution` returns the minute rows so far (`live: true`, `settled: false`, summary fields null) until the post-call run replaces them.

Keyword / guidance alerts (PRO) are webhook subscriptions: `earnings_call.keyword_hit` delivers one POST per mention of a keyword on any live call (speaker, `start_ms`, sentence), `earnings_call.guidance_flash` one per guidance number spoken live. "Alert me when any call mentions 'tariffs'" → `earnings_call_alert_create` with `keywords: ["tariffs"]`, `events: ["earnings_call.keyword_hit"]`, the user's HTTPS endpoint and no `ciks` (every company); later changes go through `earnings_call_alert_update` (keywords, ciks, events, active). CLI: `invd webhooks create --url <url> --events earnings_call.keyword_hit --keywords tariffs`.

### Health Check

```bash
invd health --json
```

## Pagination

All list endpoints support:
- `-l, --limit <n>` — max results per page
- `--offset <n>` — pagination offset
- `--all` — auto-paginate all results
- `-s, --sort <dir>` — `asc` or `desc`

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
invd earnings transcript --event <event_id> --format sections --json
invd earnings extractions --event <event_id> --kind guidance --json
invd earnings search -q "gross margin outlook" --event <event_id> --json
invd earnings price-attribution --event <event_id> --json   # optional: price moves during the call
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
