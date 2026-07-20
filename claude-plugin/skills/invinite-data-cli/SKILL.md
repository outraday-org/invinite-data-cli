---
name: invinite-data-cli
description: Fetch financial data through the Invinite Data API MCP connector or invd CLI. Use whenever the user wants company information, financial statements, SEC filings, institutional ownership, insider trades, IPO data, market holidays, financial metrics, or other stock/company data, including requests mentioning tickers, CIKs, balance sheets, income statements, cash flows, 10-K, 10-Q, ratios, CAGR, growth rates, dividends, stock splits, or institutional holdings.
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

The discovery rules below apply to both transports: call `list_available_metrics` before ratios, growth, CAGR, or financial-statement analysis, and call `list_available_section_ids` before requesting filing sections.

## Prerequisites

### MCP

Connect `https://mcp.data.invinite.com/t/<teamId>/mcp` through OAuth. The team in the URL controls data billing. Leave OAuth client ID and secret empty so the client uses Dynamic Client Registration and PKCE.

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
