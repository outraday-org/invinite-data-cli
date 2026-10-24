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

Every data command is generated from the Data API's OpenAPI document: one command per operation, named by the
route's `x-cli` (`invd <group> <action>`), its flags the operation's parameters spelled with dashes
(`fiscal_period_type` → `-p, --fiscal-period-type`, `event_id` → `--event-id`; path parameters are flags too), its help
text the spec's summary and parameter descriptions. List them with `invd --help` and `invd <group> --help`; the
[plugin skill](claude-plugin/skills/invinite-data-cli/SKILL.md#commands-reference) carries one generated example per
command. A handful of commands are hand-written because they do more than one call — `login`, `logout`, `config`,
`plugin`, `ws` and the earnings downloads / text renders below (`src/hand-written-commands.ts`).

| Group | What it covers |
|-------|----------------|
| `company` | Search, details, list, dividends, fiscal periods, splits |
| `financials` | Standardized and as-reported statements and snapshots — one command per variant: `income-statement`, `income-statement-detailed`, `income-statement-presentation`, `as-reported-income-statement…`; the same for `balance-sheet`, `cash-flow`, `snapshot` |
| `metrics` | Ratios, growth, CAGR |
| `segments` | `list`, `list-detailed` |
| `filings` | List, natural-language search, sections, form types |
| `earnings` | Calendar, events, live calls, transcripts, Q&A, participants, analysts, guidance and KPI extractions, diff, metrics, prosody, price moves during the call, media, documents, search, company IR documents |
| `ownership` | 13F holdings by company / investor, institutions, transactions |
| `insider-trades`, `ipos`, `market`, `metadata` | Insider transactions, IPOs, market holidays, available metric and filing-section ids |
| `webhooks` | Earnings-call webhook subscriptions (PRO) |
| `usage`, `health`, `status` | Your account's usage (free), API liveness and status (no key) |

```bash
invd company search -q Apple --json
invd company details -i AAPL --json
invd financials income-statement -i AAPL -p annual --json
invd financials balance-sheet-detailed -i MSFT -p quarterly --limit 4 --with-formula true --json
invd financials as-reported-cash-flow -i GOOGL -p annual --json
invd financials snapshot -i AAPL,MSFT,GOOGL -p annual --json
invd metrics ratios -i AAPL -p annual --category profitability --json
invd segments list-detailed -i AAPL -p annual --json
invd filings sections -i AAPL --form-type 10-K --section-id risk_factors --json
invd ownership holdings-by-company -i AAPL --min-value 1000000 --json
invd insider-trades list -i TSLA --acquired-disposed D --limit 20 --json
invd earnings events -i AAPL -s desc -l 4 --json
invd earnings event --event-id <event_id> --include observations --json
invd earnings participants --event-id <event_id> --include evidence --json
invd earnings person --person-id <person_id> --json
invd earnings price-attribution --event-id <event_id> --json
```

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

### earnings

Earnings calls and the companies' IR libraries, including non-earnings events (investor days, conferences, AGMs:
`--event-type`). The live transcript (`ws listen --earnings`), audio, slides, the live stream and webhooks need the
**PRO** plan (calendar, events and `live` need LITE, the other reads STANDARD); a `403` names the plan a route needs.

**Selecting a call.** Commands about one call take either `--event-id <event_id>` (a UUID from `earnings events` /
`earnings calendar`; wins over the rest), or `-i, --identifier <ticker|cik>` with `--year <n>` + `--quarter <n>` (the
company's fiscal quarter) or `--date <YYYY-MM-DD>` (the call day: a calendar day in New York time (America/New_York); a
call without a confirmed time is listed on its announced date). An incomplete selector is refused by the API (`400`).

The seven hand-written earnings commands download or render what one call returns:

| Command | What it adds |
|---------|--------------|
| `earnings transcript` | `--format speakers\|text\|words\|sections\|cleaned`; `--transcript-version <n>` (not `--version`, which prints the CLI version) / `--as-of <iso>`; `-o, --output <file>` saves it as text. The header shows where the Q&A begins; `--json` carries it as `qa_start_ms` |
| `earnings press-release` | `--body` includes the release text; `-o` saves it |
| `earnings audio` | The recording as a presigned URL, or `-o` to save it |
| `earnings slides` | `--markdown` (each page's text), `--pages <range>`, `-o` saves the deck PDF |
| `earnings documents` | `--kind <list>`, `--category <list>`, `--group <path>` (document-tree folder, a prefix matches its subfolders), `--body`; `-o <dir>` saves every document as `<kind>-<document_id>.<ext>`. The table shows each document's tree folder (`group`) |
| `earnings company-documents` | `-i` (required), `--section`, `--kind`, `--year`, `--period`, `--event-id`, `--category <list>` (earnings, events, reports, presentations, governance, esg, shareholder, other), `--group <path>` (e.g. `earnings/fy2027/q2`; `earnings` = every quarter), `--fiscal-year` / `--fiscal-quarter`, `--include calls` (every earnings call's documents in the same list, `source: call`); `-o <dir>` saves every stored file as `<year>-<kind>-<document_id>.<ext>`. The table shows each document's source and tree folder (`group`) |
| `earnings document` | `--document-id` (from `company-documents` / `document-search`): metadata and signed URLs, `--pages` the per-page text, `-o` the file |

**Saving files.** An existing `--output` file is only replaced with `--force`; without `--output` the media commands
print **presigned URLs that expire after 15 minutes**. With `documents` / `company-documents --output`, a row without a
download URL (a link-only `sec_filing` or `webcast`, or a file the API could not fetch — use its `source_url`) is never
skipped silently: each gets a warning on stderr, followed by a count (`2 of 3 documents saved; 1 skipped`). The exit
code is 0 when at least one document was saved (or the list was empty) and 1 when documents were listed but none could
be saved. An interrupted download (Ctrl-C) never leaves a partial file behind.

```bash
invd earnings transcript -i AAPL --year 2026 --quarter 4 --output aapl-q4.txt
invd earnings press-release -i AAPL --year 2026 --quarter 4 --body
invd earnings audio --event-id <event_id> --output call.mp3
invd earnings slides -i AAPL --year 2026 --quarter 4 --output deck.pdf
invd earnings documents --event-id <event_id> --output ./docs
invd earnings company-documents -i AAPL --kind investor_day_deck --output ./ir-docs
invd earnings company-documents -i AAPL --group earnings/fy2026/q4
invd earnings company-documents -i AAPL --include calls --all --json
invd earnings document --document-id <document_id> --pages
```

Company documents and document-search hits are company-published material, shown as published: quote them as passages
from company-published documents, not verified facts. Price attribution (`earnings price-attribution`) is temporal
coincidence, not attribution of cause.

---

### webhooks

Earnings-call webhook subscriptions (PRO): signed, retried `POST`s of the call lifecycle to your HTTPS endpoint. Events: `earnings_call.scheduled`, `.rescheduled`, `.started`, `.ended`, `.transcript_provisional`, `.transcript_ready`, `.transcript_corrected`, `.assets_ready`, `.keyword_hit` (one delivery per mention of one of the subscription's keywords on a live call, with the speaker, `start_ms` and the sentence), `.guidance_flash` (a guidance number spoken live, before the final transcript), and `ping`. Deliveries carry `X-Invinite-Signature: t=…,v1=…` (HMAC-SHA256 of `<t>.<raw body>` with the secret) and are retried after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h.

`webhooks create` and `webhooks update` take the request body as `--body '<json>'` or `--body-file <path>` (`-` reads
stdin); the other commands take the subscription as `--id`. `create` **prints the signing secret once**; `rotate-secret`
prints a new one (the old one stays valid for 5 minutes); `test` queues a signed `ping`; `deliveries` lists the last
100 attempts.

```bash
invd webhooks create --body '{"url":"https://hooks.example.com/invinite","events":["earnings_call.transcript_ready","earnings_call.started"],"filters":{"ciks":["320193"]}}'
invd webhooks create --body '{"url":"https://hooks.example.com/alerts","events":["earnings_call.keyword_hit"],"filters":{"keywords":["tariffs","buyback"]}}'   # every company
invd webhooks update --id <id> --body '{"keywords":["tariffs","china","buyback"]}'
invd webhooks update --id <id> --body '{"active":false}'
invd webhooks test --id <id>
invd webhooks deliveries --id <id>
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

**Live prices.** With `--prices` the same per-call subscription also delivers a `price_tick` frame (PRO, at most one per second, only for seconds with a trade — pre-market and after-hours seconds are sparse). On a terminal it is one line rewritten in place — `[16:32:05 ET · 12:34] AAPL 336.08  +42.5 bp since call  −127.5 bp on day  (vol 1,240)`: New York time, the call clock of the transcript (`m:ss`, the same clock as the segments' `[m:ss]`), the price, the return since the last trade before the call and the day's return vs the previous close; green / red by the since-call return, dim from the snapshot fallback. The line shows temporal coincidence with what is being said, not attribution of cause. Price ticks follow one call: `--all-live --prices` is refused (as by the API). With `--json` the frames are emitted as they arrive: `invd ws listen --earnings <event_id> --prices --json | jq 'select(.type=="price_tick")'`. The minute rows so far are `invd earnings price-attribution --event-id <event_id>`.

```bash
invd ws listen --earnings <event_id> --prices
```

Finals are named from the newest speaker-name snapshot (`Speaker A` until a name is known). A `gap` line marks a seq range with no final yet (a late final may still follow on the same subscription, so finals can print slightly out of order); `resume_unavailable` means missed finals cannot be replayed right now — live delivery continues and the API back-fills them once it can. Neither needs a re-subscribe. After a reconnect the listener resumes after the last final it printed; it exits once the final transcript is ready (`invd earnings transcript --event-id <id>`). With `--json` every frame is one JSON line (NDJSON), e.g. `invd ws listen --earnings 320193 --json | jq -r 'select(.type=="transcript_segment") | .text'`.

---

## Output Formats

Each data command prints a table, a key/value list or JSON according to its operation; `--json` prints the API's raw
response.

```bash
# Default table output
invd company search -q Apple

# Raw JSON output (useful for piping to jq or other tools)
invd company search -q Apple --json

# Pipe to jq
invd financials income-statement -i AAPL -p annual --json | jq '.companies[0]'
```

## Pagination

Paginated commands take `-l, --limit` and `--offset`, or `--all` to follow every page (`next_url`; per-company commands
merge each company's pages). A command whose operation does not paginate refuses `--all` by name. Without `--limit`
the API's own page size applies. A page the API refuses with 429 (its admission limit) or 503 is retried up to five
times after the answer's `Retry-After` (else 1 s, 2 s, 4 s, …, at most 30 s), so a long walk slows down instead of
losing the pages it already fetched.

```bash
# Results 20-30
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
