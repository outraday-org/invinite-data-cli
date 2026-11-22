# @invinite-org/invinite-data-cli

`invd` is the command-line interface for the [Invinite Data API](https://invinite.com/docs/data-api/overview) (v2):
every exchange-traded US instrument (stocks, ETFs, closed-end funds, ETNs) with its type and the data served for it,
operating companies and every SEC filer, standardized and as-reported financial statements, ratios, growth and CAGR,
segments, SEC filings and immutable document versions, earnings calls (transcripts, Q&A, guidance, slides, audio),
fund holdings and weights, who holds a stock or a fund (13F, N-PORT, ETF issuer files), insider trades, IPOs and
Form D offerings, news and full-text search — from your terminal, a script or an AI agent.

```bash
invd instruments get TQQQ
invd financials AAPL --period quarterly --limit 4
invd filings AAPL --form 10-K
invd events transcript AAPL 2026Q3
invd funds holdings SPY
invd holders NVDA --source 13f
invd search filings "supply chain risk" --symbol AAPL
```

Version 6.0 keeps the 5.0 commands and follows the conventions shared with the Web CLI `inv`: one exit-code table
(not found 3, partial 7, interrupted 130 / 143), a three-line error with the API's remedy, and the config file in
`~/.config/invinite/invd.toml`. Version 7.0 replaces webhooks with alerts
([Upgrading from 6.x](#upgrading-from-6x)). Version 8.0 follows Data API 7.0: instruments, funds and one holders
command ([Changes in 8.0](#changes-in-80)). Coming from 5.x, read [Upgrading from 5.x](#upgrading-from-5x); from 4.x,
[Upgrading from 4.x](#upgrading-from-4x); from 3.x, [Upgrading from 3.x](#upgrading-from-3x).

## Installation

```bash
npm install -g @invinite-org/invinite-data-cli
```

Update with `npm update -g @invinite-org/invinite-data-cli`. Requires Node.js >= 20. invd prints a short notice at
most once a day when a newer version exists (never in CI; `INVD_NO_UPDATE_NOTIFIER=1` turns it off).

From source:

```bash
git clone https://github.com/outraday-org/invinite-data-cli.git
cd invinite-data-cli
pnpm install
pnpm build
npm link
```

## Authentication

```bash
invd auth login                    # browser sign-in; stores a revocable key
invd auth login --no-browser       # SSH session: print the URL, paste the redirect address back
cat key.txt | invd auth login --with-token   # an existing key from stdin
invd auth status                   # which key is active, where it comes from, whose account (free)
invd auth status --offline --json  # the same without calling the API
invd auth token                    # print the active key (for curl and scripts)
invd auth logout                   # revoke the login and clear the stored key
```

The key belongs to the Invinite Data account you sign in with, and every call made with it is billed to that account.
Create or revoke keys at https://data.invinite.com/keys.

The active key is resolved in this order:

1. `INVD_API_KEY`
2. `INVINITE_DATA_API_KEY` (the 3.x name, still read)
3. `./.env` in the current directory (either name)
4. the OS keychain (via the optional `keytar` package)
5. `api_key` in the global `invd.toml`

```bash
curl -H "Authorization: Bearer $(invd auth token)" https://api.data.invinite.com/v1/me
```

## The command grammar

Commands are noun-verb over the API's groups:

| Group | What it reads |
|---|---|
| `instruments` | everything exchange-traded: stocks, ETFs, closed-end funds and ETNs; `get` prints the `type`, a fund's `structure` and the `datasets` served for it first |
| `companies` | operating companies: list, profile, fiscal periods (a fund is `invd funds`) |
| `funds` | ETFs and closed-end funds: list, profile, holdings (the freshest composition, the header names its source and as-of date), sector / country / asset-class weights |
| `dividends`, `splits` | dividends and splits of any instrument (a stock, a fund, an ETN) |
| `filers` | every SEC filer (13F managers, pre-IPO issuers, former registrants), listed or not; a 13F manager's portfolio (`filers holdings`) and its changes (`filers holding-changes`) |
| `financials` | statements: standardized or as-reported, summary / detailed / presentation, point in time |
| `metrics` | ratios, growth, CAGR, and the explanation of one standardized fact |
| `segments` | segment values (revenue by product, geography …) |
| `filings` | SEC filings, their numeric and text facts, review chains, dataset releases |
| `documents` | immutable document versions: blocks, pages, sections, figures, fact places |
| `events` | earnings calls and other corporate events: transcripts, Q&A, slides, audio, call analytics |
| `guidance` | guidance items and KPI mentions |
| `people` | executives and analysts, and who took part in which event |
| `holders` | who holds ONE stock or fund: `--source 13f` (13F managers), `nport` (funds' N-PORT reports), `issuer_file` (ETF issuer files), or without `--source` an overview of all three; `holders changes` = 13F quarter-over-quarter changes |
| `insider-trades` | Form 4 transactions (trade date, owner CIK, derivative and 10b5-1 flags where the SEC Form 3/4/5 dataset has them) |
| `investor-documents` | company-published documents (annual reports, decks, letters) |
| `news` | news from SEC filings and the companies' own newsrooms, with attribution |
| `search` | full-text search over filings, transcripts, investor documents and news |
| `ipos`, `offerings`, `market` | offerings from registration to listing; Form D private offerings; US market holidays |
| `catalog` | static catalogs: metrics, sections, forms, event types, document kinds, mapping rules |
| `me` | your account and usage (free) |
| `alerts`, `destinations`, `alert-events` | alert rules (filings, news, halts, dividends, earnings calls and results, metrics, countdowns …), the webhook endpoints their events are delivered to, and the event log (pull feed; `invd alert-events tail` follows it) |
| `scripts`, `script-versions`, `alert-templates` | hosted chartlang scripts for `script` alerts (`invd scripts upload` reads a file) and their versions; the built-in templates of `indicator` alerts |
| `alert-users` | your own end users on the alerts platform (B2B2C): per-user limits and usage, pause / resume, erasure; the account defaults are `invd me alert-user-defaults-get\|alert-user-defaults-update` |

Plus the hand-written `api`, `auth`, `config`, `plugin`, `agent-setup`, `completion`, `alert-events tail` and `scripts upload`.

**The first positional is the natural key.** On company lists it is a ticker or CIK, and several are allowed; on the
symbol commands (`filings`, `dividends`, `splits`, `search filings --symbol`) any instrument's ticker; `invd holders`
takes ONE symbol. `invd instruments get <symbol>` says what a ticker is and what is served for it:

```bash
invd financials AAPL MSFT GOOGL --fiscal-year 2025
invd filings 0000320193 --form 8-K --items 2.02
invd insider-trades AAPL --side buy
```

On a member command it is the member's id:

```bash
invd companies get AAPL
invd filings get 0000320193-26-000026
invd filers get 0000102909
invd events transcript <event_id>
```

**`list` is a group's default subcommand**, so `invd filings AAPL --form 10-K` is `invd filings list AAPL --form 10-K`,
and `invd events AAPL` lists Apple's calls.

**Events by fiscal period.** Every command that takes an `event_id` also takes a company and a fiscal period in its
place; invd resolves the event through `GET /v1/events` and says so on stderr:

```bash
invd events transcript NVDA 2026Q3
invd events qa AAPL 2026Q4
invd events press-release MSFT 2026Q1
```

`invd <group> --help` lists a group's actions; `invd <group> <action> --help` lists every flag with the API's own
description, the credit cost and plan, and the fields of each row.

Plans (Data API 9.0): `companies` (with `companies fiscal-periods`), `instruments`, `catalog`, `market holidays`,
`events list` / `get` and `me` reach every plan; standardized `financials`, `dividends`, `splits`, `news`, `funds` and
the alerts commands (`alerts`, `alert-events`, `alert-templates`, `alert-users`, `destinations`, `scripts`,
`script-versions`) need Lite; the call comparison, transcript diff and versions, prosody, price attribution, `guidance
kpis` and holder changes need Pro (as does the WebSocket stream); `filings datasets` needs Enterprise; the rest needs
Standard or above (`--help` names it). A refused plan exits 6 and the error names the plan.

## Examples

### Companies and filers

```bash
invd companies list -q apple
invd companies get AAPL --expand coverage
invd companies fiscal-periods AAPL
invd dividends AAPL --ex-date-gte 2024-01-01
invd splits AAPL
invd filers list -q berkshire
invd filers get 0000102909
```

### Instruments and funds

```bash
invd instruments get TQQQ                           # type, structure and datasets first
invd instruments list -q ultra -t etf -e XNAS       # ETFs on Nasdaq whose name or ticker matches
invd funds list --type etf
invd funds get SPY                                  # net assets, expense ratio, advisers, share classes
invd funds holdings SPY                             # the freshest composition (header: source · as of)
invd funds holdings SPY --as-of 2026-11-10          # the composition stored on or before a day
invd funds weights SPY --dimension sector           # sector weights (country, asset_class; a comma list)
invd dividends TQQQ
invd filings SPY --form N-CSR
```

An ETF that is an exchange-traded trust (GLD, IBIT: `structure` `exchange_traded_trust`) files no holdings report:
`invd funds holdings GLD` answers one `not_covered` error that names what is served for it.

### Financial statements

`invd financials` is one command over the six statement operations:

| Flag | Values |
|---|---|
| `--basis` | `standardized` (default) or `as-reported` |
| `--view` | `summary` (default), `detailed` (formula and source lineage) or `presentation` (the statement tree) |
| `-s, --statement` | any of `income-statement`, `balance-sheet`, `cash-flow` (default all three) |
| `-p, --period` | `annual`, `quarterly`, `ytd`, `ttm`; absent: `quarterly` with `--fiscal-quarter` 1–3, else `annual` |
| `-y, --fiscal-year`, `-q, --fiscal-quarter` | one fiscal period |
| `--fiscal-year-gte` / `-gt` / `-lte` / `-lt` | a range of fiscal years |
| `--as-of` | point in time: the newest rendering of each period filed on or before that day |
| `--filing` | pin the rendering of one filing (accession) |
| `--reported-only`, `--display-sign` | as-reported only |

```bash
invd financials AAPL                                         # annual, all three statements
invd financials AAPL --period quarterly --limit 4
invd financials AAPL -s income-statement --view detailed --json
invd financials AAPL --basis as-reported --view presentation -s balance-sheet
invd financials AAPL --as-of 2025-01-31 --fiscal-year-gte 2020
invd financials AAPL --filing 0000320193-25-000079
invd financials AAPL MSFT GOOGL --fiscal-year 2025           # several companies, one period: a snapshot
invd financials AAPL --basis as-reported --reported-only --display-sign cash_flow_direction -s cash-flow
```

Standardized values are keyed by `metric_id`; `invd catalog metrics` lists them.

### Metrics and segments

```bash
invd catalog metrics --statement income-statement
invd metrics ratios AAPL -p annual --category profitability,valuation
invd metrics growth MSFT -p quarterly --basis yoy
invd metrics cagr AAPL MSFT -p annual --horizon 5
invd metrics explain "0000320193|is_total_revenue|annual|2026|4"
invd segments list AAPL -p annual --metric is_total_revenue
invd segments list-detailed AAPL -p annual
```

### SEC filings and documents

```bash
invd filings AAPL --form 10-K --limit 1
invd filings get 0000320193-26-000026 --expand documents
invd filings facts 0000320193-26-000026 --tag us-gaap:Revenues
invd filings notes 0000320193-26-000026
invd filings review-chain 0000320193-26-000026
invd catalog sections --form 10-K
invd documents sections <version_id>
invd documents get <version_id> --blocks b12-b40 --footnotes
invd documents get <version_id> --pages 1-3
invd documents figure <version_id> --block-id b57
invd search filings "supply chain risk" --symbol AAPL --form 10-K --item 1A
```

A filing's `documents` carry the `version_id` of each immutable document version; cite a passage by `version_id` and
`block_id` (and the printed page label when present). `search filings` costs 100 credits a page.

### Earnings calls and events

```bash
invd events AAPL                                    # calendar and history (earnings calls by default)
invd events AAPL --status upcoming
invd events list AAPL --type all --sort -scheduled_at --limit 10
invd events get AAPL 2026Q4                         # + the 8-K (results_filing) and 10-K (periodic_report) accessions; --json: both objects
invd events transcript AAPL 2026Q3                  # turns with speaker and start_ms
invd events transcript-text AAPL 2026Q3 --split sections
invd events qa AAPL 2026Q3
invd events comparison AAPL 2026Q3                  # vs the previous call: tone, hedging, new and dropped topics
invd events stats AAPL 2026Q3
invd events press-release AAPL 2026Q3
invd events slides AAPL 2026Q3 --pages 1-5
invd events price-attribution AAPL 2026Q3
invd events transcript-versions <event_id>
invd events transcript-diff <event_id> --from 1 --to 2
invd guidance AAPL --event <event_id>
invd guidance kpis AAPL --metric subscribers
invd people list AAPL --role analyst
invd people get <person_id>                          # + image_url (a photo or the company / firm logo; empty = show initials)
invd people list AAPL --fields name,image_url,image_kind --json
invd search transcripts "gross margin" --company AAPL --type qa
```

Every `*_ms` field is milliseconds from the call's start; cite it as `[m:ss]`.

### Ownership and insiders

```bash
invd holders NVDA                                   # overview: each source's top holders, total and as-of date
invd holders NVDA --source 13f                      # 13F managers (quarter end), paged
invd holders AAPL --source 13f --period-end 2026-06-30 --instruments all
invd holders NVDA --source nport                    # funds holding it (each fund's latest N-PORT report)
invd holders NVDA --source issuer_file              # ETFs whose own holdings file holds it
invd holders SPY --source 13f                       # who holds a fund
invd holders changes AAPL --type new,sold_out       # 13F changes quarter over quarter
invd filers holdings 0000102909                     # one 13F manager's portfolio
invd filers holding-changes 0000102909
invd filings holdings 0001067983-26-000004          # one 13F-HR or NPORT-P filing's lines as filed
invd insider-trades AAPL --filed-at-gte 2026-01-01
invd insider-trades NVDA --transaction-date-gte 2026-10-01 --is-derivative false
invd insider-trades get 0001127602-26-012345:1
```

### News, investor documents, IPOs, market

```bash
invd news AAPL --published-at-gte 2026-11-01
invd news get <id>
invd news text <id>
invd news announcements AAPL --topic product_launch
invd search news buyback --company AAPL
invd investor-documents AAPL --kind investor_presentation
invd search investor-documents "capital allocation" --company AAPL
invd ipos list --stage priced
invd offerings 0001318605                           # Form D private offerings of an issuer
invd offerings get 021-528681                       # one offering (its Form D file number)
invd filers get 0000036405 --expand fund,private_offerings
invd market holidays --date-gte 2026-01-01
```

Every news item carries `attribution` (publisher, `source_url`, `published_at`, and the form and accession of a
filing): name the publisher and link the source whenever you show a headline or summary.

### Account and alerts

```bash
invd me show
invd me usage --days 7
invd destinations create --url https://hooks.example.com/invinite-alerts
invd alerts create --body '{"type":"filing","condition":{"symbols":["AAPL"],"form_types":["8-K"]},"trigger":{"mode":"every_time"},"destination_ids":["<dst-id>"]}'
invd alerts list
invd alerts test <alert-id>
invd destinations deliveries <dst-id>
invd alert-events tail
```

An alert fires an event into the pull feed (`invd alert-events list --after <event-id>`) and to its destinations. A
destination's signing secret is printed once on create (`invd destinations rotate-secret` issues a new one).
`invd alert-events tail` polls the feed every 2 s (one metered request each, `--interval` changes it) and prints each
new event as one JSON line; Ctrl-C prints the `--after` that resumes.

End users (Data API 6.5): alerts you create for your own customers name them in `--external-user-id`; each id is an
end user with its own limits (unset = the account default, else none).

```bash
invd me alert-user-defaults-update --max-active-alerts 10          # every end user without its own value
invd alert-users update user_8812 --max-active-alerts 50 --max-fires-per-day 20
invd alert-users batch --body-file tiers.json                       # ≤ 500 upserts: map your own plans to limits
invd alerts create --validate-only --body '{"type":"filing","condition":{"symbols":["AAPL"],"form_types":["8-K"]},"external_user_id":"user_8812"}'
invd alert-users list
invd alert-users pause user_8812                                    # no fires, no creates; resume re-arms
invd alert-users resume user_8812
invd alert-users delete user_8812                                   # erasure: alerts, events, deliveries (asks unless --yes)
```

A create beyond a limit answers `403 alert_user_limit_reached`, a create for a paused user `403 alert_user_paused`.
`--validate-only` runs every check of a create and writes nothing (`204`, exit 0). Beyond `max_fires_per_day` a fire
stays in the feed with `delivery_skipped: "alert_user_fire_cap"` and one `alert_user.fire_cap_reached` event goes out.

### Hosted chartlang alerts

Since 7.3 (Data API 6.3) an alert can run chartlang at each bar close of one instrument: a `script` alert runs a
script you upload, an `indicator` alert a built-in template or a structured condition.

```bash
invd scripts upload ema-cross.chart                               # new script, version 1; prints status + diagnostics
invd scripts upload ema-cross.chart --script <script-id>          # the next version of that script
invd scripts list
invd script-versions list <script-id>
invd alerts create --body '{"type":"script","condition":{"symbol":"AAPL","interval":"5m","script_version_id":"<version-id>"},"trigger":{"mode":"every_time"}}'
invd alert-templates list
invd alerts create --body '{"type":"indicator","condition":{"symbol":"SPY","interval":"5m","template":{"key":"rsi-cross","inputs":{"level":30,"direction":"below"}}},"trigger":{"mode":"every_time"}}'
```

`invd scripts upload <file>` sends the file (≤ 200 KB; the only import allowed is `@invinite-org/chartlang-core`) to
`POST /v1/scripts` (`--name`, default the file name; `--description`) or, with `--script <scr-id>`, to
`POST /v1/scripts/{id}/versions`. The API compiles it; the command prints the script id, the version id (`scv_…`, the
`script_version_id` of a `script` alert) and its alert ids (what `condition.alert_ids` may name, empty = all), then
one `file:line:column severity message` line per diagnostic. A compile error is still stored as a version but exits 1;
`--json` prints the API's answer. A script holds at most 20 versions and an existing alert keeps its version. A
`script` alert takes the script's `inputs` and a `frequency` (`once_per_bar_close` default); an `indicator` alert
takes a `template` (`key` + `inputs` from `invd alert-templates list`) or a structured `condition` (`lhs`,
`comparator`, `rhs`) with optional `filters`. Both watch `symbol` (+ `asset_class` for crypto) at `interval` (the
plan's shortest: LITE 1h, STANDARD 5m, PRO 1m; FREE has no alerts).

## Output

Data goes to stdout; progress, cost lines, confirmations and coverage notes go to stderr, so a pipe only ever sees
data.

| Flag | Effect |
|---|---|
| (none) | a table on a terminal, tab-separated rows when piped |
| `--plain` | tab-separated rows without colour or decoration |
| `--json` | the whole response body |
| `--json a,b` | only those fields of each row (the fields are listed at the bottom of each command's `--help`) |
| `--output table\|plain\|json\|jsonl\|csv` | pick the format explicitly |
| `--jq <expr>` | filter the JSON (a built-in subset; falls back to a `jq` binary on the PATH) |
| `--fields a,b` | ask the server to prune the response (where the operation supports `fields=`) |

```bash
invd filings AAPL --form 10-K --json accession,filing_date
invd financials AAPL --jq '.data[0].period_end'
invd companies list -q bank --output csv > banks.csv
invd events AAPL --plain | cut -f1
```

`NO_COLOR` / `FORCE_COLOR` control colour; `INVD_PAGER` (then `PAGER`) pages long output on a terminal. When a response's
`meta.coverage` is `pending` or `partial`, invd prints a note on stderr: few or no rows are then not proof of absence.

### Pagination

Lists are cursor-paged. `--limit` sets the page size; `--cursor` takes the previous page's `next_cursor` (reuse it with
the same filters, or the API answers `cursor_mismatch`). `--all` walks every page and streams the rows as JSONL (CSV with
`--output csv`):

```bash
invd filings AAPL --all > aapl-filings.jsonl
invd holders AAPL --source 13f --all --output csv > aapl-holders.csv
invd filings AAPL --cursor eyJ2IjoyfQ
```

An `--all` cut short by a failure after some rows exits 7 and prints the `--cursor` to resume from; Ctrl-C prints the
same resume line and exits 130.

### Credits

```bash
invd filings AAPL --all --dry-run        # the request plan and credit estimate; sends nothing
invd search filings "going concern" --show-cost
invd me usage                            # plan, included credits left, spend by family and key (free)
```

`--dry-run` prints the request(s) and the estimate from the spec's `x-credits` without sending anything.
`--show-cost` (or `INVD_SHOW_COST=1`) prints the credits a command cost to stderr. An `--all` walk whose page costs at
least `confirm_credits` (default 10) and every delete ask before running; `--yes` skips the question and `--no-input`
fails instead of asking.

### Files

Commands whose response points to a file take `--save <file>` (`--force` replaces an existing file). The download's
size and SHA-256 are verified before it lands; a mismatch exits 5.

```bash
invd events transcript AAPL 2026Q3 --save aapl-q3.pdf
invd events audio AAPL 2026Q3 --save aapl-q3.m4a
invd news get <id> --save item.pdf
invd investor-documents get <document_id> --save report.pdf
```

## `invd api`: any API path

The escape hatch for anything the command tree lacks:

```bash
invd api /v1/companies/AAPL
invd api GET /v1/filings?symbol=AAPL --paginate --jq '.data[].accession'
invd api GET /v1/holders -F symbol=AAPL -F source=13f -F limit=100
invd api POST /v1/alerts --input alert.json
invd api DELETE /v1/alerts/<id> --yes
invd api GET /v1/me -H 'Accept: application/json' --dry-run
```

`-F key=value` is typed (numbers, `true` / `false`, `null`, `@file`), `-f key=value` always a string; both are query
parameters on GET / DELETE and JSON body fields otherwise. `--paginate` follows `next_cursor`.

## Configuration

```bash
invd config list                     # every setting, its value and where it comes from
invd config get output
invd config set output json
invd config set base_url http://localhost:4000 --local
invd config set confirm_credits 50
invd config unset pager
invd config path
```

| Setting | Env | Meaning |
|---|---|---|
| `base_url` | `INVD_BASE_URL` | API base URL |
| `output` | `INVD_OUTPUT` | default output format |
| `confirm_credits` | `INVD_CONFIRM_CREDITS` | page cost at which an `--all` walk asks first (default 10) |
| `pager` | `INVD_PAGER` | pager for long terminal output |
| `api_key` | `INVD_API_KEY` | the key (global file only; prefer `invd auth login`) |

The global file is `$XDG_CONFIG_HOME/invinite/invd.toml` (`~/.config/invinite/invd.toml`; `%APPDATA%\invinite` on
Windows; `INVD_CONFIG_DIR` replaces the directory). The directory is shared with the Web CLI `inv` (`config.json`); invd
touches only `invd.toml` there, and keys are never shared. `--local` writes `./.invd.toml` for this project.
Precedence: flags > environment > `./.invd.toml` > `invd.toml`. A project file
never holds `api_key`, and its `base_url` may only name a loopback host (`localhost`, `127.0.0.1`, `[::1]`): a cloned
repository cannot send your key elsewhere. `invd api` likewise refuses an absolute URL on another host. The settings of
an older install (`~/.config/invd/config.toml` of 4.x / 5.x, else the 3.x file) are carried into `invd.toml` once,
with one line on stderr; the old file is left in place.

## AI agents

### One step: MCP connector plus skill

```bash
invd agent-setup --claude --local          # ./.mcp.json + .claude/skills
invd agent-setup --codex --global          # ~/.codex/config.toml [mcp_servers] + skill
invd agent-setup --all --global --dry-run  # show what would be written
```

`agent-setup` adds the Invinite MCP connector (`https://api.data.invinite.com/mcp`) to Claude Code (`.mcp.json` or
`~/.claude.json`) or Codex (`config.toml [mcp_servers.<name>]`) and installs the `invd` skill. The connector signs in
with OAuth on first use (Dynamic Client Registration and PKCE; no key is written). MCP calls are billed to the account
of the OAuth sign-in, CLI calls to the account of the key.

### The plugin

```bash
invd plugin install                      # interactive: runtime and scope
invd plugin install --claude --global
invd plugin install --codex --global
invd plugin install --opencode --local
invd plugin install --copilot --local
invd plugin install --all --global
invd plugin uninstall --all --global
```

Re-run the install to update. The plugin bundles the skill, the data agent and the research commands:

| Runtime | Skill | Agent | Commands |
|---|---|---|---|
| Claude Code | `skills/invinite-data-cli/SKILL.md` | `agents/invinite-data.md` | `commands/financial-research.md`, `commands/analyze-earnings-call.md` |
| OpenCode | `command/invinite-data-cli.md` | `agents/invinite-data.md` | `command/analyze-earnings-call.md` |
| Codex | `skills/invinite-data-cli/SKILL.md` | — | `skills/invinite-financial-research/SKILL.md`, `skills/invinite-analyze-earnings-call/SKILL.md` |
| Copilot | `skills/invinite-data-cli/SKILL.md` | — | `skills/invinite-financial-research/SKILL.md`, `skills/invinite-analyze-earnings-call/SKILL.md` |

`claude-plugin/` is the single source of these files; the copies under `.claude/` and `.codex/` are symlinks into it.
The Claude plugin directory (`claude --plugin-dir /path/to/invinite-data-cli/claude-plugin`) also carries
`compare-companies`, `analyze-filing` and `ownership-review`, and its `.mcp.json` connects the MCP server.

```
/financial-research Compare Apple, Microsoft and Google's profitability and growth over the last 3 years
/analyze-earnings-call NVDA
/analyze-earnings-call AAPL 2026 Q4
```

### Shell completion

```bash
eval "$(invd completion zsh)"
invd completion bash > ~/.local/share/bash-completion/completions/invd
invd completion fish > ~/.config/fish/completions/invd.fish
```

Completion covers commands, flags, and the `/v1` paths after `invd api`.

## Errors and exit codes

An error prints at most three lines on stderr: what failed (with the problem `code`), what to do (an `invd` command
where invd knows one, else the API's `remedy`), and the request id with the docs link. No HTTP status number. Under
`--json` the whole problem body follows as one JSON line on stderr.

```
$ invd filings AAPL --limit 500
✗ limit: must be <= 200.  (invalid_parameter)
  Pass a limit of at most 200, or walk the pages with next_cursor.
  req_01JC…  ·  https://data.invinite.com/docs/errors#invalid_parameter
$ echo $?
2
```

The exit codes are the same in `invd` and the Web CLI `inv`:

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | refused or failed (any other problem `code`, a network error) |
| 2 | usage: a bad flag or argument, the API's `invalid_parameter` / `unknown_parameter` / `cursor_mismatch`, or an answer is needed under `--no-input` |
| 3 | not found: `not_found`, `not_covered`, a 404 |
| 4 | auth required: no key, 401, `unauthorized` / `forbidden` |
| 5 | integrity: a download's checksum or size does not match |
| 6 | credits exhausted or plan required: 402, `plan_required`, `insufficient_credits` |
| 7 | partial: an `--all` cut short by a failure (resume with the printed `--cursor`) or a short download |
| 130 / 143 | interrupted (Ctrl-C / SIGTERM); an `--all` walk prints its resume cursor first |

## Changes in 8.0

8.0 follows Data API 7.0 (instruments and funds). Breaking: four command groups are gone, without aliases (an unknown
command error names the replacement), and the symbol commands take `--symbol` / a symbol positional instead of
`--company`.

| 7.x | 8.0 |
|---|---|
| `holdings <company>` | `invd holders <symbol> --source 13f` (one symbol; a stock or a fund) |
| `holdings --filer <cik>` | `invd filers holdings <cik>` |
| `holdings changes <company>` | `invd holders changes <symbol>`; one manager: `invd filers holding-changes <cik>` |
| `fund-holdings <company>` | `invd holders <symbol> --source nport` |
| `fund-holdings --filer <cik> --series <S…>` | `invd funds holdings <fund>` (ticker or fund key; listed funds only) |
| `etf-holdings <etf>` | `invd funds holdings <fund>` |
| `etf-holdings --company <ticker>` | `invd holders <symbol> --source issuer_file` |
| `etf-weights <etf>` | `invd funds weights <fund>` |
| `companies dividends <company>` | `invd dividends <symbol>` (any instrument) |
| `companies splits <company>` | `invd splits <symbol>` |
| `filings <company>`, `search filings --company` | `invd filings <symbol>`, `invd search filings --symbol` |
| `companies list` / `get` of an ETF or a closed-end fund | `invd funds list` / `invd funds get` (`invd companies` lists operating companies only) |
| — | new: `invd instruments list` / `get` (what a ticker is: `stock`, `etf`, `closed_end_fund`, `etn`, and the datasets served for it) |

Output: holder rows are one shape for every source (`holder.name`, `holder.cik`, `source`, `shares`, `value_usd`,
`weight_pct`, `as_of`); `invd holders` without `--source` prints each source's rows one after another and never sums
them (`--json`: `meta.sections` has each source's state, as-of date and total). The stderr header of `invd funds
holdings` / `weights` names the source (issuer file or N-PORT report), its as-of date and the reason of an empty
answer. A command that takes one value (`holders`, a member id) refuses a second word instead of ignoring it.

## Changes in 7.5.0

7.5.0 follows Data API 6.5 (end users). New commands, no change to an existing one or to the exit codes:

- `invd alert-users` with `list`, `get`, `update`, `batch`, `pause`, `resume`, `delete`: per-user limits (`--max-active-alerts`,
  `--max-script-alerts`, `--max-fires-per-day`), usage and effective limits, pause / resume, erasure (`delete` asks
  unless `--yes`).
- `invd me alert-user-defaults-get` / `invd me alert-user-defaults-update`: the account defaults every end user without its own
  value gets.
- `invd alerts create --validate-only`: every check of a create, nothing written.

## Changes in 7.4.0

7.4.0 follows Data API 6.4 (script chains, weekly / monthly bars, commodities, pre-close evaluation). No command or
exit code changes; the new condition fields are nested objects, sent with `--body` / `--body-file`:

- `script` alerts take `series_inputs` + `nodes`: a script's `input.externalSeries` inputs read a bar field (`ohlc`),
  a built-in indicator series (`builtin_indicator`) or another script's plot (`script_output` of a producer in
  `nodes`); producers run on the alert's symbol, interval and bars, in plan order, every bar.
- `script` / `indicator` take `evaluation: {"kind": "pre_close", "offset_minutes": 1–720, "exchange"?}`: the forming
  bar is evaluated that many minutes before the US session close (16:00 New York, a half day's early close, never on
  a weekend or holiday) and only that evaluation delivers; `exchange` is required for crypto and commodities.
- `--interval` accepts `1w` / `1mo` for `script` and `indicator`, and `1m`…`30m` for `volume_spike` (every closed bar);
  `--asset-class commodity` (`XAUUSD` / `XAGUSD`) for the price types, `script` and `indicator`; `--cooldown-seconds`
  up to 366 days, `--cooldown-bars` up to 1,000,000.

## Upgrading from 6.x

7.0 follows the Data API's alerts release: the `webhooks` group is gone with `/v1/webhooks`. Its replacement is
`invd alerts` (alert rules), `invd destinations` (the webhook endpoints alert events are delivered to, each with its own
signing secret) and `invd alert-events` (the event log; `invd alert-events tail` follows it live). Every other command,
flag and output is unchanged.

## Upgrading from 5.x

6.0 keeps every 5.x command, flag and output. Breaking: exit codes (partial 3 → 7, not found 1 → 3, Ctrl-C 130
everywhere); the error print (three lines, no HTTP status); the config file moves from `~/.config/invd/config.toml` to
`~/.config/invinite/invd.toml` (carried over once on first run); confirmations of `invd auth`, `invd config set` /
`unset`, `invd plugin` and `invd agent-setup` go to stderr, and `plugin install` / `uninstall` and `agent-setup` take
`--no-input`.

## Upgrading from 4.x

5.0 keeps every 4.x command, flag, output and exit code; only the request paths moved from `/v2/...` to `/v1/...`
(the API's 2026-11-11 cut-over; `/v2/*` answers 404 since, so 4.x no longer works). `invd api` paths are `/v1/...`
now. Upgrade = install 5.0.

## Upgrading from 3.x

4.0 replaced the old v1 command tree with the noun-verb grammar (5.0 keeps it). No 3.x spelling is kept as an alias.

| 3.x | 4.0 |
|---|---|
| `login` / `logout` | `invd auth login` / `invd auth logout` |
| `config set-key` | `invd auth login --with-token` |
| `config set-url <url>` | `invd config set base_url <url>` |
| `company search\|details\|dividends\|…` | `invd companies list\|get\|fiscal-periods`, `invd dividends`, `invd splits` |
| the 24 `financials <statement>[-detailed\|-presentation]`, `as-reported-*`, `snapshot` subcommands | `invd financials <company…> --basis … --view … --statement …` (several companies + one fiscal period = the old snapshot) |
| `metadata metrics` / `metadata section-ids` | `invd catalog metrics` / `invd catalog sections` |
| `earnings events\|transcript\|qa\|press-release\|…` | `invd events list\|transcript\|transcript-text\|qa\|press-release\|slides\|audio\|…` |
| `earnings extractions --kind guidance\|kpi` | `invd guidance list` / `invd guidance kpis` |
| `earnings` downloads (`--output <file>`) | `--save <file>` |
| `news get --pdf-out <file>` | `invd news get <id> --save <file>` |
| `sec filings\|filing\|document\|sections\|search` | `invd filings list\|get`, `invd documents get\|sections`, `invd search filings` |
| `ownership …` | `invd holders list\|changes` |
| `usage` | `invd me usage` |
| `ws listen` (WebSocket stream) | no CLI command in 4.0; use the API's `/v1/stream` |
| `-i, --identifier AAPL` | the positional company: `invd filings AAPL` |
| `--offset <n>` | `--cursor <next_cursor>` |
| `INVINITE_DATA_API_KEY` | still read; `INVD_API_KEY` takes precedence |

### Older majors

invd 3.x (the old v1 API) and 4.x (the `/v2` paths) call routes that were deleted on 2026-11-11; neither works
against the live API any more. Install 8.x.

## Development

```bash
pnpm dev -- companies get AAPL --dry-run   # run from source
pnpm build
pnpm test
pnpm lint
```

Plain commands are generated from the API's OpenAPI spec; see `CLAUDE.md` for the chain.

## License

ISC
