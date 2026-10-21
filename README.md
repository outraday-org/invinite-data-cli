# @invinite-org/invinite-data-cli

Command-line interface for the [Invinite Data API](https://invinite.com/docs/data-api/overview) — access company data, financial statements, SEC filings, institutional ownership, and more from your terminal.

## Installation

### From npm

```bash
npm install -g @invinite-org/invinite-data-cli
```

To update to the latest version:

```bash
npm update -g @invinite-org/invinite-data-cli
```

### From source

```bash
git clone https://github.com/outraday-org/invinite-data-cli.git
cd invinite-data-cli
npm install
npm run build
npm link
```

Requires Node.js >= 20.

## Authentication

The recommended way to authenticate is browser login:

```bash
invd login
```

The browser flow creates a revocable, 90-day Data API key and stores it in the
OS keychain when available (with local CLI config as a fallback). The sign-in
also appears on the Invinite Data app's keys page (https://data.invinite.com/keys). The key belongs to the
Invinite Data account you sign in with — one account per person, billed for every call made with it.

To revoke the browser sign-in and remove the locally stored credential:

```bash
invd logout
```

Manual API keys remain supported. The active key is resolved in the following order:

1. **Environment variable** — `INVINITE_DATA_API_KEY`
2. **Current directory `.env` file** — `INVINITE_DATA_API_KEY=...`
3. **OS keychain** — via the optional `keytar` package
4. **Stored config** — set with the CLI

### Set your API key

```bash
invd config set-key
```

You'll be prompted to enter your key (input is masked). Alternatively, export it as an environment variable:

```bash
export INVINITE_DATA_API_KEY=your-api-key
```

Because environment and `.env` values take precedence over stored credentials,
`invd logout` will tell you to remove them manually when either is active.

## AI Plugin

This repo includes plugins for AI coding tools that enable AI-powered financial data retrieval and analysis. Supports **Claude Code**, **OpenCode**, **Codex**, and **Copilot**.

### Choose an integration

- **Standalone skill:** installs the Invinite workflow and CLI reference. It prefers MCP when connected and falls back to the local `invd` CLI.
- **Standalone MCP connector:** add `https://api.data.invinite.com/mcp` in Claude's connector settings, leave OAuth client ID/secret empty, and complete browser OAuth. This supplies tools but not the packaged research workflows.
- **Claude plugin:** bundles the skill, remote MCP connector, data agent, and research commands; no setup value is needed. OAuth uses Dynamic Client Registration and PKCE.

MCP calls and CLI calls are billed to the Invinite Data account their credential belongs to: the connector's OAuth sign-in, or the key `invd login` stored.

### Quick install

```bash
# Interactive — prompts for runtime and scope
npx @invinite-org/invinite-data-cli@latest plugin install

# Non-interactive examples
npx @invinite-org/invinite-data-cli@latest plugin install --claude --global
npx @invinite-org/invinite-data-cli@latest plugin install --claude --local
npx @invinite-org/invinite-data-cli@latest plugin install --opencode --global
npx @invinite-org/invinite-data-cli@latest plugin install --codex --global
npx @invinite-org/invinite-data-cli@latest plugin install --copilot --local
npx @invinite-org/invinite-data-cli@latest plugin install --all --global
```

### Update

To update the plugin to the latest version, re-run the install command:

```bash
npx @invinite-org/invinite-data-cli@latest plugin install --claude --global
npx @invinite-org/invinite-data-cli@latest plugin install --all --global
```

### Uninstall

```bash
npx @invinite-org/invinite-data-cli@latest plugin uninstall --claude --global
npx @invinite-org/invinite-data-cli@latest plugin uninstall --all --global
```

### What gets installed

| Runtime | Skill | Agent | Command |
|---------|-------|-------|---------|
| **Claude Code** | `skills/invinite-data-cli/SKILL.md` | `agents/invinite-data.md` | `commands/financial-research.md`, `commands/analyze-earnings-call.md` |
| **OpenCode** | `command/invinite-data-cli.md` | `agents/invinite-data.md` | `command/analyze-earnings-call.md` |
| **Codex** | `skills/invinite-data-cli/SKILL.md` | — | `skills/invinite-financial-research/SKILL.md`, `skills/invinite-analyze-earnings-call/SKILL.md` |
| **Copilot** | `skills/invinite-data-cli/SKILL.md` | — | `skills/invinite-financial-research/SKILL.md`, `skills/invinite-analyze-earnings-call/SKILL.md` |

`claude-plugin/` is the single source of these files. The repo-local copies under `.claude/` (the skill, the two commands and the agent) are symlinks into it, and `.codex/`, `.cursor/` and `.agent/` resolve through them — edit the plugin file, never a mirror.

### Alternative: Claude Code plugin directory

```bash
claude --plugin-dir /path/to/invinite-data-cli/claude-plugin
```

The Claude plugin also includes `compare-companies`, `analyze-filing`, and `ownership-review`. Its `.mcp.json` connects the remote server (`https://api.data.invinite.com/mcp`) automatically; use `/mcp` to complete OAuth or inspect connection status in Claude Code. In Claude web/Desktop, install the plugin through your organization's plugin marketplace and connect the bundled connector.

### Usage examples

Use `/financial-research` for multi-step analysis:

```
/financial-research Compare Apple, Microsoft, and Google's profitability and growth over the last 3 years
/financial-research Who are the largest institutional holders of TSLA and what are recent ownership changes?
/financial-research Analyze risk factors from NVDA's latest 10-K filing
```

Use `/analyze-earnings-call` for one call — results vs guidance, raised / lowered guidance, analyst focus and tone change vs the prior call, cited with `[m:ss]` timestamps:

```
/analyze-earnings-call NVDA
/analyze-earnings-call AAPL 2026 Q4
```

Or ask questions directly — the AI will auto-trigger the skill and delegate to the data agent as needed.

> **Note:** The CLI must be installed and authenticated (see [Authentication](#authentication)) for the plugin to work.

## Global Options

These options are available on all data commands:

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON (pipe-friendly) |
| `--all` | Auto-paginate through all results |
| `--show-cost` | Print what the command cost to stderr (see [Usage and credits](#usage-and-credits)) |

## Usage and credits

`invd usage` prints your account's plan allowance, prepaid balance and usage by day, endpoint family and key — the
same answer as the [Invinite Data app](https://data.invinite.com/usage). It costs no credits.

```bash
invd usage              # last 30 days (default)
invd usage --days 7     # 7, 30 or 90
invd usage --json       # the API's JSON, unchanged
```

```
  Plan       Lite · 250,000 credits included · resets 1 Nov 2026, 00:00 UTC
  Used       141,220 credits (56 %) · prepaid balance $12.50
  Daily      ▁▂▂▃▅▃▂▁▁▂▃▅▆▇▅▃▂▂▃▃▄▅▆▅▃▂▂▃▄▅   (credits per day, 2026-10-02 → 2026-10-31 UTC)
  By family  Financials 98,100 · SEC Filings 30,400 · Earnings Calls 12,720
  By key     Backtest box (invd_a1b...c2d3) 120,000 · Signed-in user 21,220
  Errors     403 ×12 · 429 ×3
  Details    https://data.invinite.com/usage
```

To see what a single command cost, add `--show-cost` (or set `INVD_SHOW_COST=1`). The line goes to **stderr**, so
piped stdout stays clean:

```bash
invd --show-cost --json company details -i AAPL > aapl.json
# credits: 1 · included left: 249999
```

`included left` is the plan's included credits left after the command: the API's `X-Credits-Included-Remaining`
(the allowance before the request) minus what the request was charged (absent → `—`, e.g. for the free usage route). Keys, plan and prepaid credits are managed at [data.invinite.com](https://data.invinite.com);
credit costs per endpoint and plan limits are documented at
[/docs/data-api/credits-and-limits](https://invinite.com/docs/data-api/credits-and-limits).

## Commands

- `login` — Log in through your browser
- `logout` — Revoke the current browser sign-in and clear local credentials
- [usage](#usage-and-credits) — Plan allowance, prepaid balance and usage by day, family and key
- [config](#config) — Manage CLI configuration
- [health](#health) — Check API health
- [company](#company) — Company information
- [financials](#financials) — Financial statements
- [metrics](#metrics) — Financial metrics, ratios, and growth
- [segments](#segments) — Segmented financials
- [filings](#filings) — SEC filings
- [earnings](#earnings) — Earnings calls: calendar, transcripts, Q&A, guidance, price moves during the call, audio, slides, documents, search; company IR documents and document search
- [ownership](#ownership) — Institutional ownership
- [insider-trades](#insider-trades) — Insider trading data
- [ipos](#ipos) — IPO listings
- [market](#market) — Market data
- [metadata](#metadata) — API metadata
- [webhooks](#webhooks) — Earnings-call webhook subscriptions
- [ws](#ws) — WebSocket streaming (`ws listen --earnings` for live call transcripts, `--prices` for live price ticks, `--keywords` / `--all-live` for keyword alerts)

---

### config

Manage CLI configuration.

```bash
# Set API key (interactive, masked input)
invd config set-key

# Set custom API base URL
invd config set-url https://custom-api.example.com

# Show current configuration
invd config show

# Reset all configuration to defaults
invd config reset
```

---

### health

Check API health status.

```bash
invd health
```

---

### company

Company information, search, and corporate actions.

#### `company list`

List all available companies.

```bash
invd company list
```

#### `company search`

Search companies by ticker or name.

| Option | Description | Default |
|--------|-------------|---------|
| `-q, --query <text>` | Search query **(required)** | — |
| `-l, --limit <n>` | Maximum results | `10` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd company search -q "Apple"
invd company search -q MSFT --limit 5
```

#### `company details`

Fetch company details.

| Option | Description |
|--------|-------------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** |

```bash
invd company details -i AAPL
```

#### `company dividends`

Fetch stock dividends.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `--start-date <date>` | Start date (YYYY-MM-DD) | — |
| `--end-date <date>` | End date (YYYY-MM-DD) | — |
| `-s, --sort <dir>` | Sort direction (`asc` / `desc`) | `desc` |
| `-l, --limit <n>` | Maximum results | `40` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd company dividends -i AAPL --start-date 2023-01-01
```

#### `company fiscal-periods`

Fetch available fiscal periods.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `-s, --sort <dir>` | Sort direction (`asc` / `desc`) | `desc` |
| `-l, --limit <n>` | Maximum results | `40` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd company fiscal-periods -i MSFT
```

#### `company splits`

Fetch stock splits.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `-s, --sort <dir>` | Sort direction (`asc` / `desc`) | `desc` |
| `-l, --limit <n>` | Maximum results | `40` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd company splits -i AAPL
```

---

### financials

Financial statements — standardized and as-reported.

All statement commands share these options:

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `-p, --period <type>` | Fiscal period: `quarterly`, `annual`, `ytd`, `ttm` **(required)** | — |
| `-s, --sort <dir>` | Sort direction (`asc` / `desc`) | `desc` |
| `-l, --limit <n>` | Maximum results | `10` |
| `--offset <n>` | Pagination offset | `0` |
| `--detailed` | Include formula, accession number, HTML tag info | — |
| `--presentation` | Return nested tree structure | — |
| `--as-reported` | Use as-reported data instead of standardized | — |
| `--with-formula` | Include formula info (only with `--detailed`) | — |

> `--detailed` and `--presentation` are mutually exclusive.

#### `financials income-statement`

```bash
invd financials income-statement -i AAPL -p annual
invd financials income-statement -i AAPL -p quarterly --detailed
invd financials income-statement -i AAPL -p annual --presentation
invd financials income-statement -i AAPL -p annual --as-reported
```

#### `financials balance-sheet`

```bash
invd financials balance-sheet -i MSFT -p quarterly --limit 4
```

#### `financials cash-flow`

```bash
invd financials cash-flow -i GOOGL -p annual
```

#### `financials snapshot`

Fetch the latest complete financial snapshot. Uses comma-separated identifiers instead of a single identifier.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifiers <tickers>` | Comma-separated ticker symbols or CIKs **(required)** | — |
| `-p, --period <type>` | Fiscal period **(required)** | — |
| `--calendar-year <year>` | Filter by calendar year | — |
| `--calendar-quarter <q>` | Filter by calendar quarter | — |
| `--detailed` | Include detailed info | — |
| `--presentation` | Return nested tree structure | — |
| `--as-reported` | Use as-reported data | — |

```bash
invd financials snapshot -i AAPL,MSFT,GOOGL -p annual
invd financials snapshot -i AAPL -p quarterly --calendar-year 2024 --calendar-quarter 3
```

---

### metrics

Financial metrics, ratios, and growth rates.

#### `metrics ratios`

Fetch financial ratios.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `-p, --period <type>` | Fiscal period **(required)** | — |
| `--category <cat>` | Filter: `valuation`, `profitability`, `liquidity`, `solvency` | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `10` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd metrics ratios -i AAPL -p annual --category profitability
```

#### `metrics cagr`

Fetch compound annual growth rate metrics.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `--period-years <years>` | CAGR period: `3`, `5`, `10` | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `10` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd metrics cagr -i AAPL --period-years 5
```

#### `metrics growth`

Fetch growth metrics.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `-p, --period <type>` | Fiscal period **(required)** | — |
| `--growth-type <type>` | `year_over_year` or `quarter_over_quarter` | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `10` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd metrics growth -i MSFT -p quarterly --growth-type year_over_year
```

---

### segments

Segmented financial data.

#### `segments list`

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `-p, --period <type>` | Fiscal period **(required)** | — |
| `--segment-id <id>` | Filter by segment ID | — |
| `--detailed` | Include detailed breakdown | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `10` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd segments list -i AAPL -p annual
invd segments list -i AAPL -p annual --detailed
```

---

### filings

SEC filings data.

#### `filings list`

Fetch SEC filings for a company.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `--form-type <type>` | Filter by form type (e.g., `10-K`, `10-Q`, `8-K`) | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `40` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd filings list -i AAPL --form-type 10-K
```

#### `filings search`

Search SEC filings using natural language.

| Option | Description |
|--------|-------------|
| `-r, --request <text>` | Search query **(required)** |
| `-i, --identifier <ticker>` | Filter by company |
| `--accession-number <num>` | Filter by accession number |

```bash
invd filings search -r "revenue recognition policy changes" -i AAPL
```

#### `filings sections`

Fetch SEC filing sections.

| Option | Description |
|--------|-------------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** |
| `--form-type <type>` | Form type: `10-Q`, `10-K`, `8-K` **(required)** |
| `--section-id <id>` | Filter by section ID |
| `--accession-number <num>` | Filter by accession number |
| `--fiscal-year <year>` | Filter by fiscal year |
| `--fiscal-quarter <q>` | Filter by fiscal quarter |

```bash
invd filings sections -i AAPL --form-type 10-K --section-id risk_factors
```

#### `filings form-types`

List available SEC form types.

| Option | Description |
|--------|-------------|
| `-i, --identifier <ticker>` | Filter by company (optional) |

```bash
invd filings form-types
invd filings form-types -i AAPL
```

---

### earnings

Earnings calls: calendar, transcripts, Q&A, guidance and KPIs, audio, slides, documents, search — plus the companies' IR libraries (`company-documents`, `document`, `document-search`) and non-earnings events (investor days, conferences, AGMs: `--event-type`; the tables show `event_type` / `event_title`). The live transcript (`ws listen --earnings`), audio, slides, the live stream and webhooks need the **PRO** plan (calendar, events and `live` need LITE, the other reads STANDARD); a `403` names the plan a route needs.

**Selecting a call.** Commands about one call (marked *selector* below) take either `--event <event_id>` (a UUID from `earnings events` / `earnings calendar`; wins over the rest), or `-i, --identifier <ticker|cik>` with `--year <n>` + `--quarter <n>` (the company's fiscal quarter) or `--date <YYYY-MM-DD>` (the call day: a calendar day in New York time (America/New_York); a call without a confirmed time is listed on its announced date).

**Saving files.** `--output <file>` saves a transcript, press release, recording or deck (`documents --output <dir>` saves every document); an existing file is only replaced with `--force`. Without `--output` the media commands print **presigned URLs that expire after 15 minutes**.

#### `earnings calendar`

Upcoming and recent calls across companies.

| Option | Description | Default |
|--------|-------------|---------|
| `--from <date>` / `--to <date>` | Calendar days in New York time (America/New_York; a call without a confirmed time is listed on its announced date), at most 92 days | today / from + 14 days |
| `--status <list>` | `estimated`, `unconfirmed`, `confirmed`, `postponed`, `cancelled` (comma-separated) | — |
| `--session <session>` | `bmo`, `amc`, `intraday` | — |
| `--exchange <exchange>` | Exchange | — |
| `--event-type <type>` | `earnings_call`, `investor_day`, `conference`, `agm`, `other`, or `all` (every type) | `earnings_call` |
| `-s, --sort` / `-l, --limit` / `--offset` | Sort, page size (1–500), offset | — |

```bash
invd earnings calendar --from 2026-10-26 --to 2026-10-30 --status confirmed
```

#### `earnings events`

A company's calls.

| Option | Description |
|--------|-------------|
| `-i, --identifier <ticker>` | Ticker or CIK **(required)** |
| `--from <date>` / `--to <date>` | Call day range |
| `--event-type <type>` | `earnings_call`, `investor_day`, `conference`, `agm`, `other`, or `all` (default: every type) |
| `--observations` | Include the date / time observations per call |
| `-s, --sort` / `-l, --limit` / `--offset` | Sort, page size (1–200), offset |

```bash
invd earnings events -i AAPL -s desc -l 4
```

#### `earnings live`

Calls being captured right now (`live_audio` = a live stream exists, `live_prices` = `ws listen --prices` delivers price ticks for the call).

```bash
invd earnings live
```

#### `earnings event`

One call with its date / time observations: `invd earnings event <event_id>` (a non-earnings event is headed by its type and title).

```bash
invd earnings event 0b9d6f43-6b1e-4c39-9d3a-2f6a3c1e8b11
```

#### `earnings transcript` *(selector)*

| Option | Description |
|--------|-------------|
| `--format <format>` | `speakers` (default), `text`, `words`, `sections`, `cleaned` |
| `--transcript-version <n>` | A published version (`earnings versions`); not `--version`, which prints the CLI version |
| `--as-of <iso>` | The version current at that instant |
| `-o, --output <file>` / `--force` | Save the transcript as text |

The header shows where the Q&A begins ("Q&A starts at 41:07") when the call has one; `--json` carries it as `qa_start_ms` (milliseconds, `null` without a Q&A).

```bash
invd earnings transcript -i AAPL --year 2026 --quarter 4 --output aapl-q4.txt
```

#### `earnings versions` *(selector)*

Published transcript versions (final, corrected, …).

```bash
invd earnings versions -i AAPL --date 2026-10-30
```

#### `earnings transcript-diff` *(selector)*

| Option | Description |
|--------|-------------|
| `--from <n>` | Older version **(required)** |
| `--to <n>` | Newer version (default: the current one) |

```bash
invd earnings transcript-diff --event <event_id> --from 1
```

#### `earnings qa` *(selector)*

Question / answer pairs with the analyst and the answering executives (`-l, --limit` 1–200, `--offset`).

```bash
invd earnings qa -i NVDA --year 2027 --quarter 2
```

#### `earnings participants` *(selector)*

Speakers of the call (`--evidence` adds the quotes each name was resolved from).

```bash
invd earnings participants --event <event_id> --evidence
```

#### `earnings analysts`

Analysts on a company's calls (`-i` **required**, `-l, --limit` 1–100, `--offset`).

```bash
invd earnings analysts -i MSFT
```

#### `earnings person`

One person's call appearances: `invd earnings person <person_id>` (`-l, --limit` 1–200, `--offset`).

```bash
invd earnings person <person_id>
```

#### `earnings press-release` *(selector)*

| Option | Description |
|--------|-------------|
| `--body` | Include the release text |
| `-o, --output <file>` / `--force` | Save the release text |

```bash
invd earnings press-release -i AAPL --year 2026 --quarter 4 --body
```

#### `earnings extractions` *(selector)*

| Option | Description |
|--------|-------------|
| `--kind <kind>` | `guidance` (default) or `kpi` |
| `--review <filter>` | Guidance review filter: `approved`, `auto`, `all` |
| `-l, --limit` / `--offset` | Page size (1–500), offset |

```bash
invd earnings extractions --event <event_id> --kind kpi
```

#### `earnings guidance-history`

A company's guidance for one metric across calls.

| Option | Description |
|--------|-------------|
| `-i, --identifier <ticker>` | Ticker or CIK **(required)** |
| `--metric <metric>` | Normalized metric, e.g. `revenue`, `eps_non_gaap`, `segment:iphone` **(required)** |
| `--period-kind <kind>` | `quarter`, `fiscal_year`, `half`, `other` |
| `--basis <basis>` | `gaap`, `non_gaap`, `unknown` |
| `-l, --limit <n>` | Series entries (1–40) |

```bash
invd earnings guidance-history -i AAPL --metric revenue --period-kind quarter
```

#### `earnings diff` *(selector)*

What changed against the prior call: similarity, tone, hedging, new / dropped topics, slide changes (`--vs prior`, the only base).

```bash
invd earnings diff -i AAPL --year 2026 --quarter 4
```

#### `earnings metrics` *(selector)*

Call structure metrics (length, Q&A share, question count, …).

```bash
invd earnings metrics --event <event_id>
```

#### `earnings prosody` *(selector)*

Speech timing, pitch and energy per speaker (`--section all|prepared|qa`).

```bash
invd earnings prosody --event <event_id> --section qa
```

#### `earnings price-attribution` *(selector)*

Minute-level price moves during the call (returns in basis points, no prices or volume) next to what was being said in each minute, plus the largest minutes (`top_minutes`) and how the recording was anchored to wall-clock time (`anchor_kind`, `anchor_lag_ms`, `anchor_uncertainty_s`). This is temporal coincidence, not attribution of cause; pre-market and after-hours bars are sparse. STANDARD plan, 1 credit; a `404 price_attribution_unavailable` means the call has not been attributed yet. During a live call the minute rows arrive as each minute closes (`live: true`, `settled: false`, the summary fields null, `top_minutes` empty): the CLI prints `LIVE — minute rows so far, not settled; the post-call run replaces them` and only the known summary fields.

```bash
invd earnings price-attribution --event <event_id>
```

#### `earnings audio` *(selector)*

The recording as a presigned URL, or `-o, --output <file>` (+ `--force`) to save it.

```bash
invd earnings audio --event <event_id> --output call.mp3
```

#### `earnings slides` *(selector)*

| Option | Description |
|--------|-------------|
| `--markdown` | Include each page's extracted text |
| `--pages <range>` | Page or range, e.g. `3` or `1-5` |
| `-o, --output <file>` / `--force` | Save the deck PDF |

```bash
invd earnings slides -i AAPL --year 2026 --quarter 4 --output deck.pdf
```

#### `earnings documents` *(selector)*

Investor documents of the call (CFO commentary, data sheets, letters, filings).

| Option | Description |
|--------|-------------|
| `--kind <list>` | `cfo_commentary`, `financial_data`, `shareholder_letter`, `fact_sheet`, `company_transcript`, `sec_filing`, `infographic`, `other` |
| `--body` | Include the extracted text |
| `-l, --limit` / `--offset` | Page size (1–100), offset |
| `-o, --output <dir>` / `--force` | Save every document as `<kind>-<document_id>.<ext>` |

With `--output`, a document without a download URL (a link-only `sec_filing`, or a file the API could not fetch — use its `source_url`) is never skipped silently: each gets a warning on stderr, followed by a count (`2 of 3 documents saved; 1 skipped`). The exit code is 0 when at least one document was saved (or the list was empty) and 1 when documents were listed but none could be saved. An interrupted download (Ctrl-C) never leaves a partial file behind.

```bash
invd earnings documents --event <event_id> --output ./docs
```

#### `earnings company-documents`

A company's investor-relations library outside its calls' folders — annual reports, proxy statements, ESG / governance documents, investor-day and conference decks, shareholder letters, fact sheets, and link-only webcast replay pages — newest year first. Company-published material, shown as published (STANDARD, 1 credit).

| Option | Description |
|--------|-------------|
| `-i, --identifier <ticker>` | Ticker or CIK **(required)** |
| `--section <list>` | `quarterly_results`, `events_archive`, `presentations_archive`, `annual_reports`, `proxy`, `sec_filings`, `press_releases`, `esg`, `governance`, `faq`, `other` |
| `--kind <list>` | e.g. `annual_report`, `proxy_statement`, `esg_report`, `investor_day_deck`, `conference_presentation`, `shareholder_letter`, `fact_sheet`, `webcast` |
| `--year <n>` / `--period <p>` | Year / period (`Q1`–`Q4`, `H1`, `H2`, `FY`) |
| `--event <event_id>` | Only the documents of this event (investor day, conference, AGM) |
| `-l, --limit` / `--offset` | Page size (1–100), offset (`--all` follows every page) |
| `-o, --output <dir>` / `--force` | Save every stored file as `<year>-<kind>-<document_id>.<ext>` (`undated-…` without a year) |

A link-only row (a `webcast` replay page) has no file: `--output` warns on stderr with its `source_url`, like `documents --output`; the exit code is 1 only when documents were listed but none could be saved.

```bash
invd earnings company-documents -i AAPL --section annual_reports,proxy
invd earnings company-documents -i AAPL --kind investor_day_deck --output ./ir-docs
```

#### `earnings document`

One company document by `document_id` (from `company-documents` or `document-search`): metadata and signed URLs (`url` = the file, `pages_url` = its per-page text as JSON; both expire).

| Option | Description |
|--------|-------------|
| `--pages` | Print the per-page text (inline up to 2 MB, else read from `pages_url`) |
| `-o, --output <file>` / `--force` | Save the file (with `--pages`: the text) |

```bash
invd earnings document <document_id> --pages
invd earnings document <document_id> --output annual-report.pdf
```

#### `earnings document-search`

Semantic search over company documents — the calls' documents (CFO commentary, letters, data sheets, company transcripts) and the IR libraries — returning passages from company-published documents with their document, year and page, not verified facts (STANDARD, 10 credits). Open a hit's `url` at `#page=<page>`.

| Option | Description |
|--------|-------------|
| `-q, --query <text>` | Search text **(required)** |
| `-i, --identifier <ticker>` | Only this company |
| `--kind <list>` / `--section <list>` / `--year <n>` | Kinds, IR sections (IR library only), year |
| `--table <table>` | `event_documents` (call documents) or `company_documents` (IR library) |
| `-l, --limit <n>` | Passages (1–20) |

```bash
invd earnings document-search -q "capital allocation" -i AAPL --table company_documents
```

#### `earnings search`

Semantic search over call transcripts and slides.

| Option | Description |
|--------|-------------|
| `-q, --query <text>` | Search text **(required)** |
| `--event <event_id>` / `-i, --identifier <ticker>` | Only this call / company |
| `--from <date>` / `--to <date>` | Call day range |
| `--type <type>` | `transcript`, `qa`, `preparedRemarks`, `presentation` |
| `--event-type <type>` | `earnings_call` (default), `investor_day`, `conference`, `agm`, `other`, or `all` |
| `-l, --limit <n>` | Passages (1–8) |

```bash
invd earnings search -q "data center demand" -i NVDA
```

#### `earnings stream` *(selector)*

The live HLS audio URL of a call in progress (PRO; `status` = `available`, `not_started`, `ended` or `disabled`). Play it with `ffplay` or VLC; the URL expires (`expires_at`).

```bash
invd earnings stream --event <event_id>
```

---

### ownership

Institutional ownership data.

#### `ownership holdings-by-investor`

Fetch all holdings for an institutional investor.

| Option | Description | Default |
|--------|-------------|---------|
| `--cik <cik>` | Institution CIK **(required)** | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd ownership holdings-by-investor --cik 0001067983
```

#### `ownership holdings-by-company`

Fetch institutional holders of a company.

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `--min-value <n>` | Minimum holding value filter | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd ownership holdings-by-company -i AAPL --min-value 1000000
```

#### `ownership transactions`

Fetch institutional ownership transactions.

| Option | Description | Default |
|--------|-------------|---------|
| `--cik <cik>` | Institution CIK | — |
| `-i, --identifier <ticker>` | Ticker symbol or CIK | — |
| `--start-date <date>` | Start date (YYYY-MM-DD) | — |
| `--end-date <date>` | End date (YYYY-MM-DD) | — |
| `--type <type>` | Transaction type: `new_buy`, `added`, `reduced`, `sold_out` | — |
| `--calendar-year <year>` | Filter by calendar year | — |
| `--calendar-quarter <q>` | Filter by calendar quarter | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd ownership transactions -i AAPL --type new_buy
invd ownership transactions --cik 0001067983 --calendar-year 2024
```

#### `ownership institutions`

List institutional investors.

| Option | Description | Default |
|--------|-------------|---------|
| `--ciks <ciks>` | Comma-separated institution CIKs | — |
| `-s, --sort <dir>` | Sort direction | `asc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd ownership institutions
invd ownership institutions --ciks 0001067983,0001364742
```

---

### insider-trades

Insider trading data.

#### `insider-trades list`

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --identifier <ticker>` | Ticker symbol or CIK **(required)** | — |
| `--start-date <date>` | Start date (YYYY-MM-DD) | — |
| `--end-date <date>` | End date (YYYY-MM-DD) | — |
| `--acquired-disposed <ad>` | `A` (acquisition) or `D` (disposition) | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd insider-trades list -i AAPL
invd insider-trades list -i TSLA --acquired-disposed D --limit 20
```

---

### ipos

IPO listings.

#### `ipos list`

| Option | Description | Default |
|--------|-------------|---------|
| `--start-date <date>` | Start date (YYYY-MM-DD) | — |
| `--end-date <date>` | End date (YYYY-MM-DD) | — |
| `-s, --sort <dir>` | Sort direction | `desc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd ipos list --start-date 2024-01-01 --end-date 2024-12-31
```

---

### market

Market data.

#### `market holidays`

Fetch market holidays.

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --sort <dir>` | Sort direction | `asc` |
| `-l, --limit <n>` | Maximum results | `100` |
| `--offset <n>` | Pagination offset | `0` |

```bash
invd market holidays
```

---

### metadata

API metadata and available identifiers.

#### `metadata metrics`

List all available standardized financial metrics.

```bash
invd metadata metrics
```

#### `metadata section-ids`

List available section IDs for SEC filings.

```bash
invd metadata section-ids
```

---

### webhooks

Earnings-call webhook subscriptions (PRO): signed, retried `POST`s of the call lifecycle to your HTTPS endpoint. Events: `earnings_call.scheduled`, `.rescheduled`, `.started`, `.ended`, `.transcript_provisional`, `.transcript_ready`, `.transcript_corrected`, `.assets_ready`, `.keyword_hit` (one delivery per mention of one of the subscription's `--keywords` on a live call, with the speaker, `start_ms` and the sentence), `.guidance_flash` (a guidance number spoken live, before the final transcript), and `ping`. Deliveries carry `X-Invinite-Signature: t=…,v1=…` (HMAC-SHA256 of `<t>.<raw body>` with the secret) and are retried after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h.

| Command | Description |
|---------|-------------|
| `webhooks list` | Your account's subscriptions (never the secret, only `secret_hint`) |
| `webhooks create --url <url> --events <list> [--ciks <list>] [--keywords <list>]` | Create one (max 10 per account; `--ciks` max 10, default every company; `--keywords` max 20 of 2–64 chars, matched on every live call for `.keyword_hit`). **Prints the signing secret once** |
| `webhooks update <id> [--keywords <list>] [--ciks <list>] [--events <list>] [--active true\|false]` | Change a subscription (`PATCH`; at least one option; an empty `--keywords ""` / `--ciks ""` clears the list; `--active false` pauses it, `true` resumes it and resets the failure counters) |
| `webhooks delete <id>` | Delete a subscription |
| `webhooks rotate-secret <id>` | New secret (printed once); the old one stays valid until `previous_secret_expires_at` (5 min) |
| `webhooks test <id>` | Queue a signed `ping` delivery |
| `webhooks deliveries <id>` | The last 100 attempts: `delivery_id`, `event`, `attempt`, `status`, `response_status`, `duration_ms`, `at`, `next_attempt_at` |

```bash
invd webhooks create --url https://hooks.example.com/invinite --events earnings_call.transcript_ready,earnings_call.started --ciks 320193
invd webhooks create --url https://hooks.example.com/alerts --events earnings_call.keyword_hit --keywords tariffs,buyback   # every company
invd webhooks update <id> --keywords tariffs,china,buyback
invd webhooks update <id> --active false
invd webhooks test <id>
invd webhooks deliveries <id>
```

---

### ws

Real-time WebSocket streaming.

#### `ws listen`

Listen to real-time SEC filing notifications, or with `--earnings` follow one earnings call's live transcript (PRO), or with `--all-live --keywords` get keyword alerts across every live call. Automatically reconnects on disconnection with exponential backoff.

| Option | Description |
|--------|-------------|
| `--earnings <event_id\|cik>` | Follow a live call: event ID (UUID) or CIK |
| `--all-live` | Keyword alerts across every live call at once (needs `--keywords`; no transcript, replay or partials) |
| `--since-seq <n>` | Replay the finals after this seq (default `-1` = the whole call so far) |
| `--partials` | Show interim segments, overwritten in place (terminal only; `--json` emits them) |
| `--names` | Print each speaker-name snapshot |
| `--prices` | Price ticks of the call's stock (≤ 1/s), shown as one line updated in place (terminal only; `--json` emits them); per-call only |
| `--keywords <list>` | Comma-separated keywords (max 20, 2–64 chars each): one highlighted `keyword_hit` line per mention |
| `--keyword-match exact\|stem` | `exact` (default) matches the word; `stem` also its inflections (`tariff` hits "tariffs") |
| `--speaker-roles <list>` | Only hits by these speakers: `executive`, `ir_host`, `analyst`, `operator` |
| `--min-rank <n>` | With `--all-live`: only companies ranked ≤ n by market cap |

```bash
invd ws listen
```

Press `Ctrl+C` to disconnect.

**Live transcripts.** Find a call in progress, then follow it:

```bash
invd earnings live
invd ws listen --earnings 0b9d6f43-6b1e-4c39-9d3a-2f6a3c1e8b11 --partials
# AAPL 2026-10-30T21:00:00.000Z · capturing · from seq 0 (latest 41)
# [0:12] Operator: Good afternoon and welcome to the Apple Q4 fiscal year 2026 earnings call.
# [1:05] Tim Cook: Thank you, everyone, for joining us.
```

**Keyword and guidance alerts.** With `--keywords` the same subscription also delivers a `keyword_hit` frame for every mention (one highlighted line: `[m:ss] keyword "tariffs" · Tim Cook (executive): …`, the speaker from the API's live naming) and a `guidance_flash` frame for every guidance number spoken live (`[m:ss] guidance flash · Revenue Q1 FY2027: USD 4.1–4.3 billion — "…"`), both before the final transcript. `--all-live --keywords <list>` subscribes to every live call at once (`scope: "all_live"`; each line starts with the symbol; the API refuses it without keywords, and so does the CLI); a `warning` frame (`global_scope_degraded`: some calls may be missing from the alerts) is printed and never fatal. With `--json` both frames are emitted as they arrive.

```bash
invd ws listen --earnings 320193 --keywords tariffs,china --keyword-match stem --speaker-roles executive
invd ws listen --all-live --keywords tariffs --min-rank 500
invd ws listen --all-live --keywords tariffs --json | jq -r 'select(.type=="keyword_hit") | "\(.symbol) \(.speaker_name): \(.text)"'
```

**Live prices.** With `--prices` the same per-call subscription also delivers a `price_tick` frame (PRO, at most one per second, only for seconds with a trade — pre-market and after-hours seconds are sparse). On a terminal it is one line rewritten in place — `[16:32:05 ET · 12:34] AAPL 336.08  +42.5 bp since call  −127.5 bp on day  (vol 1,240)`: New York time, the call clock of the transcript (`m:ss`, the same clock as the segments' `[m:ss]`), the price, the return since the last trade before the call and the day's return vs the previous close; green / red by the since-call return, dim from the snapshot fallback. The line shows temporal coincidence with what is being said, not attribution of cause. Price ticks follow one call: `--all-live --prices` is refused (as by the API). With `--json` the frames are emitted as they arrive: `invd ws listen --earnings <event_id> --prices --json | jq 'select(.type=="price_tick")'`. The minute rows so far are `invd earnings price-attribution --event <event_id>`.

```bash
invd ws listen --earnings <event_id> --prices
```

Finals are named from the newest speaker-name snapshot (`Speaker A` until a name is known). A `gap` line marks a seq range with no final yet (a late final may still follow on the same subscription, so finals can print slightly out of order); `resume_unavailable` means missed finals cannot be replayed right now — live delivery continues and the API back-fills them once it can. Neither needs a re-subscribe. After a reconnect the listener resumes after the last final it printed; it exits once the final transcript is ready (`invd earnings transcript --event <id>`). With `--json` every frame is one JSON line (NDJSON), e.g. `invd ws listen --earnings 320193 --json | jq -r 'select(.type=="transcript_segment") | .text'`.

---

## Output Formats

By default, data is displayed as formatted tables with aligned columns and number formatting.

```bash
# Default table output
invd company search -q Apple

# Raw JSON output (useful for piping to jq or other tools)
invd company search -q Apple --json

# Pipe to jq
invd financials income-statement -i AAPL -p annual --json | jq '.data[0]'
```

Financial statements with `--presentation` are displayed as indented trees showing the hierarchical structure of line items.

## Pagination

Results are paginated by default. Use `--limit` and `--offset` to control pagination manually, or use `--all` to automatically fetch all pages:

```bash
# Get first 10 results (default)
invd company dividends -i AAPL

# Get results 20-30
invd company dividends -i AAPL --limit 10 --offset 20

# Fetch all results automatically
invd company dividends -i AAPL --all
```

## Development

```bash
# Run in development mode (no build step)
npm run dev -- company search -q Apple

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## License

ISC
