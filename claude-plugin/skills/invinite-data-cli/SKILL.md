---
name: invinite-financial-data
description: Fetch financial data through the Invinite Data API MCP connector or the invd 8 CLI. Use whenever the user wants company information, what a ticker is (stock, ETF, closed-end fund, ETN), ETF and fund holdings and weights, financial statements (standardized or as-reported, point in time), ratios, growth, CAGR, segments, SEC filings and filing documents, earnings calls (calendar, transcripts, Q&A, guidance, KPIs, slides, press releases, call comparison), executives and analysts, who holds a stock or a fund (13F, N-PORT, ETF issuer files), insider trades, IPOs, market holidays, US macroeconomic data, CPI, GDP, payrolls, jobless claims, Treasury yields, company news and newsroom announcements, investor documents, or full-text search over filings, transcripts and news, including requests mentioning tickers, CIKs, accessions, balance sheets, income statements, cash flows, 10-K, 10-Q, 8-K, dividends, stock splits or institutional holders.
allowed-tools: Bash(invd *)
---

# Invinite Data API

Use the connected Invinite Data MCP tools when available; fall back to the `invd` CLI (11.3 or later for US macro data) when MCP
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
| Form 4 insider trades, Form 3/4/5 holdings, one insider across issuers | `get_insider_trades` | `invd insider-trades list\|get\|holdings`, `--owner <cik>` |
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
  `destinations`, `scripts`, `script-versions`). Standard adds `segments list`, `insider-trades` (incl. `holdings`), `search filings` and
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
- `--metrics` keeps only the listed metric ids (standardized) or XBRL concepts (as-reported) inside `facts`.
- `source.is_preliminary` marks a row taken from a preliminary source (an earnings release before the 10-Q / 10-K).
- Several companies plus one fiscal year (and quarter) is a cross-company snapshot.

```bash
invd catalog metrics --statement income-statement --json
invd financials AAPL -s income-statement --json
invd financials MSFT --period quarterly --limit 4 --json
invd financials AAPL MSFT GOOGL --fiscal-year 2025 --json
invd financials AAPL --basis as-reported -s cash-flow --view presentation --json
invd financials AAPL --as-of 2025-01-31 --fiscal-year-gte 2020 --json
invd financials AAPL -s income-statement --metrics is_total_revenue,is_net_income --json
```

### Metrics, segments and lineage

```bash
invd metrics ratios AAPL -p annual --category profitability,valuation --json
invd metrics growth MSFT -p quarterly --basis yoy --json
invd metrics cagr AAPL MSFT -p annual --horizon 5 --json
invd segments list AAPL -p annual --metric is_total_revenue --json
invd metrics explain "0000320193|is_total_revenue|annual|2026|4" --json
invd metrics vintages AAPL -c RevenueFromContractWithCustomerExcludingAssessedTax -e 2024-09-28 --json
```

Ratio categories: `profitability`, `liquidity`, `leverage`, `efficiency` (the turnover ratios), `valuation`. `metrics explain` shows the rule
and operands behind one standardized fact and the source facts it came from; `documents fact-places --fact <fact_id>`
shows where a fact sits in the filing document (PRO). `metrics vintages` lists every value filed for one XBRL concept
and period (`--period-start`, `--member` narrow it), one row per filing, with `is_current` on the value in force (PRO).

### Filings and documents

```bash
invd filings AAPL --form 10-K --limit 1 --json
invd filings get 0000320193-26-000026 --expand documents --json
invd catalog sections --form 10-K --json
invd documents sections <version_id> --json
invd documents get <version_id> --blocks b12-b40 --json
invd search filings "supply chain risk" --symbol AAPL --form 10-K --item 1A --json
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
- The call comparison, transcript diff and versions, prosody, price attribution, KPIs, slides and audio need Pro. A
  plan error exits 6 and names the plan.

### Instruments and funds

```bash
invd instruments get TQQQ --json
invd funds get SPY --json
invd funds holdings SPY --limit 10 --json
invd funds weights SPY --dimension sector --json
invd dividends SPY --json
```

A fund's holdings come from the freshest source, always named in `meta.source` / `meta.as_of` (and on stderr in table
output): the issuer's daily or monthly file, else the fund's latest N-PORT report (quarter end, about 60 days later).
State that source and date with the numbers. An ETF of `structure` `exchange_traded_trust` (GLD, IBIT) files no
holdings report: holdings and weights answer `not_covered` naming what is served for it.

### Ownership and insiders

```bash
invd holders AAPL --json
invd holders AAPL --source 13f --json
invd holders NVDA --source nport --json
invd holders changes AAPL --type new,sold_out --json
invd filers holdings 0000102909 --json
invd insider-trades AAPL --side buy --filed-at-gte 2026-01-01 --json
invd insider-trades holdings AAPL --json
invd insider-trades list --owner 0001214156 --json
```

`invd holders <symbol>` without `--source` is an overview: each source's top rows one after another, never summed
(`meta.sections` gives each source's state, as-of date and total). The sources overlap (a manager's 13F contains its
funds' N-PORT positions; an ETF's issuer file repeats its N-PORT report), so pick one `--source` for a full, paged list.
13F rows report positions at the quarter end (`--period-end`), filed up to 45 days later; keep filing date and
position date apart, and value apart from share count. Change types: `new`, `added`, `reduced`, `sold_out`,
`unchanged`. `--instruments all` adds options and principal amounts.

`insider-trades list` and `insider-trades holdings` take a company, or `--owner <cik>` (the `owner_cik` of a trade
row) for one insider's rows across every issuer; one of the two is required. Holdings are the positions stated on
Forms 3/4/5 (`as_of` = the reported date), not trades.

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

### Alerts

An alert is a rule (`type` + `condition` + `trigger`) that fires an event when it matches; events go to its
destinations (webhook endpoints) and always into the pull feed.

```bash
invd destinations create --url https://hooks.example.com/invinite-alerts --json
invd alerts create --body '{"type":"filing","condition":{"symbols":["AAPL"],"form_types":["8-K"]},"trigger":{"mode":"every_time"},"destination_ids":["<dst-id>"]}' --json
invd alerts test <alert-id> --json
invd alert-events tail
```

A destination's signing secret is printed once on create (`rotate-secret` issues a new one). Without a destination,
read the events with `invd alert-events list --after <event-id>` or follow them with `invd alert-events tail`. A
delete asks first unless `--yes`. `/alert-setup` walks through both steps.

### Hosted chartlang alerts

A `script` alert runs an uploaded chartlang script at each bar close of one instrument; an `indicator` alert runs a
built-in template (RSI, MACD signal, price / SMA, EMA cross) or a structured condition (`lhs` `comparator` `rhs`,
optional `filters`).

```bash
invd scripts upload ema-cross.chart --json                        # new script; --script <script-id> adds a version
invd script-versions list <script-id> --json
invd alerts create --body '{"type":"script","condition":{"symbol":"AAPL","interval":"5m","script_version_id":"<version-id>"},"trigger":{"mode":"every_time"}}' --json
invd alert-templates list --json
invd alerts create --body '{"type":"indicator","condition":{"symbol":"SPY","interval":"5m","template":{"key":"rsi-cross","inputs":{"level":30,"direction":"below"}}},"trigger":{"mode":"every_time"}}' --json
```

`invd scripts upload <file>` compiles server-side: it prints the version (`scv_…`, the alert's `script_version_id`),
its `alert_ids` (what `condition.alert_ids` may name) and each diagnostic as `file:line:column severity message`; a
compile error exits 1 (the version is stored with `status: error` and no alert can use it). Show the user the
diagnostics, fix the source, upload again with `--script <scr-id>`. Sources are ≤ 200 KB and may import only
`@invinite-org/chartlang-core`; a script keeps at most 20 versions, an alert keeps the version it was created with.
`interval` is bounded by the plan (LITE 1h, STANDARD 5m, PRO 1m; FREE has no alerts). While hosted scripts are
switched off the
routes answer 503 `unavailable`.

Chains and pre-close (Data API 6.4): a script's `input.externalSeries` inputs are bound per alert in
`condition.series_inputs`, keyed by the input's key in the script: `{"kind":"ohlc","field":"hl2"}`,
`{"kind":"builtin_indicator","indicator_id":"rsi","series_key":"rsi","params":{"length":14}}` or
`{"kind":"script_output","node_key":"n1","slot_id":"<plot slotId>"}`, the producer listed in `condition.nodes`
(`[{"node_key":"n1","script_version_id":"<scv-id>"}]`, at most 4 nodes; the slot ids are the producer version's
`manifest.plots[].slotId` from `invd script-versions list`). `condition.evaluation`
`{"kind":"pre_close","offset_minutes":15}` evaluates the forming bar 15 minutes before the US close and delivers only
then (`exchange`, e.g. `"NYSE"`, is required for crypto / commodities). Intervals `1w` / `1mo` and
`asset_class: "commodity"` (`XAUUSD`, `XAGUSD`) work for both types.

```bash
invd alerts create --body '{"type":"script","condition":{"symbol":"AAPL","interval":"1h","script_version_id":"<consumer-scv>","series_inputs":{"signal":{"kind":"script_output","node_key":"n1","slot_id":"<slot-id>"}},"nodes":[{"node_key":"n1","script_version_id":"<producer-scv>"}]}}' --json
invd alerts create --body '{"type":"indicator","condition":{"symbol":"SPY","interval":"1d","template":{"key":"rsi-cross"},"evaluation":{"kind":"pre_close","offset_minutes":15}}}' --json
```

### End users

When the user builds alerts for its own customers (B2B2C, white label), each customer is an `external_user_id` on
the alert and an **end user** of the account. Limits per end user: `max_active_alerts` (active + paused + scheduled),
`max_script_alerts` (the `script` / `indicator` ones among them), `max_fires_per_day` (UTC day). Effective limit = the
user's own value, else the account default (`invd me alert-user-defaults-update`), else none; the plan quota stays
the ceiling over all users. Map the user's own customer tiers with `invd alert-users batch` (≤ 500 upserts, one result
each).

```bash
invd me alert-user-defaults-update --max-active-alerts 10 --json
invd alert-users update user_8812 --max-active-alerts 50 --max-fires-per-day 20 --json
invd alerts create --validate-only --body '{"type":"filing","condition":{"symbols":["AAPL"],"form_types":["8-K"]},"external_user_id":"user_8812"}' --json
invd alert-users get user_8812 --json
```

- A create beyond a limit: `403 alert_user_limit_reached`; for a paused user: `403 alert_user_paused`; a lowered
  limit keeps existing alerts and refuses new ones.
- `--validate-only` runs every check of a create (body, plan, coverage, destinations, quotas, end user) and writes
  nothing: use it before promising a customer an alert.
- Beyond `max_fires_per_day` the fire stays in the feed with `delivery_skipped: "alert_user_fire_cap"`, is not
  delivered and sends one `alert_user.fire_cap_reached` event; deliveries resume at 00:00 UTC.
- `pause` stops every alert of the user and refuses creates until `resume`, which re-arms exactly what the pause
  paused.
- `delete` is an **erasure** (permanent: the user's alerts, events and deliveries; `deleting` = finished in the
  background). Confirm with the user before it; it asks unless `--yes`. A feed cursor naming an erased event answers
  `400`: restart from the last event you hold.

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

### alert-events

The fire log of your alerts: the pull feed (`tail` follows it live) and one event

```bash
# Get an alert event
invd alert-events get evt_01JD2Q6A1B2C3D4E5F6G7H8J9K --json

# List alert events (optional: --limit, --cursor, --alert-id, --type, --external-user-id, --after, --all)
invd alert-events list --json
```

<!-- invd:hand:alert-events tail -->
```bash
invd alert-events tail                                    # new events only, one JSON line each (polls every 2 s)
invd alert-events tail --after evt_01JD2Q6A1B2C3D4E5F6G7H8J9K --type alert.fired
```
<!-- /invd:hand:alert-events tail -->

### alert-templates

The indicator templates an `indicator` alert names (RSI, MACD, EMA cross …), with their inputs

```bash
# List indicator alert templates (optional: --limit, --cursor, --all)
invd alert-templates list --json
```

### alert-users

Create and update your alert end users, inspect their limits and usage, or pause and resume their alerts

```bash
# Create or update end users in bulk (optional: --body, --body-file)
invd alert-users batch --body '{"items":[{"external_user_id":"user_8812","max_active_alerts":50},{"external_user_id":"user_9001","max_active_alerts":10,"max_script_alerts":0}]}' --json

# Delete an end user
invd alert-users delete user_8812 --json

# Get an end user
invd alert-users get user_8812 --json

# List end users (optional: --limit, --cursor, --status, --q, --all)
invd alert-users list --json

# Pause an end user
invd alert-users pause user_8812 --json

# Resume an end user
invd alert-users resume user_8812 --json

# Create or update an end user (optional: --display-name, --max-active-alerts, --max-script-alerts, --max-fires-per-day, --body, --body-file)
invd alert-users update user_8812 --body '{"display_name":"Jane (premium)","max_active_alerts":50,"max_script_alerts":5}' --json
```

### alerts

Alert rules: create, change, pause, batch and test them, and read one alert's events

```bash
# Change alerts in bulk (optional: --body, --body-file)
invd alerts batch --body '{"items":[{"op":"upsert","client_reference_id":"watchlist-msft-div","type":"dividend","condition":{"symbols":["MSFT"],"kinds":["declared"]}},{"op":"pause","client_reference_id":"watchlist-aapl-8k"}]}' --json

# Create an alert (optional: --validate-only, --idempotency-key, --type, --ciks, --symbols, --cik, --symbol, --form-types, --form-categories, --include-amendments, --stage, --keywords, --match, --scope, --sources, --kinds, --earnings-only, --events, --speaker-roles, --min-mentions, --dividend-types, --statuses, --reason-codes, --report-kinds, --event, --days-before, --offsets-days, --minutes-before, --time-of-day-minutes, --timezone, --notify-on-date-change, --asset-class, --operator, --level, --direction, --pct, --baseline, --window-minutes, --condition-mode, --interval, --multiple, --threshold, --lookback-bars, --baseline-mode, --price-direction, --frequency, --at, --weekday, --days, --script-version-id, --alert-ids, --macro-events, --macro-families, --macro-series-ids, --trigger-mode, --cooldown-seconds, --cooldown-bars, --max-fires, --expires-at, --delete-on-expiry, --activate-at, --pause-until, --rearm, --rearm-distance-pct, --destination-ids, --client-reference-id, --external-user-id, --body, --body-file)
invd alerts create --body '{"type":"filing","condition":{"symbols":["AAPL"],"form_types":["8-K"],"stage":"detected"},"trigger":{"mode":"every_time"},"destination_ids":["dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G"],"client_reference_id":"watchlist-aapl-8k","external_user_id":"user_8812","metadata":{"list":"tech"}}' --json

# Delete an alert
invd alerts delete alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --json

# List an alert's events (optional: --limit, --cursor, --type, --all)
invd alerts events alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --json

# Get an alert
invd alerts get alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --json

# List alerts (optional: --limit, --cursor, --status, --type, --external-user-id, --client-reference-id, --symbol, --destination-id, --all)
invd alerts list --json

# Pause an alert
invd alerts pause alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --json

# Resume an alert
invd alerts resume alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --json

# Send a test event
invd alerts test alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --json

# Update an alert (optional: --version, --ciks, --symbols, --cik, --symbol, --form-types, --form-categories, --include-amendments, --stage, --keywords, --match, --scope, --sources, --kinds, --earnings-only, --events, --speaker-roles, --min-mentions, --dividend-types, --statuses, --reason-codes, --report-kinds, --event, --days-before, --offsets-days, --minutes-before, --time-of-day-minutes, --timezone, --notify-on-date-change, --asset-class, --operator, --level, --direction, --pct, --baseline, --window-minutes, --condition-mode, --interval, --multiple, --threshold, --lookback-bars, --baseline-mode, --price-direction, --frequency, --at, --weekday, --days, --script-version-id, --alert-ids, --macro-events, --macro-families, --macro-series-ids, --trigger-mode, --cooldown-seconds, --cooldown-bars, --max-fires, --expires-at, --delete-on-expiry, --activate-at, --pause-until, --rearm, --rearm-distance-pct, --destination-ids, --client-reference-id, --external-user-id, --body, --body-file)
invd alerts update alt_01JD2Q5Z8K3M7N9P4R6T1V0W2X --body '{"version":1,"condition":{"symbols":["AAPL","MSFT"],"form_types":["8-K"]}}' --json
```

### api

<!-- invd:hand:api -->
```bash
invd api /v1/companies/AAPL
invd api GET /v1/filings?symbol=AAPL --paginate --jq '.data[].accession'
invd api GET /v1/holders -F symbol=AAPL -F source=13f -F limit=100 --dry-run
invd api POST /v1/alerts --input alert.json
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

Static catalogs: metrics, sections, forms, event types, document kinds, mapping rules, exchanges, sectors

```bash
# List investor-document kinds (optional: --fields, --limit, --cursor, --all)
invd catalog document-kinds --json

# List event types (optional: --fields, --limit, --cursor, --all)
invd catalog event-types --json

# List exchanges (optional: --fields, --limit, --cursor, --all)
invd catalog exchanges --json

# List SEC forms (optional: --fields, --limit, --cursor, --all)
invd catalog forms --json

# List standardized mapping rules (optional: --statement, --metric-id, --fields, --limit, --cursor, --all)
invd catalog mapping-rules --json

# List standardized metrics (optional: --statement, --fields, --limit, --cursor, --all)
invd catalog metrics --json

# List filing section ids (optional: --form, --fields, --limit, --cursor, --all)
invd catalog sections --json

# List sectors (optional: --fields, --limit, --cursor, --all)
invd catalog sectors --json
```

### companies

Operating companies: list, profile and fiscal periods (a fund is `invd funds`)

```bash
# List fiscal periods (optional: --sort, --fields, --limit, --cursor, --all)
invd companies fiscal-periods AAPL --json

# Get a company (optional: --expand, --fields)
invd companies get AAPL --json

# List listed companies (optional: --q, --exchange, --sector, --sort, --fields, --limit, --cursor, --all)
invd companies list -q apple --json
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

### destinations

Webhook endpoints alert events are delivered to: secrets, test deliveries and the delivery log

```bash
# Create a destination (optional: --idempotency-key, --url, --kind, --description, --body-template, --preset, --max-events-per-minute, --digest-seconds, --body, --body-file)
invd destinations create --body '{"url":"https://hooks.example.com/invinite-alerts","description":"Production alert receiver"}' --json

# Delete a destination
invd destinations delete dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# List a destination's deliveries (optional: --limit, --cursor, --all)
invd destinations deliveries dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# Get a destination
invd destinations get dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# List destinations (optional: --limit, --cursor, --all)
invd destinations list --json

# Rotate a destination's secret
invd destinations rotate-secret dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# Send a test delivery
invd destinations test dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# Update a destination (optional: --url, --kind, --description, --body-template, --preset, --max-events-per-minute, --digest-seconds, --status, --body, --body-file)
invd destinations update dst_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --body '{"status":"active"}' --json
```

### dividends

Cash dividends of any instrument (a stock, an ETF, a closed-end fund, an ETN)

```bash
# List dividends (optional: --ex-date-gte, --ex-date-gt, --ex-date-lte, --ex-date-lt, --sort, --fields, --limit, --cursor, --all)
invd dividends list AAPL --json
```

### documents

Read an immutable SEC filing document, its sections and figures, or locate facts in the document

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

Every SEC filer (13F managers, pre-IPO issuers, former registrants), listed or not, and a 13F manager's portfolio and its changes

```bash
# Get a filer (optional: --expand, --fields)
invd filers get 0000102909 --json

# List a 13F manager's position changes (optional: --period-end, --prior-period-end, --type, --fields, --limit, --cursor, --all)
invd filers holding-changes 0002012383 -t new --json

# List a 13F manager's holdings (optional: --period-end, --instruments, --sort, --fields, --limit, --cursor, --all)
invd filers holdings 0002012383 --json

# List SEC filers (optional: --q, --form, --phase, --listed, --sort, --fields, --limit, --cursor, --all)
invd filers list -q berkshire --json
```

### filings

List and inspect SEC filings, read their facts, notes and holdings, follow review chains and browse dataset releases

```bash
# List SEC dataset releases (optional: --fields, --limit, --cursor, --all)
invd filings datasets --json

# List a filing's numeric facts (optional: --tag, --fields, --limit, --cursor, --all)
invd filings facts 0000320193-26-000026 --json

# Get a filing (optional: --expand, --fields)
invd filings get 0000320193-26-000026 --json

# List a holdings filing's lines (optional: --fields, --limit, --cursor, --all)
invd filings holdings 0002012383-26-003238 --json

# List filings (optional: --form, --items, --filed-at-gte, --filed-at-gt, --filed-at-lte, --filed-at-lt, --sort, --fields, --limit, --cursor, --all)
invd filings list AAPL --json

# List a filing's text facts (optional: --tag, --fields, --limit, --cursor, --all)
invd filings notes 0000320193-26-000026 --json

# Get a filing's review chain (optional: --max-depth, --max-nodes, --direction, --kind)
invd filings review-chain 0000320193-26-000026 --json
```

### financials

Read standardized and as-reported financial statements in plain, detailed or presentation form

```bash
# Standardized statements [--basis as-reported|standardized, --view summary|detailed|presentation] (optional: --statement, --fiscal-year, --fiscal-quarter, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --as-of, --filing, --sort, --metrics, --fields, --limit, --cursor, --all)
invd financials AAPL -s income-statement --view detailed --json
```

### funds

ETFs and closed-end funds: profiles, holdings and weights

```bash
# Get a fund (optional: --expand, --fields)
invd funds get TQQQ --json

# List a fund's holdings (optional: --as-of, --sort, --fields, --limit, --cursor, --all)
invd funds holdings SPY --json

# List funds (optional: --q, --type, --structure, --exchange, --sort, --fields, --limit, --cursor, --all)
invd funds list -q TQQ --json

# List a fund's sector, country and asset-class weights (optional: --dimension, --as-of, --fields, --limit, --cursor, --all)
invd funds weights SPY -d sector --json
```

### guidance

Guidance items and KPI mentions

```bash
# List KPI mentions (optional: --event, --metric, --sort, --fields, --limit, --cursor, --all)
invd guidance kpis AAPL --json

# List guidance items (optional: --event, --metric, --period-kind, --basis, --review, --sort, --fields, --limit, --cursor, --all)
invd guidance list AAPL --json
```

### holders

Who holds a stock or a fund: 13F managers, funds' N-PORT reports or ETF issuer files (--source), and 13F changes

```bash
# List 13F position changes in a stock or a fund (optional: --filer, --period-end, --prior-period-end, --type, --fields, --limit, --cursor, --all)
invd holders changes NVDA -t new --json

# List who holds a stock or a fund (optional: --source, --period-end, --instruments, --sort, --fields, --limit, --cursor, --all)
invd holders list NVDA -s 13f --json
```

### insider-trades

Form 4 transactions and Form 3/4/5 holdings, by company or by insider

```bash
# Get an insider trade (optional: --fields)
invd insider-trades get 0001127602-26-012345:1 --json

# List insider holdings (optional: --owner, --as-of-gte, --as-of-gt, --as-of-lte, --as-of-lt, --is-derivative, --sort, --fields, --limit, --cursor, --all)
invd insider-trades holdings AAPL --json

# List insider trades (optional: --owner, --side, --filed-at-gte, --filed-at-gt, --filed-at-lte, --filed-at-lt, --transaction-date-gte, --transaction-date-lte, --is-derivative, --sort, --fields, --limit, --cursor, --all)
invd insider-trades list AAPL --json
```

### instruments

Everything exchange-traded: stocks, funds and ETNs, one type each

```bash
# Get an instrument (optional: --fields)
invd instruments get TQQQ --json

# List instruments (optional: --q, --type, --structure, --exchange, --is-active, --sort, --fields, --limit, --cursor, --all)
invd instruments list -q TQQ --json
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

### macro

US inflation, output, income, labor and Treasury yields from official economic releases.

```bash
# List US GDP and income readings (optional: --reference-date-gte, --reference-date-gt, --reference-date-lte, --reference-date-lt, --sort, --fields, --limit, --cursor, --all)
invd macro gdp real_gdp_growth --json

# Get the US GDP and income snapshot (optional: --sort, --fields, --limit, --cursor, --all)
invd macro gdp-snapshot --json

# List US inflation readings (optional: --reference-date-gte, --reference-date-gt, --reference-date-lte, --reference-date-lt, --sort, --fields, --limit, --cursor, --all)
invd macro inflation cpi_all_sa --json

# Get the US inflation snapshot (optional: --sort, --fields, --limit, --cursor, --all)
invd macro inflation-snapshot --json

# List US labor readings (optional: --reference-date-gte, --reference-date-gt, --reference-date-lte, --reference-date-lt, --sort, --fields, --limit, --cursor, --all)
invd macro labor initial_claims_sa --json

# Get the US labor market snapshot (optional: --sort, --fields, --limit, --cursor, --all)
invd macro labor-snapshot --json

# List US macro series (optional: --family, --sort, --fields, --limit, --cursor, --all)
invd macro series --family inflation --json

# List US Treasury yield curves (optional: --date-gte, --date-gt, --date-lte, --date-lt, --sort, --fields, --limit, --cursor, --all)
invd macro yield-curve --json

# Get the latest US Treasury yield curve (optional: --fields)
invd macro yield-curve-snapshot --json
```

### market

US market holidays

```bash
# List market holidays (optional: --date-gte, --date-gt, --date-lte, --date-lt, --sort, --fields, --limit, --cursor, --all)
invd market holidays --json
```

### me

Inspect your account and usage, or read and update the defaults for your alert end users

```bash
# Get the end-user defaults
invd me alert-user-defaults-get --json

# Update the end-user defaults (optional: --max-active-alerts, --max-script-alerts, --max-fires-per-day, --body, --body-file)
invd me alert-user-defaults-update --body '{"max_active_alerts":10,"max_script_alerts":1}' --json

# Who am I
invd me show --json

# Get my usage (optional: --days)
invd me usage --json
```

### metrics

Ratios, growth, CAGR, the explanation of one standardized fact and the filed values (vintages) of one concept

```bash
# List CAGRs (optional: --horizon, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd metrics cagr AAPL -p annual --json

# Explain a standardized fact (optional: --max-depth, --max-members)
invd metrics explain "0000320193|is_total_revenue|annual|2026|4" --json

# List growth rates (optional: --basis, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd metrics growth AAPL -p annual --json

# List ratios (optional: --category, --fiscal-year-gte, --fiscal-year-gt, --fiscal-year-lte, --fiscal-year-lt, --sort, --fields, --limit, --cursor, --all)
invd metrics ratios AAPL -p annual --json

# List the filed values of a fact (optional: --period-start, --member, --fields, --limit, --cursor, --all)
invd metrics vintages AAPL -c RevenueFromContractWithCustomerExcludingAssessedTax -e 2024-09-28 --period-start 2023-10-01 --json
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

### script-versions

The versions of one hosted chartlang script: compile status, diagnostics and alert ids

```bash
# Upload a new script version (optional: --source, --body, --body-file)
invd script-versions create scr_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --body '{"source":"import { defineIndicator, input } from \"@invinite-org/chartlang-core\";\n\nexport default defineIndicator({\n    name: \"EMA cross\",\n    apiVersion: 1,\n    overlay: true,\n    inputs: { fast: input.int(9, { min: 1, max: 200 }), slow: input.int(21, { min: 2, max: 500 }) },\n    compute({ bar, ta, alert, inputs }) {\n        const fast = ta.ema(bar.close, inputs.fast);\n        const slow = ta.ema(bar.close, inputs.slow);\n        if (ta.crossover(fast, slow).current) alert(\"EMA cross up at \" + bar.close);\n    }\n});\n"}' --json

# List script versions (optional: --limit, --cursor, --all)
invd script-versions list scr_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json
```

### scripts

Hosted chartlang scripts for `script` alerts: upload (`upload` reads a .chart file), list, get, delete

```bash
# Upload a script (optional: --name, --description, --source, --body, --body-file)
invd scripts create --body '{"name":"EMA cross","description":"Fast EMA crossing above the slow one","source":"import { defineIndicator, input } from \"@invinite-org/chartlang-core\";\n\nexport default defineIndicator({\n    name: \"EMA cross\",\n    apiVersion: 1,\n    overlay: true,\n    inputs: { fast: input.int(9, { min: 1, max: 200 }), slow: input.int(21, { min: 2, max: 500 }) },\n    compute({ bar, ta, alert, inputs }) {\n        const fast = ta.ema(bar.close, inputs.fast);\n        const slow = ta.ema(bar.close, inputs.slow);\n        if (ta.crossover(fast, slow).current) alert(\"EMA cross up at \" + bar.close);\n    }\n});\n"}' --json

# Delete a script
invd scripts delete scr_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# Get a script
invd scripts get scr_01JD2Q4X7Y8Z9A0B1C2D3E4F5G --json

# List scripts (optional: --limit, --cursor, --all)
invd scripts list --json
```

<!-- invd:hand:scripts upload -->
```bash
invd scripts upload ema-cross.chart                               # new script (name = file name); diagnostics, exit 1 on a compile error
invd scripts upload ema-cross.chart --script scr_01JD2Q4X7Y8Z9A0B1C2D3E4F5G   # the next version of that script
```
<!-- /invd:hand:scripts upload -->

### search

Full-text search over SEC filings, transcripts, investor documents and news

```bash
# Search filings (optional: --mode, --case-sensitive, --symbol, --form, --item, --filed-at-gte, --filed-at-gt, --filed-at-lte, --filed-at-lt, --limit, --cursor, --all)
invd search filings "supply chain risk" -s AAPL --json

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

### splits

Stock splits of any instrument (a stock, an ETF, a closed-end fund, an ETN)

```bash
# List stock splits (optional: --sort, --fields, --limit, --cursor, --all)
invd splits list AAPL --json
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
