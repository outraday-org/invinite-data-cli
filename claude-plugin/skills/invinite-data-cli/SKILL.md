---
name: invinite-financial-data
description: Fetch financial data through the Invinite Data API (v2) MCP connector or the invd 4 CLI. Use whenever the user wants company information, financial statements (standardized or as-reported, point in time), ratios, growth, CAGR, segments, SEC filings and filing documents, earnings calls (calendar, transcripts, Q&A, guidance, KPIs, slides, press releases, call comparison), executives and analysts, 13F holdings, insider trades, IPOs, market holidays, company news and newsroom announcements, investor documents, or full-text search over filings, transcripts and news, including requests mentioning tickers, CIKs, accessions, balance sheets, income statements, cash flows, 10-K, 10-Q, 8-K, dividends, stock splits or institutional holders.
allowed-tools: Bash(invd *)
---

# Invinite Data API

Use the connected Invinite Data MCP tools when available; fall back to the `invd` CLI (version 4, the v2 API) when MCP
is unavailable or the user asks for the CLI. Both reach the same Data API and bill the same Invinite Data account.

## Transport selection

1. Prefer the MCP tools when an Invinite Data connector is connected: call the domain tool matching the request.
   `search_endpoints` + `call_api` reach any operation without a dedicated tool.
2. Otherwise use the CLI. Pass `--json` (or `--json a,b` for only the fields you need) for data you analyse.
3. Do not repeat a successful request over the other transport.

### MCP and CLI mapping

The v2 tool roster of the MCP server and the matching CLI commands. A connector that still lists older tool names
serves the earlier roster; use whatever tools it lists, or the CLI.

| Data need | MCP tool (v2 roster) | CLI |
|---|---|---|
| Find a company or filer | `search_companies` | `invd companies list -q apple`, `invd filers list -q berkshire` |
| Company profile, fiscal periods, dividends, splits | `get_company` | `invd companies get\|fiscal-periods\|dividends\|splits` |
| Statements (standardized / as-reported; summary / detailed / presentation) | `get_financials` | `invd financials AAPL --basis … --view …` |
| Ratios, growth, CAGR, segments | `get_metrics` | `invd metrics ratios\|growth\|cagr`, `invd segments list\|list-detailed` |
| Where a number comes from | `explain_fact` | `invd metrics explain`, `invd documents fact-places` |
| SEC filings of a company | `list_filings` | `invd filings list` |
| Read a filing or document version | `read_filing` | `invd filings get`, `invd documents get\|sections\|figure` |
| Full-text search of filings (100 credits) | `search_filings` | `invd search filings` |
| 13F holdings and changes | `get_holdings` | `invd holdings list\|changes` |
| Form 4 insider trades | `get_insider_trades` | `invd insider-trades list\|get` |
| Earnings-call calendar and history | `list_events` | `invd events list` |
| One event: transcript, Q&A, stats, comparison, press release, slides … | `get_event` | `invd events get\|transcript\|transcript-text\|qa\|stats\|comparison\|press-release\|slides\|price-attribution` |
| Search transcripts and investor documents | `search_transcripts` | `invd search transcripts`, `invd search investor-documents` |
| News items, text, announcements, news search | `get_news` | `invd news list\|get\|text\|announcements`, `invd search news` |
| Account and usage | `get_account` | `invd me show\|usage` |
| Webhooks | `manage_webhooks` | `invd webhooks …` |
| Any other operation | `search_endpoints` + `call_api` | `invd api GET /v1/…` |

MCP resources `invinite://catalog/metrics`, `invinite://catalog/sections`, `invinite://catalog/event-types`,
`invinite://catalog/forms` and `invinite://catalog/document-kinds` are the catalogs (`invd catalog metrics`, `invd catalog sections`, `invd catalog event-types`, `invd catalog forms`,
`invd catalog document-kinds`).
The server's prompts are `analyse_earnings_call`, `compare_companies` and `summarise_10k_risk_factors`.

Read the catalogs before interpreting metric or section keys: `invd catalog metrics` before statements, ratios, growth
or CAGR (values are keyed by `metric_id`), `invd catalog sections --form 10-K` before asking for a filing section.

## Prerequisites

### MCP

Connect `https://api.data.invinite.com/mcp` with OAuth and sign in to the Invinite Data account to be billed. Leave the
OAuth client ID and secret empty (Dynamic Client Registration and PKCE). `invd agent-setup` writes the connector for
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
- The first positional is the natural key: a ticker or CIK on company commands (several allowed:
  `invd financials AAPL MSFT`), the member id on member commands (`invd companies get AAPL`,
  `invd filings get 0000320193-26-000026`, `invd events transcript <event_id>`).
- Every command that takes an `event_id` also takes a company plus a fiscal period: `invd events transcript NVDA 2026Q3`
  resolves the event through `GET /v1/events` (one extra credit; the resolution is noted on stderr).
- Flags are the API parameters with dashes (`fiscal_year` → `--fiscal-year`, `filed_at[gte]` → `--filed-at-gte`).
  `invd <group> <action> --help` lists them with the API's descriptions, the credit cost and plan, and the row fields.
- `invd api` calls any path the tree lacks: `invd api GET /v1/filings?company=AAPL --paginate --jq '.data[].accession'`.

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
| `--save <file>` | save the file a response points to (transcript PDF, audio, news PDF, investor document); size and SHA-256 verified |

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

## Working with the data

### Financial statements

`invd financials <company…>` is one command over six operations:

- `--basis standardized` (default; values keyed by `metric_id`) or `--basis as-reported` (the company's own lines).
- `--view summary` (default), `detailed` (formula, accession and source lineage per value) or `presentation` (the
  statement tree).
- `-s, --statement` any of `income-statement`, `balance-sheet`, `cash-flow` (default all three).
- `-p, --period` `annual`, `quarterly`, `ytd` or `ttm`; without it: `quarterly` when `--fiscal-quarter` is 1–3, else
  `annual`.
- `--fiscal-year` / `--fiscal-quarter`, or a range with `--fiscal-year-gte` / `--fiscal-year-lte`.
- `--as-of 2025-01-31` = point in time (the newest rendering of each period filed by that day); `--filing <accession>`
  pins one filing's rendering.
- `--reported-only` and `--display-sign cash_flow_direction` exist on `--basis as-reported` only.
- Several companies plus one fiscal year (and quarter) is a cross-company snapshot.

```bash
invd catalog metrics --statement income-statement --json
invd financials AAPL -s income-statement --json
invd financials MSFT --period quarterly --limit 4 --json
invd financials AAPL MSFT GOOGL --fiscal-year 2025 --json
invd financials AAPL --basis as-reported -s cash-flow --view presentation --json
invd financials AAPL --as-of 2025-01-31 --fiscal-year-gte 2020 --json
```

### Metrics, segments and lineage

```bash
invd metrics ratios AAPL -p annual --category profitability,valuation --json
invd metrics growth MSFT -p quarterly --basis yoy --json
invd metrics cagr AAPL MSFT -p annual --horizon 5 --json
invd segments list AAPL -p annual --metric is_total_revenue --json
invd metrics explain "0000320193|is_total_revenue|annual|2026|4" --json
```

Ratio categories: `profitability`, `liquidity`, `leverage`, `efficiency`, `valuation`. `metrics explain` shows the rule
and operands behind one standardized fact and the source facts it came from; `documents fact-places --fact <fact_id>`
shows where a fact sits in the filing document (PRO).

### Filings and documents

```bash
invd filings AAPL --form 10-K --limit 1 --json
invd filings get 0000320193-26-000026 --expand documents --json
invd catalog sections --form 10-K --json
invd documents sections <version_id> --json
invd documents get <version_id> --blocks b12-b40 --json
invd search filings "supply chain risk" --company AAPL --form 10-K --item 1A --json
```

A filing's documents carry the `version_id` of each immutable document version. Read a section by listing the
version's sections (each names its `blocks`) and then fetching those blocks. Cite `version_id` + `block_id` and the
printed page label when present (else the page ordinal). `search filings` returns cited passages, no prose answer, at
100 credits a page; `--mode literal` matches exact characters (`FY2027`, `10b5-1`). `invd filers` covers every SEC
filer, including 13F managers and pre-IPO issuers without a listing.

### Earnings calls

```bash
invd events NVDA --sort -scheduled_at --limit 4 --json
invd events transcript-text NVDA 2026Q3 --split sections --json
invd events qa NVDA 2026Q3 --json
invd events comparison NVDA 2026Q3 --json
invd guidance NVDA --event <event_id> --json
invd search transcripts "gross margin outlook" --event <event_id> --json
```

- `events list` defaults to earnings calls; `--type all` adds investor days, conferences and AGMs; `--status upcoming|live|ended`.
- Take `event_id` from `events list` and pass it to the per-event commands, or give the company and fiscal period
  (`NVDA 2026Q3`) in its place.
- `transcript` returns turns with speaker and `start_ms` (`--layer cleaned`, `-v <version>`); `transcript-text` the
  plain text (`--split sections` separates prepared remarks and Q&A); `transcript-versions` / `transcript-diff` the
  published versions.
- Every `*_ms` field is milliseconds from the call's start: cite it as `[m:ss]`. `qa_start_ms` is where the Q&A begins.
- `comparison` is against the previous call by default (`--prior <event_id>` picks another): tone shift, hedging,
  uncertainty, new and dropped topics.
- `guidance list` items carry `direction`, period and `basis` (GAAP / non-GAAP); `--review approved` keeps only
  reviewed items. `guidance kpis` lists KPI mentions with their source sentence.
- `price-attribution` lines up minute price moves with what was said: temporal coincidence, never the cause.
- Investor documents (`invd investor-documents`, `search investor-documents`) are company-published: quote them as such,
  with title, year and page, never as verified fact.
- Slides, audio and price attribution need higher plans; a plan error exits 6 and names the plan.

### Ownership and insiders

```bash
invd holdings AAPL --json
invd holdings --filer 0000102909 --json
invd holdings changes AAPL --type new,sold_out --json
invd insider-trades AAPL --side buy --filed-at-gte 2026-01-01 --json
```

13F rows report positions at the quarter end (`--period-end`), filed up to 45 days later; keep filing date and
position date apart, and value apart from share count. Change types: `new`, `added`, `reduced`, `sold_out`,
`unchanged`. `--instruments all` adds options and principal amounts.

### News

```bash
invd news AAPL --published-at-gte 2026-11-01 --json
invd news get <id> --json
invd news text <id> --json
invd news announcements AAPL --topic product_launch --json
invd search news buyback --company AAPL --json
```

News comes from SEC EDGAR filings and the companies' own newsrooms, never wire services. Every item carries
`attribution` (publisher, `source_url`, `published_at`, and form + accession for a filing): whenever you show a
headline or summary, name the publisher, link `source_url` and give the date. Summaries and announcements are
Invinite's wording of the publication: present them as a summary of what the publisher stated, not as verified fact.
Report an announcement's status as stated (planned is a plan, not availability).

### Webhooks

```bash
invd webhooks create --body '{"url":"https://hooks.example.com/invinite","events":["event.transcript_ready"],"filters":{"ciks":["0000320193"]}}' --json
invd webhooks list --json
invd webhooks deliveries <id> --json
```

The signing secret is printed once on create (`rotate-secret` issues a new one). A delete asks first unless `--yes`.

## Commands Reference

One example per command. `invd <group> <action> --help` lists every flag; values like `evt_01JC8M2X` are the spec's
examples, replace them with real ids.

<!-- invd:commands:start -->
<!-- Generated by `pnpm skill:commands` from src/generated/cli-manifest.json and src/hand-written-commands.ts. Edit only inside an invd:hand block; `pnpm skill:commands:check` fails on drift. -->

### agent-setup

<!-- invd:hand:agent-setup -->
```bash
invd agent-setup --claude --local           # ./.mcp.json + the skill under .claude/
invd agent-setup --codex --global           # ~/.codex/config.toml [mcp_servers] + the skill
invd agent-setup --all --global --dry-run   # print what would be written
```
<!-- /invd:hand:agent-setup -->

### api

<!-- invd:hand:api -->
```bash
invd api /v1/companies/AAPL
invd api GET /v1/filings?company=AAPL --paginate --jq '.data[].accession'
invd api GET /v1/holdings -F company=AAPL -F limit=100 --dry-run
invd api POST /v1/webhooks --input webhook.json
```
<!-- /invd:hand:api -->

### auth

<!-- invd:hand:auth -->
```bash
invd auth login                  # browser sign-in (--no-browser over SSH)
invd auth status --json          # active key, its source and account (free)
invd auth token                  # print the key for scripts
invd auth logout
```
<!-- /invd:hand:auth -->

### catalog

Static catalogs: metrics, sections, forms, event types, document kinds, mapping rules

```bash
# List investor-document kinds (optional: --fields, --limit, --cursor, --all)
invd catalog document-kinds --json

# List event types (optional: --fields, --limit, --cursor, --all)
invd catalog event-types --json

# List SEC forms (optional: --fields, --limit, --cursor, --all)
invd catalog forms --json

# List standardized mapping rules (optional: --statement, --metric-id, --fields, --limit, --cursor, --all)
invd catalog mapping-rules --json

# List standardized metrics (optional: --statement, --fields, --limit, --cursor, --all)
invd catalog metrics --json

# List filing section ids (optional: --form, --fields, --limit, --cursor, --all)
invd catalog sections --json
```

### companies

Listed companies: list, profile, fiscal periods, dividends and splits

```bash
# List dividends (optional: --ex-date-gte, --ex-date-gt, --ex-date-lte, --ex-date-lt, --sort, --fields, --limit, --cursor, --all)
invd companies dividends AAPL --json

# List fiscal periods (optional: --sort, --fields, --limit, --cursor, --all)
invd companies fiscal-periods AAPL --json

# Get a company (optional: --expand, --fields)
invd companies get AAPL --json

# List listed companies (optional: --q, --exchange, --sector, --sort, --fields, --limit, --cursor, --all)
invd companies list -q apple --json

# List stock splits (optional: --sort, --fields, --limit, --cursor, --all)
invd companies splits AAPL --json
```

### completion

<!-- invd:hand:completion -->
```bash
eval "$(invd completion zsh)"
invd completion fish > ~/.config/fish/completions/invd.fish
```
<!-- /invd:hand:completion -->

### config

<!-- invd:hand:config -->
```bash
invd config list                                   # every setting and where it comes from
invd config set output json
invd config set base_url http://localhost:4000 --local   # ./.invd.toml
invd config unset pager
invd config path
```
<!-- /invd:hand:config -->

### documents

Immutable document versions, sections, figures and fact places

```bash
# List where facts appear in a document (optional: --document-version, --fact, --status, --limit, --cursor, --all)
invd documents fact-places -d dv_01JCA8XK --json

# Get a figure
invd documents figure dv_01JCA8XK --block-id b57 --json

# Get a document version (optional: --blocks, --pages, --printed, --neighbors, --footnotes)
invd documents get dv_01JCA8XK -p 1-3 --json

# List a document version's sections (optional: --outline, --limit, --cursor, --all)
invd documents sections dv_01JCA8XK --json
```

### events

Earnings calls and other corporate events: transcripts, Q&A, media and call analytics

```bash
# Get an event's recording (optional: --save)
invd events audio evt_01JC8M2X --json

# Compare an event with a prior one (optional: --prior)
invd events comparison evt_01JC8M2X --json

# Get an event (optional: --expand, --fields)
invd events get evt_01JC8M2X --json

# List events (optional: --type, --status, --scheduled-at-gte, --scheduled-at-gt, --scheduled-at-lte, --scheduled-at-lt, --fiscal-year, --fiscal-quarter, --date-kind, --expand, --sort, --fields, --limit, --cursor, --all)
invd events list AAPL --json

# Get an event's live audio URL
invd events live-audio evt_01JC8M2X --json

# Get an event's press release
invd events press-release evt_01JC8M2X --json

# Get an event's price attribution
invd events price-attribution evt_01JC8M2X --json

# Get an event's speech prosody (optional: --section)
invd events prosody evt_01JC8M2X --json

# List an event's Q&A pairs (optional: --include, --limit, --cursor, --all)
invd events qa evt_01JC8M2X --json

# Get an event's slides (optional: --pages, --include)
invd events slides evt_01JC8M2X --json

# Get an event's call statistics
invd events stats evt_01JC8M2X --json

# Get an event's transcript (optional: --version, --layer, --include, --save)
invd events transcript evt_01JC8M2X --json

# Diff two transcript versions
invd events transcript-diff evt_01JC8M2X -f 1 -t 2 --json

# Get an event's transcript as text (optional: --version, --split)
invd events transcript-text evt_01JC8M2X --json

# List an event's transcript versions (optional: --limit, --cursor, --all)
invd events transcript-versions evt_01JC8M2X --json
```

### filers

Every SEC filer (13F managers, pre-IPO issuers, former registrants), listed or not

```bash
# Get a filer (optional: --expand, --fields)
invd filers get 0000102909 --json

# List SEC filers (optional: --q, --form, --phase, --listed, --sort, --fields, --limit, --cursor, --all)
invd filers list -q berkshire --json
```

### filings

SEC filings, their facts, notes, review chains, full-text search and datasets

```bash
# List SEC dataset releases (optional: --fields, --limit, --cursor, --all)
invd filings datasets --json

# List a filing's numeric facts (optional: --tag, --fields, --limit, --cursor, --all)
invd filings facts 0000320193-26-000026 --json

# Get a filing (optional: --expand, --fields)
invd filings get 0000320193-26-000026 --json

# List filings (optional: --form, --items, --filed-at-gte, --filed-at-gt, --filed-at-lte, --filed-at-lt, --sort, --fields, --limit, --cursor, --all)
invd filings list AAPL --json

# List a filing's text facts (optional: --tag, --fields, --limit, --cursor, --all)
invd filings notes 0000320193-26-000026 --json

# Get a filing's review chain (optional: --max-depth, --max-nodes, --direction, --kind)
invd filings review-chain 0000320193-26-000026 --json
```

### financials

Statements: standardized and as-reported, plain, detailed and presentation, point in time

```bash
# Standardized statements [--basis as-reported|standardized, --view summary|detailed|presentation] (optional: --statement, --fiscal-year, --fiscal-quarter, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --as-of, --filing, --sort, --fields, --limit, --cursor, --all)
invd financials AAPL -s income-statement --view detailed --json
```

### fund-holdings

N-PORT fund holdings: the funds holding a company, or one fund's quarter-end portfolio

```bash
# List N-PORT fund holdings (optional: --filer, --series, --accession, --period-end, --sort, --fields, --limit, --cursor, --all)
invd fund-holdings list AAPL --json
```

### guidance

Guidance items and KPI mentions

```bash
# List KPI mentions (optional: --event, --metric, --sort, --fields, --limit, --cursor, --all)
invd guidance kpis AAPL --json

# List guidance items (optional: --event, --metric, --period-kind, --basis, --review, --sort, --fields, --limit, --cursor, --all)
invd guidance list AAPL --json
```

### holdings

13F holdings and quarter-over-quarter changes

```bash
# List 13F position changes (optional: --filer, --period-end, --prior-period-end, --type, --fields, --limit, --cursor, --all)
invd holdings changes AAPL --json

# List 13F holdings (optional: --filer, --accession, --period-end, --instruments, --sort, --fields, --limit, --cursor, --all)
invd holdings list AAPL --json
```

### insider-trades

Form 4 transactions

```bash
# Get an insider trade (optional: --fields)
invd insider-trades get 0001127602-26-012345:1 --json

# List insider trades (optional: --side, --filed-at-gte, --filed-at-gt, --filed-at-lte, --filed-at-lt, --transaction-date-gte, --transaction-date-lte, --is-derivative, --sort, --fields, --limit, --cursor, --all)
invd insider-trades list AAPL --json
```

### investor-documents

Company-published documents and their search

```bash
# Get an investor document (optional: --expand, --save)
invd investor-documents get doc_01JC7Q2M --json

# List investor documents (optional: --event, --category, --kind, --fiscal-year, --sort, --fields, --limit, --cursor, --all)
invd investor-documents list AAPL --json
```

### ipos

Offerings from registration to listing

```bash
# Get an offering (optional: --fields)
invd ipos get ipo_0001234567_s1_1 --json

# List offerings (optional: --stage, --is-spac, --listing-date-gte, --listing-date-gt, --listing-date-lte, --listing-date-lt, --company, --sort, --fields, --limit, --cursor, --all)
invd ipos list --json
```

### market

US market holidays

```bash
# List market holidays (optional: --date-gte, --date-gt, --date-lte, --date-lt, --sort, --fields, --limit, --cursor, --all)
invd market holidays --json
```

### me

The caller's account and usage (0 credits)

```bash
# Who am I
invd me show --json

# Get my usage (optional: --days)
invd me usage --json
```

### metrics

Ratios, growth, CAGR, and the explanation of one standardized fact

```bash
# List CAGRs (optional: --horizon, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd metrics cagr AAPL -p annual --json

# Explain a standardized fact (optional: --max-depth, --max-members)
invd metrics explain "0000320193|is_total_revenue|annual|2026|4" --json

# List growth rates (optional: --basis, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd metrics growth AAPL -p annual --json

# List ratios (optional: --category, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd metrics ratios AAPL -p annual --json
```

### news

News items, full text, search and announcements

```bash
# List announcements (optional: --topic, --item, --announced-at-gte, --announced-at-gt, --announced-at-lte, --announced-at-lt, --effective-from-gte, --effective-to-lte, --sort, --fields, --limit, --cursor, --all)
invd news announcements AAPL --json

# Get a news item (optional: --fields, --save)
invd news get nws_01JCB4R8 --json

# List news items (optional: --event, --kind, --topic, --published-at-gte, --published-at-gt, --published-at-lte, --published-at-lt, --sort, --fields, --limit, --cursor, --all)
invd news list AAPL --json

# Get a news item's text (optional: --cursor, --max-chars)
invd news text nws_01JCB4R8 --json
```

### offerings

Form D private offerings (Regulation D exemptions), amendments folded per offering

```bash
# Get a Form D private offering (optional: --fields)
invd offerings get 021-528681 --json

# List Form D private offerings (optional: --filed-at-gte, --filed-at-lte, --exemption, --industry, --total-sold-gte, --is-amendment, --sort, --fields, --limit, --cursor, --all)
invd offerings list 0001991882 --json
```

### people

Executives and analysts, and who took part in which event

```bash
# Get a person (optional: --fields)
invd people get per_01JC9A7Y --json

# List people (optional: --event, --role, --q, --sort, --fields, --limit, --cursor, --all)
invd people list AAPL -r analyst --json

# List event participations (optional: --event, --person, --role, --fields, --limit, --cursor, --all)
invd people participants -e evt_01JC8M2X --json
```

### plugin

<!-- invd:hand:plugin -->
```bash
invd plugin install --claude --global
invd plugin install --all --local
invd plugin uninstall --all --global
```
<!-- /invd:hand:plugin -->

### search

Full-text search over SEC filings, transcripts, investor documents and news

```bash
# Search filings (optional: --mode, --case-sensitive, --company, --form, --item, --filed-at-gte, --filed-at-gt, --filed-at-lte, --filed-at-lt, --limit, --cursor, --all)
invd search filings "supply chain risk" -c AAPL --json

# Search investor documents (optional: --company, --kind, --mode, --limit, --cursor, --all)
invd search investor-documents "capital allocation" -c AAPL --json

# Search news (optional: --company, --field, --mode, --published-at-gte, --published-at-gt, --published-at-lte, --published-at-lt, --limit, --cursor, --all)
invd search news buyback -c AAPL --json

# Search transcripts (optional: --company, --event, --type, --mode, --conference-date-gte, --conference-date-gt, --conference-date-lte, --conference-date-lt, --limit, --cursor, --all)
invd search transcripts "gross margin" -c AAPL --json
```

### segments

Segment values (revenue by product, geography …); list-detailed adds lineage (PRO)

```bash
# List segment values (optional: --metric, --axis, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd segments list AAPL -p annual --json

# List segment values with lineage (optional: --metric, --axis, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd segments list-detailed AAPL -p annual --json
```

### webhooks

Outbound event deliveries

```bash
# Create a webhook (optional: --idempotency-key, --url, --events, --ciks, --keywords, --body, --body-file)
invd webhooks create --body '{"url":"https://hooks.example.com/invinite","events":["event.transcript_ready","news.published"],"filters":{"ciks":["0000320193"]}}' --json

# Delete a webhook
invd webhooks delete k57a8x2b4c6d8e0f2g4h6j8k0m2n4p6r --json

# List a webhook's deliveries (optional: --limit, --cursor, --all)
invd webhooks deliveries k57a8x2b4c6d8e0f2g4h6j8k0m2n4p6r --json

# Get a webhook
invd webhooks get k57a8x2b4c6d8e0f2g4h6j8k0m2n4p6r --json

# List webhooks (optional: --limit, --cursor, --all)
invd webhooks list --json

# Rotate a webhook's secret
invd webhooks rotate-secret k57a8x2b4c6d8e0f2g4h6j8k0m2n4p6r --json

# Send a test delivery
invd webhooks test k57a8x2b4c6d8e0f2g4h6j8k0m2n4p6r --json

# Update a webhook (optional: --keywords, --ciks, --events, --active, --body, --body-file)
invd webhooks update k57a8x2b4c6d8e0f2g4h6j8k0m2n4p6r --body '{"events":["event.transcript_ready"],"active":true}' --json
```

<!-- invd:commands:end -->

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
invd holdings AAPL --limit 50 --json
invd holdings changes AAPL --type new,added --json
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
