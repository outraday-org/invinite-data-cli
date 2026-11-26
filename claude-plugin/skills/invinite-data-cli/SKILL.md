---
name: invinite-data-cli
description: Use the invd CLI for Invinite financial data when no Invinite Data MCP connector is available or the user asks for the invd CLI, a shell command or a script — it maps every Invinite Data MCP tool to an invd command and gives the CLI grammar, output flags, exit codes and the full command reference.
allowed-tools: Bash(invd *)
---

# Invinite Data CLI (`invd`)

The `invd` CLI reaches the same Data API as the Invinite Data MCP tools and bills the same account. The other
Invinite skills (`invinite-financial-data`, the data guide, and the workflows such as `analyze-earnings-call`) are
written in MCP tool terms: when you work through the CLI, follow them and translate each tool with the table below.
Read [references/commands.md](references/commands.md) for one example of every command.

## Transport selection

1. Prefer the MCP tools when an Invinite Data connector is connected: call the domain tool matching the request.
   `search_endpoints` + `call_api` reach any operation without a dedicated tool.
2. Otherwise use the CLI (11.4 or later). Pass `--json` (or `--json a,b` for only the fields you need) for data you
   analyse.
3. Do not repeat a successful request over the other transport.

## MCP and CLI mapping

The v2 tool roster of the MCP server and the matching CLI commands. A connector that still lists older tool names
serves the earlier roster; use whatever tools it lists, or the CLI.

| Data need | MCP tool (v2 roster) | CLI |
|---|---|---|
| US inflation, GDP and income, employment, weekly claims or Treasury yields | `search_endpoints` with `q=macro`, then `call_api` | `invd macro series`, `invd macro inflation --series cpi_all_sa`, `invd macro gdp-snapshot`, `invd macro labor --series initial_claims_sa`, `invd macro yield-curve-snapshot` |
| What a ticker is (stock, ETF, closed-end fund, ETN) and what is served for it; find an instrument or filer | `search_instruments` | `invd instruments get TQQQ`, `invd instruments list -q apple`, `invd filers list -q berkshire` |
| Company profile, fiscal periods, dividends, splits | `get_company` | `invd companies get\|fiscal-periods`, `invd dividends`, `invd splits` |
| Fund profile, holdings, weights (ETFs, closed-end funds) | `get_fund` | `invd funds get\|holdings\|weights`, `invd funds list --type etf` |
| Statements (standardized / as-reported; summary / detailed / presentation) | `get_financials` | `invd financials AAPL --basis … --view …` |
| Ratios, growth, CAGR, segments | `get_metrics` | `invd metrics ratios\|growth\|cagr`, `invd segments list\|list-detailed` |
| Where a number comes from | `explain_fact` | `invd metrics explain`, `invd documents fact-places` |
| Every value filed for one XBRL fact (restatements, by filing) | `search_endpoints` + `call_api` (`/v1/financials/vintages`) | `invd metrics vintages AAPL -c RevenueFromContractWithCustomerExcludingAssessedTax -e 2024-09-28` |
| SEC filings of a stock or a fund | `list_filings` | `invd filings list` |
| Read a filing or document version | `read_filing` | `invd filings get`, `invd documents get\|sections\|figure` |
| Full-text search of filings (100 credits) | `search_filings` | `invd search filings` |
| Who holds a stock or a fund (13F, N-PORT, issuer files), 13F changes, a manager's portfolio | `get_holders` | `invd holders list\|changes`, `invd filers holdings\|holding-changes`, `invd filings holdings` |
| Form 4 insider trades, one insider across issuers | `get_insider_trades` (`company` or `owner`) | `invd insider-trades list\|get`, `--owner <cik>` |
| Form 3/4/5 insider holdings (by company or by insider) | `search_endpoints` + `call_api` (`/v1/insider-holdings`) | `invd insider-trades holdings`, `--owner <cik>` |
| Holders above 5 % (Schedule 13D activist / 13G passive), the amendment chain | `search_endpoints` + `call_api` (`/v1/beneficial-ownership`) | `invd ownership beneficial`, `--filer <cik>`, `--type`, `--no-current` |
| Planned insider sales (Form 144) | `search_endpoints` + `call_api` (`/v1/insider-sale-notices`) | `invd ownership sale-notices`, `--owner <cik>` |
| Earnings-call calendar and history | `list_events` | `invd events list` |
| One event: transcript, Q&A, stats, comparison, press release, slides … | `get_event` | `invd events get\|transcript\|transcript-text\|qa\|stats\|comparison\|press-release\|slides\|price-attribution` |
| Search transcripts and investor documents | `search_transcripts` | `invd search transcripts`, `invd search investor-documents` |
| News items, text, announcements, news search | `get_news` | `invd news list\|get\|text\|announcements`, `invd search news` |
| Account and usage | `get_account` | `invd me show\|usage` |
| Alerts, their event log | `manage_alerts` | `invd alerts …`, `invd alert-events list\|get\|tail` |
| Alert destinations (webhook endpoints) | `manage_destinations` | `invd destinations …` |
| End users of your alerts, their limits and the account defaults | `manage_alert_users` | `invd alert-users …`, `invd me alert-user-defaults-get\|alert-user-defaults-update` |
| Hosted chartlang scripts, indicator templates | `call_api` (`/v1/scripts`, `/v1/alert-templates`) | `invd scripts list\|get\|upload\|delete`, `invd script-versions list`, `invd alert-templates list` |
| Any other operation | `search_endpoints` + `call_api` | `invd api GET /v1/…` |

MCP resources `invinite://catalog/metrics`, `invinite://catalog/sections`, `invinite://catalog/event-types`,
`invinite://catalog/forms` and `invinite://catalog/document-kinds` are the catalogs (`invd catalog metrics`, `invd catalog sections`, `invd catalog event-types`, `invd catalog forms`,
`invd catalog document-kinds`); `invd catalog exchanges` and `invd catalog sectors` list the exchanges and sectors.
The server's prompts are `analyse_earnings_call`, `compare_companies`, `summarise_10k_risk_factors`, `earnings_preview`,
`ownership_and_insiders`, `what_changed_since_last_report` and `restatement_history`.

## Prerequisites

### MCP

Connect `https://api.data.invinite.com/mcp` with OAuth and sign in to the Invinite Data account to be billed. Leave the
OAuth client ID and secret empty (the client registers itself by
Client ID Metadata Document or Dynamic Client Registration, with PKCE). `invd agent-setup` writes the connector for
Claude Code or Codex in one step.

### CLI

Install with `npm install -g @invinite-org/invinite-data-cli`, then run `invd auth login`. The key is resolved in this
order: `INVD_API_KEY` > `INVINITE_DATA_API_KEY` > `./.env` (either name) > OS keychain > `api_key` in
`~/.config/invinite/invd.toml`.
`invd auth status` shows which key is active and whose account it is (free).

An auth failure exits 4: reconnect the MCP connector, or tell the user to run `invd auth login` (or set
`INVD_API_KEY`; keys at https://data.invinite.com/keys).

## The CLI grammar

- Noun-verb: `invd <group> <action>`. `list` is each group's default action, so `invd filings AAPL --form 10-K` equals
  `invd filings list AAPL --form 10-K` and `invd events AAPL` lists Apple's calls.
- The first positional is the natural key: a symbol; `invd instruments get <symbol>` says what it is (`stock`, `etf`,
  `closed_end_fund`, `etn`) and which data families are served for it. Company commands take a company's ticker or
  CIK (several allowed: `invd financials AAPL MSFT`); a fund (SPY, TQQQ) is no company and answers one `not_covered`
  error naming what IS served for it. `filings`, `dividends`, `splits` take any instrument; `invd holders` takes ONE
  symbol. Member commands take the member id (`invd companies get AAPL`, `invd funds get SPY`,
  `invd filings get 0000320193-26-000026`, `invd events transcript <event_id>`).
- Every command that takes an `event_id` also takes a company plus a fiscal period: `invd events transcript NVDA 2026Q3`
  resolves the event through `GET /v1/events` (one extra credit; the resolution is noted on stderr).
- Flags are the API parameters with dashes (`fiscal_year` → `--fiscal-year`, `filed_at[gte]` → `--filed-at-gte`).
  `invd <group> <action> --help` lists them with the API's descriptions, the credit cost and plan, and the row fields.
- Plans (Data API 10.0): `companies` (with `companies fiscal-periods`), `instruments`, `catalog`, `market holidays`,
  `events list` / `get` and `me` reach every plan. Lite adds filings, filers, `documents`, `financials` (summary
  view), `metrics`, `guidance list`, `holders list`, `dividends`, `splits`, `news`, `funds`, `ipos`, `offerings`,
  `people`, `events press-release` and the alerts commands (`alerts`, `alert-events`, `alert-templates`, `alert-users`,
  `destinations`, `scripts`, `script-versions`). Standard adds `segments list`, `insider-trades` (incl. `holdings`), `ownership`, `search filings` and
  `search news`. Pro adds the earnings-call content (transcripts, Q&A, stats, audio, slides, comparison, prosody, price
  attribution, transcript diff and versions), `investor-documents`, `search transcripts`, `search investor-documents`,
  the detailed and presentation `financials` views, `segments list-detailed`, `guidance kpis`, holder changes and fact
  places, `metrics vintages` (and the WebSocket stream); `filings datasets` needs Enterprise. Pay as you go (credits without a plan;
  `invd me show` says `payg`) reaches what Pro reaches except live data; the API's refusal says so. `--help` names each
  command's plan; a refused plan exits 6 and the error names the plan.
- `invd api` calls any path the tree lacks: `invd api GET /v1/filings?symbol=AAPL --paginate --jq '.data[].accession'`.

## Output, pagination and cost

| Flag | Effect |
|---|---|
| `--json` / `--json a,b` | the whole body / only those fields of each row (fields listed in `--help`) |
| `--output table\|plain\|json\|jsonl\|csv`, `--plain` | explicit format (default: table on a terminal, tab-separated when piped) |
| `--jq <expr>` | filter the JSON |
| `--fields a,b` | server-side prune where the operation supports `fields=` |
| `--limit`, `--cursor` | page size; the previous page's `next_cursor`, with the SAME filters |
| `--all` | every page, streamed as JSONL (CSV with `--output csv`) |
| `--dry-run` | the request plan and credit estimate; sends nothing |
| `--show-cost` | the credits the command cost, on stderr (or `INVD_SHOW_COST=1`) |
| `--yes`, `--no-input` | skip / refuse the confirmation of a costly `--all` walk or a delete |
| `--save <file>` / `--out <dir>` | save the file a response points to (transcript PDF, audio, news PDF, investor document, a bulk data file) to a file / into a directory under its own name; size and SHA-256 verified |

Data is on stdout; progress, cost and coverage notes on stderr, so `--json` output stays clean. When a response's
`meta.coverage` is `pending` or `partial`, few or no rows are not proof that something does not exist: say the data is
incomplete instead of "nothing found".

Before a large pull (`--all`, many companies, `search filings` at 100 credits a page) check what is left with
`invd me usage --json` (free) and estimate with `--dry-run`. If the pull would not fit, say so before starting it.

Exit codes: 0 ok, 1 refused or failed, 2 usage (incl. `invalid_parameter`, `unknown_parameter`, `cursor_mismatch`, or
a needed answer under `--no-input`), 3 not found (`not_found`, `not_covered`), 4 auth required, 5 download integrity,
6 credits exhausted or plan required (`plan_required`, `insufficient_credits`), 7 partial (an `--all` cut by a failure:
resume with the printed `--cursor`), 130 / 143 interrupted.

An error is at most three stderr lines: `✗ <detail>  (<code>)`, then what to do (an `invd` command, else the API's
`remedy`), then the request id and docs link. Follow the remedy line; with `--json` the problem body (`code`, `param`,
`remedy`, `request_id`) follows as one JSON line on stderr.

## CLI specifics the MCP-oriented skills do not cover

- **Statements**: `invd financials <company…>` is one command over six operations: `--basis standardized|as-reported`,
  `--view summary|detailed|presentation`, `-s, --statement`, `-p, --period` (without it: `quarterly` when
  `--fiscal-quarter` is 1–3, else `annual`), `--fiscal-year-gte` / `--fiscal-year-lte`, `--as-of`, `--filing`,
  `--metrics` (only the listed metric ids or XBRL concepts), and on `--basis as-reported` only `--reported-only` and
  `--display-sign cash_flow_direction`.
- **Lineage**: `invd metrics explain "<fact_id>"`, `invd documents fact-places --fact <fact_id>` (Pro),
  `invd metrics vintages AAPL -c RevenueFromContractWithCustomerExcludingAssessedTax -e 2024-09-28` (`--period-start`,
  `--member` narrow it).
- **Filings**: `invd filings get <accession> --expand documents` gives each document's `version_id`;
  `invd documents sections <version_id>` lists its sections and blocks; `invd documents get <version_id> --blocks b12-b40`
  reads them.
- **Calls**: `invd events transcript <event_id> --layer cleaned` (turns with `start_ms`; `-v <version>` for an older
  version), `invd events transcript-text <event_id> --split sections` (prepared remarks and Q&A apart),
  `invd events comparison <event_id> --prior <event_id>`, `invd guidance NVDA --review approved`,
  `invd guidance kpis NVDA --event <event_id>`.
- **Files**: `--save <file>` (or `--out <dir>`) stores what a response points to (transcript PDF, audio, news PDF,
  investor document), size and SHA-256 verified. Never pass it unless the user asked for a file.
- **Bulk data** (Enterprise, no MCP equivalent: the downloads are unreachable from MCP by design): `invd bulk files
  --dataset f13 --kind parsed`, `invd bulk download <file_id> --out <dir>`, `invd bulk export --dataset f13 --company
  AAPL --from 2026-01-01 --to 2026-06-30 --wait --out <dir>` (polls until ready, then saves). The download URL is a
  15-minute credential: it prints as `<hidden: …>`; never use `--print-url` to put it in an answer. Each download and
  each new export counts against a daily limit, so download only what the user asked for.
- **Alerts**: `invd alert-events tail` follows new events live as JSON lines (no MCP equivalent);
  `invd alerts batch --body-file alerts.json` upserts many alerts by `client_reference_id`; a delete asks first unless
  `--yes`. The `alert-setup` skill walks through choosing a type, a destination, testing and changing an alert.
- **Hosted chartlang scripts** (CLI and REST only): `invd scripts upload ema-cross.chart --json` compiles server-side
  and prints the version (`scv_…`, the alert's `script_version_id`), its `alert_ids` (what `condition.alert_ids` may
  name) and each diagnostic as `file:line:column severity message`; a compile error exits 1 (the version is stored with
  `status: error` and no alert can use it). Show the user the diagnostics, fix the source, upload again with
  `--script <scr-id>`. Sources are ≤ 200 KB and may import only `@invinite-org/chartlang-core`; a script keeps at most
  20 versions. `invd script-versions list <script-id>` lists the versions and their plot slot ids.
- **End users**: `invd alert-users batch` maps the user's customer tiers (≤ 500 upserts, one result each);
  `invd me alert-user-defaults-update --max-active-alerts 10` sets the account defaults.
- **Catalogs**: `invd catalog metrics`, `invd catalog sections --form 10-K`, `invd catalog event-types`,
  `invd catalog forms`, `invd catalog document-kinds`, `invd catalog exchanges`, `invd catalog sectors`.

## Common patterns

### Comparing companies

```bash
invd catalog metrics --json
invd companies get AAPL --json
invd financials AAPL MSFT GOOGL --fiscal-year 2025 --json
invd metrics ratios AAPL MSFT GOOGL -p annual --category profitability,valuation --json
invd metrics cagr AAPL MSFT GOOGL -p annual --horizon 5 --json
```

### The latest quarter

```bash
invd financials AAPL --period quarterly --limit 1 --json
```

### Who owns a stock, and who is buying

```bash
invd holders AAPL --source 13f --limit 50 --json
invd holders changes AAPL --type new,added --json
```

### What is this ticker, and what does a fund hold

```bash
invd instruments get TQQQ --json type,structure,datasets
invd funds holdings TQQQ --limit 10 --json
invd holders TQQQ --json
```

### Reading an earnings call

Resolve the call, then read from the cheapest source to the most detailed:

```bash
invd events NVDA --status ended --sort -scheduled_at --limit 1 --json event_id,fiscal_year,fiscal_quarter,has_transcript
invd events press-release <event_id> --json
invd guidance NVDA --event <event_id> --json
invd events qa <event_id> --json
invd events comparison <event_id> --json
invd search transcripts "data center revenue" --event <event_id> --mode literal --json
invd events transcript-text <event_id> --json
```

### Reading a filing section

```bash
invd filings AAPL --form 10-K --limit 1 --json accession,filing_date
invd filings get 0000320193-26-000026 --expand documents --json
invd documents sections <version_id> --json
invd documents get <version_id> --blocks b12-b40 --json
```

### What a company announced

```bash
invd news announcements NVDA --announced-at-gte 2026-11-01 --json
invd news NVDA --published-at-gte 2026-11-01 --json
invd news text <id> --json
```

Answer with the publisher, date and link of each item.

## Tips

- Use `--json` (or `--json a,b`) for data you analyse; tables are for people.
- Use `--all` sparingly and `--dry-run` first: some lists hold thousands of rows.
- Tickers and CIKs are interchangeable as the company positional; a CIK also reaches a filer without a listing
  (`invd filers get 0000102909`).
- Fiscal periods follow the company's fiscal calendar: a fiscal Q4 can end in the next calendar year.
- Keep `meta.coverage` in mind: `pending` / `partial` means the answer is incomplete.

