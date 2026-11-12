# @invinite-org/invinite-data-cli

`invd` is the command-line interface for the [Invinite Data API](https://invinite.com/docs/data-api/overview) (v2):
listed companies and every SEC filer, standardized and as-reported financial statements, ratios, growth and CAGR,
segments, SEC filings and immutable document versions, earnings calls (transcripts, Q&A, guidance, slides, audio),
13F holdings, insider trades, IPOs, news and full-text search — from your terminal, a script or an AI agent.

```bash
invd financials AAPL --period quarterly --limit 4
invd filings AAPL --form 10-K
invd events transcript AAPL 2026Q3
invd holdings AAPL
invd search filings "supply chain risk" --company AAPL
```

Version 6.0 keeps the 5.0 commands and follows the conventions shared with the Web CLI `inv`: one exit-code table
(not found 3, partial 7, interrupted 130 / 143), a three-line error with the API's remedy, and the config file in
`~/.config/invinite/invd.toml`. Coming from 5.x, read [Upgrading from 5.x](#upgrading-from-5x); from 4.x,
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
| `companies` | listed companies: list, profile, fiscal periods, dividends, splits |
| `filers` | every SEC filer (13F managers, pre-IPO issuers, former registrants), listed or not |
| `financials` | statements: standardized or as-reported, summary / detailed / presentation, point in time |
| `metrics` | ratios, growth, CAGR, and the explanation of one standardized fact |
| `segments` | segment values (revenue by product, geography …) |
| `filings` | SEC filings, their numeric and text facts, review chains, dataset releases |
| `documents` | immutable document versions: blocks, pages, sections, figures, fact places |
| `events` | earnings calls and other corporate events: transcripts, Q&A, slides, audio, call analytics |
| `guidance` | guidance items and KPI mentions |
| `people` | executives and analysts, and who took part in which event |
| `holdings` | 13F holdings and quarter-over-quarter changes |
| `insider-trades` | Form 4 transactions |
| `investor-documents` | company-published documents (annual reports, decks, letters) |
| `news` | news from SEC filings and the companies' own newsrooms, with attribution |
| `search` | full-text search over filings, transcripts, investor documents and news |
| `ipos`, `market` | offerings; US market holidays |
| `catalog` | static catalogs: metrics, sections, forms, event types, document kinds, mapping rules |
| `me` | your account and usage (free) |
| `webhooks` | outbound event deliveries |

Plus the hand-written `api`, `auth`, `config`, `plugin`, `agent-setup` and `completion`.

**The first positional is the natural key.** On company lists it is a ticker or CIK, and several are allowed:

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

## Examples

### Companies and filers

```bash
invd companies list -q apple
invd companies get AAPL --expand coverage
invd companies fiscal-periods AAPL
invd companies dividends AAPL --ex-date-gte 2024-01-01
invd companies splits AAPL
invd filers list -q berkshire
invd filers get 0000102909
```

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
invd search filings "supply chain risk" --company AAPL --form 10-K --item 1A
```

A filing's `documents` carry the `version_id` of each immutable document version; cite a passage by `version_id` and
`block_id` (and the printed page label when present). `search filings` costs 100 credits a page.

### Earnings calls and events

```bash
invd events AAPL                                    # calendar and history (earnings calls by default)
invd events AAPL --status upcoming
invd events list AAPL --type all --sort -scheduled_at --limit 10
invd events get AAPL 2026Q3
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
invd search transcripts "gross margin" --company AAPL --type qa
```

Every `*_ms` field is milliseconds from the call's start; cite it as `[m:ss]`.

### Ownership and insiders

```bash
invd holdings AAPL                                  # 13F holders of a company
invd holdings --filer 0000102909                    # one manager's portfolio
invd holdings AAPL --period-end 2026-06-30 --instruments all
invd holdings changes AAPL --type new,sold_out
invd insider-trades AAPL --filed-at-gte 2026-01-01
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
invd market holidays --date-gte 2026-01-01
```

Every news item carries `attribution` (publisher, `source_url`, `published_at`, and the form and accession of a
filing): name the publisher and link the source whenever you show a headline or summary.

### Account and webhooks

```bash
invd me show
invd me usage --days 7
invd webhooks list
invd webhooks create --body '{"url":"https://hooks.example.com/invinite","events":["event.transcript_ready"],"filters":{"ciks":["0000320193"]}}'
invd webhooks deliveries <id>
invd webhooks delete <id>
```

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
invd holdings AAPL --all --output csv > aapl-holders.csv
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
invd api GET /v1/filings?company=AAPL --paginate --jq '.data[].accession'
invd api GET /v1/holdings -F company=AAPL -F limit=100
invd api POST /v1/webhooks --input webhook.json
invd api DELETE /v1/webhooks/<id> --yes
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
✗ limit: must be <= 200  (invalid_parameter)
  Pass a limit of at most 200.
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
| `company search\|details\|dividends\|…` | `invd companies list\|get\|dividends\|fiscal-periods\|splits` |
| the 24 `financials <statement>[-detailed\|-presentation]`, `as-reported-*`, `snapshot` subcommands | `invd financials <company…> --basis … --view … --statement …` (several companies + one fiscal period = the old snapshot) |
| `metadata metrics` / `metadata section-ids` | `invd catalog metrics` / `invd catalog sections` |
| `earnings events\|transcript\|qa\|press-release\|…` | `invd events list\|transcript\|transcript-text\|qa\|press-release\|slides\|audio\|…` |
| `earnings extractions --kind guidance\|kpi` | `invd guidance list` / `invd guidance kpis` |
| `earnings` downloads (`--output <file>`) | `--save <file>` |
| `news get --pdf-out <file>` | `invd news get <id> --save <file>` |
| `sec filings\|filing\|document\|sections\|search` | `invd filings list\|get`, `invd documents get\|sections`, `invd search filings` |
| `ownership …` | `invd holdings list\|changes` |
| `usage` | `invd me usage` |
| `ws listen` (WebSocket stream) | no CLI command in 4.0; use the API's `/v1/stream` |
| `-i, --identifier AAPL` | the positional company: `invd filings AAPL` |
| `--offset <n>` | `--cursor <next_cursor>` |
| `INVINITE_DATA_API_KEY` | still read; `INVD_API_KEY` takes precedence |

### Older majors

invd 3.x (the old v1 API) and 4.x (the `/v2` paths) call routes that were deleted on 2026-11-11; neither works
against the live API any more. Install 6.x.

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
