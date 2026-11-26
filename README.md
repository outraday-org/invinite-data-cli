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


## Plugin 0.22.0: skills from the Data API

Plugin 0.22.0 (published with the next CLI patch, 11.4.1; no command changed) ships the ten Agent Skills the Data
API's MCP server serves — the data guide `invinite-financial-data` and nine workflows (`financial-research`,
`analyze-earnings-call`, `compare-companies`, `analyze-filing`, `ownership-review`, `alert-setup`, `earnings-preview`,
`what-changed-since-last-report`, `restatement-history`) — plus the CLI-only skill `invinite-data-cli`. The six
`commands/*.md` (`/financial-research`, `/analyze-earnings-call`, …) are gone: the workflows are skills now, and
`invd plugin install` removes the files earlier versions wrote. See [The plugin](#the-plugin).

## Changes in 12.2.0 (Data API 12.2)

CLI 12.2.0 and plugin 0.26.0 adopt Data API 12.2 (additive, no command removed or renamed): the new group `bulk`
(Enterprise, 0 credits, daily download and export limits per account) saves the SEC data sets as files.

- `invd bulk files`: the downloadable files — the SEC's own release files as archived (`--kind raw`) and parsed
  period files of 13F, Forms 3/4/5, Form D and N-PORT (`--kind parsed`, `--format csv_gz|parquet`); `--dataset`,
  `--released-at-gte` / `--released-at-lte`, `--include-superseded`.
- `invd bulk download <file_id> --out <dir>` (or `--save <file>`): saves the file under its own name, size and SHA-256
  verified (`--force` replaces an existing file). The download URL is valid for 15 minutes: the printed answer shows
  `<hidden: valid until …>` in its place, `--print-url` prints it and downloads nothing, and a URL that expired before
  the download started is asked for once more (that counts as a second download).
- `invd bulk export --dataset f13 --company AAPL,MSFT --date-field period_of_report --from 2025-01-01 --to 2026-09-30
  --wait --out .`: a company export (one parsed data set filtered by companies and / or `--filer` CIKs over a date
  range). `--wait` checks the job every 10 s (backing off to 60 s) until it is ready, failed or expired, then downloads
  it with `--out` / `--save`; Ctrl-C stops waiting (the job keeps running) and prints how to resume.
- `invd bulk exports`, `invd bulk export-status <export_id>`, `invd bulk export-download <export_id> --out <dir>`. An
  export's stderr note says why its range was cut (`before_postgres_window`: the earlier data is only in the raw files;
  `capped_window`) and, for N-PORT, that an export covers listed funds whole and unlisted funds as holders only (the
  N-PORT bulk files hold every fund).
- `--out <dir>` is offered by every download whose answer states a `filename` (today the two bulk downloads); the
  transcript, audio, news and investor-document downloads keep `--save <file>`.

## Changes in 12.1.0 (Data API 12.1)

CLI 12.1.0 and plugin 0.25.0 adopt Data API 12.1 (additive, no command removed or renamed):

- `invd guidance non-gaap <company>` (Pro): the adjusted (non-GAAP) figures a company's results releases print, such as
  adjusted EPS, adjusted EBITDA or free cash flow, each with the GAAP figure it starts from (`gaap`), the adjustment
  lines and `reconciled` (`false` = the lines do not add up; the figure is shown as printed). `--event` / `-e` reads one
  release instead of a company, `--metric` / `-m eps_adjusted_diluted`, `--period-kind`, `--period-end-gte` ….
- `invd guidance kpi-series <company>` (Pro): operating KPIs as series, one value per KPI, period and segment
  (`--kpi` / `-k load_factor`, `--segment consolidated` for the company-wide values), from the release tables first,
  then the release text, then the call (`origin`), with `xbrl_check` against the 10-Q / 10-K.
- `invd catalog kpis` (every plan): the KPI keys of each sector catalog (`--sector airlines`).
- `invd guidance list` shows guidance without a number with its `statement_text` and `qualifier`; `--qualitative`
  lists only those (`--no-qualitative` only the numeric items).
- `invd funds list` shows an `is_active` column (`false` for a delisted fund; tells rows apart under
  `--is-active all|false`).
- The vendored `analyze-earnings-call` skill and the `invinite-financial-data` earnings guide name the new commands'
  routes.

## Changes in 12.0.0 (Data API 12.0)

CLI 12.0.0 and plugin 0.24.0 adopt Data API 12.0 (BREAKING):

- `invd instruments list` and `invd funds list` take `--is-active <true|false|all>`: `true` (the API's default) =
  listed today, `false` = delisted, `all` = both. Without the flag the lists now show listed-today symbols only (the
  `--q` search included). `--no-is-active` is gone: use `--is-active false`.
- `invd companies get` no longer has `is_delisted` (the companies list holds listed companies only).
- `invd people list` leaves conference-call operators out; `--include-operators` lists them (`--role operator` lists
  them anyway).

## Changes in 11.5.0 (Data API 11.5)

CLI 11.5.0 and plugin 0.23.0 adopt Data API 11.5 (additive, no command removed or renamed):

- `invd ownership beneficial <company>` (Standard): Schedule 13D (activist) and 13G (passive) filings of holders above
  5 % of a class, one row per filing with its reporting persons. `--filer` / `-f <cik>` reads one reporting person
  across companies (one of company / `--filer` is required), `--type activist|passive`, and `--no-current` lists the
  whole amendment chain instead of the latest filing per holder and class.
- `invd ownership sale-notices <company>` (Standard): Form 144 notices of a planned insider sale (a proposed sale, not
  an executed one; the executed trade is a Form 4 in `invd insider-trades`). `--owner` / `-o <cik>` reads one seller;
  a replaced notice names its amendment in `replaced_by`.
- The vendored `ownership-review` skill and the `invinite-financial-data` ownership guide cover both.

## Changes in 11.4.0 (Data API 11.2)

CLI 11.4.0 and plugin 0.21.0 adopt Data API 11.2 (additive, no command removed or renamed):

- `invd insider-trades holdings` (Standard): Form 3/4/5 holdings of a company, or of one insider with `--owner` / `-o`.
- `invd insider-trades list --owner <cik>`: the company is now optional; one of the company / `--owner` is required
  (the API answers 400 without either). Use the `owner_cik` of a trade row to follow one insider across issuers.
- `invd metrics vintages <company> -c <concept> -e <period_end>` (Pro): every value filed for one fact, by filing.
- `invd catalog exchanges` and `invd catalog sectors` (Free): the exchanges and sectors with their counts.
- `invd financials --metrics <list>`: keep only the listed metric ids (standardized) or XBRL concepts (as-reported)
  inside `facts`, on all six statement operations.
- The turnover ratios (asset, inventory, receivables) are in the `efficiency` category of `metrics ratios`.
- New fields: `source.is_preliminary` on statement rows, `former_tickers` (`--expand`) on a company or filer.

## US macro data

CLI 11.3.0 and plugin 0.20.0 adopt the Data API's Macro group. The catalog is available on Free. Histories and snapshots require Lite or corresponding read entitlement. Each successful read costs one credit.

```sh
invd macro --help
invd macro series --family labor --all --json
invd macro inflation --series cpi_all_sa --reference-date-gte 2025-01-01 --json
invd macro gdp-snapshot --json
invd macro labor --series payrolls_sa --limit 1 --json
invd macro labor --series initial_claims_sa --limit 1 --json
invd macro yield-curve --date-gte 2025-02-14 --date-lte 2025-02-14 --json
invd macro yield-curve-snapshot --json
```

Use `--cursor` with the same filters to continue a page. GDP and labor snapshots retain each series' own period. Treasury responses keep all fourteen maturities, including null yields. For push subscribe to the macro channel on `WS /v1/stream`; after reconnecting use the macro snapshot commands above to recover current data. The CLI and hosted MCP expose request/response operations.


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
| `metrics` | ratios, growth, CAGR, the explanation of one standardized fact, and every filed value of one fact (`metrics vintages`) |
| `segments` | segment values (revenue by product, geography …) |
| `filings` | SEC filings, their numeric and text facts, review chains, dataset releases |
| `bulk` | the SEC data sets as files (Enterprise): raw SEC release files, parsed period files (`csv_gz`, `parquet`) and company export jobs, saved with `--out` / `--save` |
| `documents` | immutable SEC filing document versions: blocks, pages, sections, figures, fact places |
| `events` | earnings calls and other corporate events: transcripts, Q&A, slides, audio, call analytics |
| `guidance` | guidance items (numeric and statements), KPI mentions, KPI series (`guidance kpi-series`) and reported non-GAAP figures with their reconciliation (`guidance non-gaap`) |
| `people` | executives and analysts, and who took part in which event |
| `holders` | who holds ONE stock or fund: `--source 13f` (13F managers), `nport` (funds' N-PORT reports), `issuer_file` (ETF issuer files), or without `--source` an overview of all three; `holders changes` = 13F quarter-over-quarter changes |
| `insider-trades` | Form 4 transactions (trade date, owner CIK, derivative and 10b5-1 flags where the SEC Form 3/4/5 dataset has them) and Form 3/4/5 holdings (`insider-trades holdings`), by company or by insider (`--owner`) |
| `ownership` | Schedule 13D / 13G filings of holders above 5 % (`ownership beneficial`, by company or by reporting person with `--filer`) and Form 144 notices of planned insider sales (`ownership sale-notices`, by company or by seller with `--owner`) |
| `investor-documents` | company-published documents (annual reports, decks, letters) |
| `news` | news from SEC filings and the companies' own newsrooms, with attribution |
| `search` | full-text search over filings, transcripts, investor documents and news |
| `ipos`, `offerings`, `market` | offerings from registration to listing; Form D private offerings; US market holidays |
| `catalog` | static catalogs: metrics, sections, forms, event types, document kinds, mapping rules, exchanges, sectors, sector KPIs (`catalog kpis`) |
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

Plans (Data API 10.0): `companies` (with `companies fiscal-periods`), `instruments`, `catalog`, `market holidays`,
`events list` / `get` and `me` reach every plan. Lite adds filings, filers, `documents`, `financials` (summary
view), `metrics`, `guidance list`, `holders list`, `dividends`, `splits`, `news`, `funds`, `ipos`, `offerings`,
`people`, `events press-release` and the alerts commands (`alerts`, `alert-events`, `alert-templates`, `alert-users`,
`destinations`, `scripts`, `script-versions`). Standard adds `segments list`, `insider-trades` (incl. `holdings`), `ownership`, `search filings` and
`search news`. Pro adds the earnings-call content (transcripts, Q&A, stats, audio, slides, comparison, prosody, price
attribution, transcript diff and versions), `investor-documents`, `search transcripts`, `search investor-documents`,
the detailed and presentation `financials` views, `segments list-detailed`, `guidance kpis`, `guidance kpi-series`, `guidance non-gaap`, holder changes and fact
places, `metrics vintages` (and the WebSocket stream); `filings datasets` and `bulk` need Enterprise. Pay as you go (credits without a plan;
`invd me show` says `payg`) reaches what Pro reaches except live data; the API's refusal says so. `--help` names each
command's plan; a refused plan exits 6 and the error names the plan.

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
| `--metrics` | a comma list to keep inside `facts`: metric ids (standardized) or XBRL concepts (as-reported); the presentation view keeps each with its path |

```bash
invd financials AAPL                                         # annual, all three statements
invd financials AAPL --period quarterly --limit 4
invd financials AAPL -s income-statement --view detailed --json
invd financials AAPL --basis as-reported --view presentation -s balance-sheet
invd financials AAPL --as-of 2025-01-31 --fiscal-year-gte 2020
invd financials AAPL --filing 0000320193-25-000079
invd financials AAPL MSFT GOOGL --fiscal-year 2025           # several companies, one period: a snapshot
invd financials AAPL --basis as-reported --reported-only --display-sign cash_flow_direction -s cash-flow
invd financials AAPL -s income-statement --metrics is_total_revenue,is_net_income
invd financials AAPL --basis as-reported --metrics Revenues,NetIncomeLoss
```

Standardized values are keyed by `metric_id`; `invd catalog metrics` lists them.

### Metrics and segments

```bash
invd catalog metrics --statement income-statement
invd metrics ratios AAPL -p annual --category profitability,valuation
invd metrics growth MSFT -p quarterly --basis yoy
invd metrics cagr AAPL MSFT -p annual --horizon 5
invd metrics ratios AAPL -p annual --category efficiency     # turnover ratios
invd metrics explain "0000320193|is_total_revenue|annual|2026|4"
invd metrics vintages AAPL -c RevenueFromContractWithCustomerExcludingAssessedTax -e 2024-09-28           # every value filed for one fact (PRO)
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
invd catalog exchanges
invd catalog sectors
invd documents sections <version_id>
invd documents get <version_id> --blocks b12-b40 --footnotes
invd documents get <version_id> --pages 1-3
invd documents figure <version_id> --block-id b57
invd search filings "supply chain risk" --symbol AAPL --form 10-K --item 1A
```

### SEC bulk data (Enterprise)

```bash
invd bulk files --dataset f13 --kind parsed --format parquet
invd bulk download bf_01JDXQ8M6V3S2T4N5P7R9K0W1Y --out .
invd bulk download bf_01JDXQ8M6V3S2T4N5P7R9K0W1Y --print-url
invd bulk export --dataset f13 --company AAPL,MSFT --date-field period_of_report --from 2025-01-01 --to 2026-09-30 --format parquet --wait --out .
invd bulk exports
invd bulk export-status bx_01JDXR2A4B6C8D0E2F4G6H8J0K
invd bulk export-download bx_01JDXR2A4B6C8D0E2F4G6H8J0K --out downloads
```

A download URL is valid for 15 minutes and is printed as `<hidden: valid until …>`; `--print-url` shows it (never
store or share it). Downloads and new exports count against daily limits per account (429 when reached).

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
invd guidance non-gaap NVDA --metric eps_adjusted_diluted       # adjusted figures with GAAP start and adjustment lines
invd guidance kpi-series DAL --kpi load_factor --period-kind quarter
invd catalog kpis --sector airlines
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
invd insider-trades list --owner 0001214156          # one insider's trades across every issuer
invd insider-trades holdings AAPL                   # Form 3/4/5 holdings (latest first)
invd insider-trades holdings --owner 0001214156 --as-of-gte 2026-01-01
invd ownership beneficial AAPL                      # latest 13D / 13G filing per holder and class
invd ownership beneficial AAPL --filer 0000102909 --no-current   # one holder's 13G amendment chain
invd ownership beneficial --filer 0001517137 --type activist     # one holder's activist filings across companies
invd ownership sale-notices AAPL --filed-at-gte 2026-01-01       # Form 144 notices of planned insider sales
invd ownership sale-notices --owner 0001214156                   # one seller's notices across issuers
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

Commands whose response points to a file take `--save <file>`; one whose answer states the file's name (the bulk data
downloads) also takes `--out <dir>` to save it under that name (`--force` replaces an existing file). The download's size and SHA-256 are verified before it lands; a
mismatch exits 5. A bulk data download (`invd bulk download`, `export-download`) answers a signed URL valid for 15
minutes: it is hidden in the printed answer (`--print-url` prints it instead of downloading), and an expired one is
asked for once more.

```bash
invd events transcript AAPL 2026Q3 --save aapl-q3.pdf
invd events audio AAPL 2026Q3 --save aapl-q3.m4a
invd news get <id> --save item.pdf
invd investor-documents get <document_id> --save report.pdf
invd bulk download <file_id> --out downloads
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

### One step: MCP connector plus skills

```bash
invd agent-setup --claude --local          # ./.mcp.json + .claude/skills
invd agent-setup --codex --global          # ~/.codex/config.toml [mcp_servers] + skills
invd agent-setup --all --global --dry-run  # show what would be written
```

`agent-setup` adds the Invinite MCP connector (`https://api.data.invinite.com/mcp`) to Claude Code (`.mcp.json` or
`~/.claude.json`) or Codex (`config.toml [mcp_servers.<name>]`) and installs the plugin's skills (the same files as
`invd plugin install` for that runtime). The connector signs in with OAuth on first use (a Client ID Metadata Document or
Dynamic Client Registration, and PKCE; no key is written). MCP calls are billed to the account of the OAuth sign-in, CLI calls to the account of
the key.

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

Re-run the install to update. The plugin bundles eleven skills and the data agent:

- `invinite-financial-data`: the data guide (which tool for which question, periods, coverage, cost; `references/`
  per domain), and nine workflow skills: `financial-research`, `analyze-earnings-call`, `compare-companies`,
  `analyze-filing`, `ownership-review`, `alert-setup`, `earnings-preview`, `what-changed-since-last-report`,
  `restatement-history`. They are a pinned copy of the skills the Data API's MCP server serves (written in MCP tool
  terms); a host that loads skills from the connector offers the same ones.
- `invinite-data-cli`: the CLI fallback — the MCP ↔ CLI mapping, grammar, output flags, exit codes and
  `references/commands.md` (one example per command).
- `agents/invinite-data.md`: a data-retrieval agent that runs `invd` (Claude Code, OpenCode).

| Runtime | Installs |
|---|---|
| Claude Code | `skills/<name>/…` for all eleven skills (with `references/`), `agents/invinite-data.md` |
| Codex | `skills/<name>/…` for all eleven skills (as shipped; the CLI skill without `allowed-tools`) |
| Copilot | `skills/<name>/…` for all eleven skills (as shipped; the CLI skill without `allowed-tools`) |
| OpenCode (global only) | `command/invinite-data-cli.md` (the CLI skill with the command reference appended: a command file cannot carry `references/`), `command/analyze-earnings-call.md` (its last line points at `/invinite-data-cli`), `agents/invinite-data.md` — two commands only: the data guide and the other eight workflows are not installed there |

`install` and `uninstall` also remove what plugin 0.21.0 and earlier wrote and this version no longer ships:
`commands/financial-research.md` and `commands/analyze-earnings-call.md` (Claude Code),
`skills/invinite-financial-research/SKILL.md` and `skills/invinite-analyze-earnings-call/SKILL.md` (Codex, Copilot).

`claude-plugin/` is the single source of these files. In this repository the skill folders under `.claude/skills/` are
symlinks into `claude-plugin/skills/`, and `.codex/skills/`, `.cursor/skills/` and `.agent/skills/` link to those; the
agent links the same way (`.codex/agents/invinite-data.toml` wraps it for Codex). The Claude plugin directory
(`claude --plugin-dir /path/to/invinite-data-cli/claude-plugin`) carries the same skills and agent, and its `.mcp.json`
connects the MCP server. Ask for a workflow in your own words ("analyze NVDA's latest earnings call", "compare Apple,
Microsoft and Google's profitability over the last three years") and the matching skill loads; in Claude Code it can
also be called by name (`/analyze-earnings-call NVDA` after `invd plugin install`,
`/invinite-financial-data:analyze-earnings-call NVDA` from the plugin directory).

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
