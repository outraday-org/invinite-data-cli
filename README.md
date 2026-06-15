# @outraday-org/invinite-data-cli

Command-line interface for the [Invinite Data API](https://invinite.com/docs/data-api/overview) — access company data, financial statements, SEC filings, institutional ownership, and more from your terminal.

## Installation

### From npm

```bash
npm install -g @outraday-org/invinite-data-cli
```

To update to the latest version:

```bash
npm update -g @outraday-org/invinite-data-cli
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

The CLI requires an Invinite Data API key. The key is resolved in the following order:

1. **Environment variable** — `INVINITE_DATA_API_KEY`
2. **OS keychain** — via the optional `keytar` package
3. **Stored config** — set with the CLI

### Set your API key

```bash
invd config set-key
```

You'll be prompted to enter your key (input is masked). Alternatively, export it as an environment variable:

```bash
export INVINITE_DATA_API_KEY=your-api-key
```

## AI Plugin

This repo includes plugins for AI coding tools that enable AI-powered financial data retrieval and analysis. Supports **Claude Code**, **OpenCode**, **Codex**, and **Copilot**.

### Quick install

```bash
# Interactive — prompts for runtime and scope
npx @outraday-org/invinite-data-cli@latest plugin install

# Non-interactive examples
npx @outraday-org/invinite-data-cli@latest plugin install --claude --global
npx @outraday-org/invinite-data-cli@latest plugin install --claude --local
npx @outraday-org/invinite-data-cli@latest plugin install --opencode --global
npx @outraday-org/invinite-data-cli@latest plugin install --codex --global
npx @outraday-org/invinite-data-cli@latest plugin install --copilot --local
npx @outraday-org/invinite-data-cli@latest plugin install --all --global
```

### Update

To update the plugin to the latest version, re-run the install command:

```bash
npx @outraday-org/invinite-data-cli@latest plugin install --claude --global
npx @outraday-org/invinite-data-cli@latest plugin install --all --global
```

### Uninstall

```bash
npx @outraday-org/invinite-data-cli@latest plugin uninstall --claude --global
npx @outraday-org/invinite-data-cli@latest plugin uninstall --all --global
```

### What gets installed

| Runtime | Skill | Agent | Command |
|---------|-------|-------|---------|
| **Claude Code** | `skills/invinite-data-cli/SKILL.md` | `agents/invinite-data.md` | `commands/financial-research.md` |
| **OpenCode** | `command/invinite-data-cli.md` | `agents/invinite-data.md` | — |
| **Codex** | `skills/invinite-data-cli/SKILL.md` | — | `skills/invinite-financial-research/SKILL.md` |
| **Copilot** | `skills/invinite-data-cli/SKILL.md` | — | `skills/invinite-financial-research/SKILL.md` |

### Alternative: Claude Code plugin directory

```bash
claude --plugin-dir /path/to/invinite-data-cli/claude-plugin
```

### Usage examples

Use `/financial-research` for multi-step analysis:

```
/financial-research Compare Apple, Microsoft, and Google's profitability and growth over the last 3 years
/financial-research Who are the largest institutional holders of TSLA and what are recent ownership changes?
/financial-research Analyze risk factors from NVDA's latest 10-K filing
```

Or ask questions directly — the AI will auto-trigger the skill and delegate to the data agent as needed.

> **Note:** The CLI must be installed and authenticated (see [Authentication](#authentication)) for the plugin to work.

## Global Options

These options are available on all data commands:

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON (pipe-friendly) |
| `--all` | Auto-paginate through all results |

## Commands

- [config](#config) — Manage CLI configuration
- [health](#health) — Check API health
- [company](#company) — Company information
- [financials](#financials) — Financial statements
- [metrics](#metrics) — Financial metrics, ratios, and growth
- [segments](#segments) — Segmented financials
- [filings](#filings) — SEC filings
- [ownership](#ownership) — Institutional ownership
- [insider-trades](#insider-trades) — Insider trading data
- [ipos](#ipos) — IPO listings
- [market](#market) — Market data
- [metadata](#metadata) — API metadata
- [ws](#ws) — WebSocket streaming

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

### ws

Real-time WebSocket streaming.

#### `ws listen`

Listen to real-time SEC filing notifications. Automatically reconnects on disconnection with exponential backoff.

```bash
invd ws listen
```

Press `Ctrl+C` to disconnect.

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
