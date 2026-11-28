# invinite-data-cli (`invd`)

CLI 13.4.0 / plugin 0.32.0 are prepared against the published Data API/SDK 13.4.0 release, not yet published
as CLI/plugin packages. The exact API release is `e5c69dcfb50c9a1958225faf3f4ad4b0983877a3`
(`data-sdk-v13.4.0`, API Fly v213, evaluator v34), spec SHA-256
`399a6e2a41b65303c2a7b2ce496b83afb3c59dab4ffb3e1d602d08516d577055`. Its bundle preserves the measured
API contract generation base `8cec9fa531978a5544e868e50f726b8602b92ad5`; never replace that provenance field
with the tag commit by hand. All 149 operations retain their commands. The typed alert catalog now has 23 types;
new filing-row and IPO filters come from the official per-type metadata. No Major 14/CAGR source is adopted.

13.3.0 adopts Data API 13.3.0 (delisted subjects served by CIK / unambiguous ticker; descriptions + skill only),
with plugin 0.31.0. Historical reads follow each instrument's measured dataset allowlist: ACA filings are eligible;
financials and insider history are excluded. The exact bundle is API commit
`044c7d6e02eed88f3b3587b826dc382d58bc0180` (`data-sdk-v13.3.0`), spec sha256
`0878cbca1f4c06beb6afdf4189f79185e7a35caf22ec1bb94fb585bee2e4be0c`. Command and flag shapes remain unchanged from 13.2.0. The CLI preserves the API’s specific `not_covered` remedy
(including ambiguous CIK choices), falling back to company search only when the API supplies none.

`invd` 6.x is the CLI of the Data API at `/v1/*` — the contract designed as "v2" (backend `tasks/data-api-v2`), moved
from `/v2` to `/v1` on 2026-11-11 when the old v1 API was deleted. 5.0 = the 4.x commands at the new paths; 6.0 = the
5.0 commands on the conventions shared with the Web CLI `inv` (backend `tasks/cli-api-alignment` C1–C4: exit codes,
three-line error with the API `remedy`, flag meanings, `~/.config/invinite/invd.toml`). 8.0 = Data API 7.0 (backend
`tasks/instruments-and-funds-api` task 5): `instruments`, `funds`, `holders`, `dividends`, `splits` groups; `holdings`,
`fund-holdings`, `etf-holdings`, `etf-weights` removed (`src/cli.ts::REMOVED_COMMANDS` names the replacement in the
unknown-command error, no alias). 8.1 = Data API 7.1 (backend `tasks/data-api-dashboard` A1): `invd alerts list
--symbol` / `-s`, `--destination-id` / `-d`. 9.0 = Data API 8.0. 10.0 = Data API 9.0 (invinite `tasks-julian/todo-0/data-api-plan-restructure`): 50 operations
moved plan up (standardized financials, dividends, splits, news, funds and every alerts group → `lite`; call comparison,
transcript diff / versions, prosody, price attribution, KPIs, holder changes, the stream → `pro`; `filings datasets` →
`enterprise`). `x-tier` now takes five values and `--help` prints it raw; the 403 hint stays tier-blind (the API's
problem names the plan). 11.0 = Data API 10.0 (invinite `tasks-julian/todo-0/data-api-pricing-v2`): 40 operations moved plan (32 standard → `lite`: filings, filers, documents, guidance, holders, metrics, news items, people, IPOs, offerings; 8 standard → `pro`: transcript, Q&A, stats, investor documents and their two searches); `/v1/me.plan` gains `payg` (credits without a plan, reaches Pro minus live data). The CLI still compares no plan to a tier: `invd auth status` words `payg` as "Pay as you go" (`planLabel`), the 403's own sentence is the first error line. 11.1 = Data API 10.3 (pricing-v2 follow-ups, owner 2026-11-23): `invd me usage` prints a pay-as-you-go account's period tier `payg` (was `prepaid`; the enum has no `prepaid` any more), the `earnings_call` alert events `transcript_provisional` / `transcript_corrected` / `documents_updated` need PRO; no command changed. 11.2 adopts Data API 11.0. The CLI keeps its path-based commands and gives distinct help to `documents`, `filings`, `me` and `alert-users`. 4.x (`/v2`) and 3.x (old v1) call deleted routes and get no fixes.

11.3.0 adds all nine US macro reads with plugin 0.20.0. The single Macro docs tag supplies the generated group help. History accepts the public series ID as a positional or `--series`, and table output includes the appropriate change field. The CLI pins API commit `eb6efa3d3923c38bf26ec67cd88da994ef5ec0ed` for this contract.

11.4.0 (published 2026-11-25) adopts Data API 11.2 with plugin 0.21.0 (134 operations, additive): `insider-trades holdings`, `--owner` on `insider-trades list` (company optional; one of the two required), `metrics vintages` (ONE company: `SINGLE_SUBJECT`), `catalog exchanges|sectors`, `financials --metrics`. No new `meta.reason` (the vintages 404 states its reason in the problem detail). The bundle is the released API commit `082fb6c` (SDK 11.2.0, Fly v185); its base revision field reads `65446951fc2a273962f6be7401b96f0ffaa30156` (the merge of the 11.2 code).

Plugin 0.22.0 (with the next patch publish, 11.4.1; no command changed) replaces the six `claude-plugin/commands/*.md`
by skills: the ten skills of `invinite-data-api` `src/skills/` (vendored, see below) + this repository's CLI-only skill
`invinite-data-cli`; `invd plugin install` copies skill folders.

11.4.2 (not yet published) adopts Data API 11.4 (bundle of API commit `65c52a5`, spec sha256 `b60f0f4a…`, base revision
`c1f58457`; plugin stays 0.22.0, no command changed): 11.3 adds `edgar` to the insider trade / holding `source` enum (a
response field, no parameter), 11.4 adds the optional Event fields `capture_mode` (`live` | `replay`) and
`awaiting_replay`. Neither has an `x-cli` column: `invd events list|get` print the same table / key-value view and
accept the two fields only through `--fields` / `--json <fields>`.

11.5.0 (published 2026-11-26) adopts Data API 11.5 with plugin 0.23.0 (136 operations, additive; backend
`tasks/financialdatasets-parity/2-ownership-forms` task 4): the new group `ownership` (tag `Ownership`, its own
`GROUP_DESCRIPTIONS` line) with `ownership beneficial` (Schedule 13D / 13G; `--filer` / `-f`, `--type` / `-t`,
`--current` / `--no-current`) and `ownership sale-notices` (Form 144; `--owner` / `-o`). No new `meta.reason`. The
vendored `ownership-review` skill and `invinite-financial-data/references/ownership.md` name both routes. The bundle is the released API commit `c39e99e` (SDK 11.5.0, examples captured; its base revision field reads `e6a5ef58`); it also vendors #54's `alert-setup` sentence.

12.0.0 adopts Data API 12.0 with plugin 0.24.0 (BREAKING; invinite-data-api `tasks/directory-listed-default` task 5):
`--is-active` takes `true|false|all` (commander `choices`; default listed today, the API's — the CLI sends nothing
without the flag), also on `funds list`; `--no-is-active` is gone (no alias: `--is-active false` replaces it);
`companies get` without `is_delisted`; `people list` without call operators unless `--include-operators`. The vendored
`invinite-financial-data` `SKILL.md` and `references/earnings-calls.md` follow. The bundle is the released API commit
`d541344` (tag `data-sdk-v12.0.0`, SDK 12.0.0, Fly v193; spec sha256 `14aba1a4…`, its base revision field reads
`0e29760f`).

12.1.0 (published 2026-11-26) adopts Data API 12.1 with plugin 0.25.0 (139 operations, additive; backend
`tasks/financialdatasets-parity/3-earnings-extraction` task 6): `guidance non-gaap` (`--event` / `-e`, `--metric` /
`-m`, `--period-kind`, `--period-end-*`), `guidance kpi-series` (`--kpi` / `-k`, `--segment`, `--period-*`),
`catalog kpis` (`--sector` / `-s`) and `--qualitative` / `--no-qualitative` on `guidance list`. No new `meta.reason`,
no new group (the `guidance` and `catalog` descriptions come from the API's tag descriptions). The vendored
`analyze-earnings-call` skill and `invinite-financial-data/references/earnings-calls.md` name the routes. The bundle is the released API commit `f196ad7` (tag `data-sdk-v12.1.0`, SDK 12.1.0, Fly v195; spec sha256 `55a3697a…`, its base revision field reads `7509d1de`); it also carries the additive `FundListItem.is_active` → an `is_active` column on `funds list`.

12.2.0 adopts Data API 12.2 with plugin 0.26.0 (145 operations, additive over 12.1; backend `tasks/sec-bulk-downloads` task 7): the group
`bulk` (tag `Bulk data`, its own `GROUP_DESCRIPTIONS` line; Enterprise, 0 credits) — `files`, `download`, `export`,
`exports`, `export-status`, `export-download`. The builder marks a download object that states `expires_at` as
`signedDownload` (only `BulkDownload`): its URL is hidden in every rendered format (`withHiddenUrl`,
`<hidden: valid until …>`), `--print-url` prints it and downloads nothing, and a 403 from the file host asks the
operation once more (a second download count) before failing. A download object that states `filename`
(`downloadNamed`, today only `BulkDownload`) also gets `--out <dir>` (that name, reduced by `safeFileName`; an answer
without a usable one is refused) beside `--save`. `export --wait` is hand-written
behaviour on the generated command (`src/job-wait.ts` `JOB_WAITS`: the job's read and download operations; 10 s
backing off to 60 s, any status but `queued` / `running` ends it, three 429 / 5xx / network failures in a row end it;
the job id goes to stderr first, and Ctrl-C or a failure prints the resume commands); `--save` / `--out` on `export`
need `--wait` (an existing `--save` target is refused before the job is created). A job that ends without a file
throws `JobEndedError` (`failed` / unknown → exit 1, `expired` → 3 like the API's 404 for an expired download;
`tests/unit/commands/bulk-exit-codes.test.ts` checks the real process). `REASON_LABELS` + `SCOPE_LABELS` word an export's `coverage.reason` / `coverage.scope`
(`jobCoverageNote`, stderr). The bundle is the released API commit `7a9eca9` (tag `data-sdk-v12.2.0`, SDK 12.2.0, Fly v198;
spec sha256 `ed91cd90…`, its base revision field reads `6b73f048`); it also carries 12.1's patch #69 (`period_kind`
validated on `guidance non-gaap` / `kpi-series`, description fixes; no flag change).

12.4.0 adopts Data API 12.4 (tag `data-sdk-v12.4.0`, reference `c960c8a`, Fly v202) with plugin 0.28.0. The 145 operations retain their CLI grammar. `invd news list` without a scope returns the seven-day market window. News and transcript search accept a company list, and each returns a single ranked page of up to eight passages. The 12.4 bundle and exported CLI reference supersede the earlier pins for new installs.

12.3.0 adopts Data API 12.3 with plugin 0.27.0 (145 operations, additive over 12.2; invinite-data-api
`tasks/market-wide-filings-list` task 5): `invd filings list [symbol...]` takes no symbol (`required: false` from the
parameter, no CLI code: the newest filings of every filer, the last 7 days by default, `--filed-at-gte` /
`--filed-at-lte` move the window, at most 7 days); its table gains the contract column `filer.name` (a null filer or
name prints `—`, an empty cell in `--plain`); `symbol` on `filings list` / `filings search` also takes any filer's CIK
and an open IPO registration's proposed ticker; `ipos list --stage` takes `dormant`. The vendored `analyze-filing`
skill and `invinite-financial-data` `SKILL.md` / `references/filings.md` follow. The bundle is the released API commit
`ac46ec5` (tag `data-sdk-v12.3.0`, SDK 12.3.0, Fly v199; spec sha256 `9e56b323…`, its base revision field reads
`0b012bff`).

## Changes in 13.0.0

CLI 13.0.0 / plugin 0.29.0 adopt the exact API `data-sdk-v13.0.0` reference bundle at
`96c33cb7432fca54c81e838e2545150e5a59006f` (spec sha256 `c1ce8fa33639c84752524dd5c190ce1f7a6b4d8b1c814e5f1b2ef4ac99b861d6`).
The bundle includes 12.4 news/search behavior. The manifest builder resolves the per-type create branches and PATCH's
typed branches plus settings, stores per-type fields/required paths/examples and computes condition/trigger
name collisions across all branches. Structured objects and arrays of objects are JSON flags; nested required paths
include array items. Response union fields are the intersection of branch properties; discriminator values supply
`alert-events tail`'s six feed filters. The four alert catalogs are generated `x-cli` commands.

`src/spec-body.ts` owns body construction and typed help. Raw-only JSON reaches server validation unchanged.
Mixed flags retain all raw fields, override their named paths and validate against the effective type. A condition
edit without a type first GETs the stored alert; explicit types and settings-only writes need no lookup.
Dry-run never performs this lookup and asks for explicit `--type`. All 23 spec examples round-trip through actual
registered flags in `tests/unit/spec-alerts.test.ts`; preserve that check when extending alert schemas.

## Commands come from the Data API's spec, not from this repo

Every plain command — one REST call, printed as a table, a key/value list or JSON — is GENERATED. The chain:

```
../invinite-data-api  spec/openapi.contract.json x-cli { group, action, positional?, columns?, flags?, command?, select? }
  → reference bundle (reference/openapi.json + api-contract.json), copied byte for byte here
  → pnpm cli:manifest → src/generated/cli-manifest.json (committed; /v1 operations only)
  → src/spec-commands.ts registers each operation as `invd <group> <action>`
```

- **To add or change a command**: change `x-cli` in `../invinite-data-api` (the frozen v2 spec), export its reference
  bundle there, copy `openapi.json` + `api-contract.json` here, run `pnpm cli:manifest`. Never hand-write a command for
  a one-call operation.
- **`pnpm cli:manifest:check` is the drift gate**: it fails when the committed manifest is not what `openapi.json`
  produces (the manifest carries the spec's sha256).
- The builder DERIVES what v2 `x-cli` does not state: a list = a response with `data` + `next_cursor` (→ `--all`,
  `--cursor`, JSONL / CSV rows); the view (list + `columns` → table, object + `columns` → key/value, else JSON); body
  flags from the request schema's scalar / list properties one object deep (`--ciks` → `filters.ciks`); a header
  parameter as a flag (`--idempotency-key`); a download object (`{url, sha256 | bytes}` at the root or one level down
  → `--save <file>`; one stating `filename` also `--out <dir>`; one stating `expires_at` is a signed download → URL
  hidden, `--print-url`, one refetch on a 403). Groups spanning several tags (or sharing one) take `GROUP_DESCRIPTIONS`; a spec alias commander
  owns is dropped only through `DROPPED_ALIASES` (both in `scripts/build-cli-manifest.ts`, proposals D7 / D8 of
  `backend/tasks/data-api-v2/10-cli-v4.md`).
- Flags are the parameter names, `_` / `.` → `-` (`filed_at.gte` → `--filed-at-gte`), booleans get `--x` / `--no-x`.
  `x-cli.positional` names the first positional: a company on company lists and a symbol on symbol lists (several
  words → `company=A,B` / `symbol=A,B`; `SINGLE_SUBJECT` in the builder keeps `invd holders` at ONE symbol), `q` on
  searches (words joined by a space), the member id on member routes. A non-variadic positional refuses a second word
  (`allowExcessArguments(false)`), it is never dropped. Every `event_id` command also takes
  `<company> <YYYYQn>` and resolves the event through `GET /v1/events` (said on stderr). A group's `list` is its
  default subcommand (`invd filings AAPL` = `invd filings list AAPL`).
- `x-cli.command` + `select` make ONE command over several operations: `invd financials` picks one of six by
  `--basis` × `--view`; a flag only some of them have is refused on the others. `IMPLIED` in `src/spec-commands.ts`
  fills the spec-required `period` there (proposal D10).
- The program uses positional options: every data command carries its own output / paging / metering flags
  (`src/output/options.ts`: `--json [fields]`, `--output`, `--jq`, `--plain`, `--fields`, `--all`, `--dry-run`, `--yes`,
  `--no-input`, `--show-cost`), so an operation's own `--version` never meets the root's.
- `--all` walks `next_cursor` / `Link rel="next"` (`src/client/pagination.ts`); a page refused with 429 / 503 is retried
  after its `Retry-After` (`PAGE_RETRY`, bounded); a failure after written rows is exit 7 with the resume cursor, Ctrl-C
  prints the same cursor (`resumeOnInterrupt`) and exits 130.
- An operation whose spec `security` is empty sends no key (`auth: false` in the manifest).

## The hand-written ROSTER

`src/hand-written-commands.ts` lists the commands that are NOT one call plus one view (`api`, `auth`, `config`,
`plugin`, `agent-setup`, `completion`), each with its reason. `tests/unit/command-roster.test.ts` fails on a
hand-written command missing from it, on a stale entry, on an entry that is also a manifest operation, and on a tree
that differs from the v2 groups + the roster. There is no WebSocket command in 4.0 (`WS /v1/stream` has no `x-cli`).

## Output, errors, exit codes

- Data to stdout (table on a terminal, tab-separated when piped, or JSON / JSONL / CSV); progress, cost, the
  `meta.coverage` note (`pending` / `partial`), confirmations and hints to stderr. A hand-written command prints only
  the value it was asked for on stdout (`config get / list / path`, `auth token`, `auth status`). `NO_COLOR` / `FORCE_COLOR`; human output longer
  than the terminal goes through `INVD_PAGER` / `PAGER`.
- `REASON_LABELS` (`src/spec-commands.ts`) words every `meta.reason` of the contract on the stderr source header (a test
  reads the enums from `openapi.json`: a new value fails until it has a label).
- Errors are RFC 9457 problems: `ApiError` keeps `title`, `detail`, `code` and the whole body. `printError` prints at
  most three lines (C2): `✗ <detail>  (<code>)` (one per `errors[]` item, max 5), the remedy (`apiErrorHint`'s `invd`
  command for `unauthorized` / 401, `plan_required`, `insufficient_credits`, else the body's `remedy`; `not_covered` uses the API remedy with a company-search fallback),
  then `request_id  ·  docs_url`; never the HTTP status; `Error:` for `✗` under `NO_COLOR` / `TERM=dumb`. `--json`
  adds the body as one JSON line on stderr. Exit codes (`EXIT` in `src/shared/errors.ts`, shared with `inv`): 0 ok, 1
  refused / failed, 2 usage (commander errors via `bin/invd.ts`, `UsageError`, problem codes `invalid_parameter` /
  `unknown_parameter` / `cursor_mismatch`, a needed answer under `--no-input`), 3 not found (`not_found`,
  `not_covered`, 404), 4 auth (no key, 401, `unauthorized` / `forbidden`), 5 integrity, 6 credits / plan (402,
  `plan_required`, `insufficient_credits`), 7 partial (an `--all` cut by a failure, short download).
- Interrupts: `src/shared/signals.ts` is the one SIGINT / SIGTERM handler (`installSignalExit` in `bin/invd.ts`): it stops
  the spinners, runs the cleanups registered with `onInterrupt` (download `.part` removal, `auth login` server, walk
  resume line) and exits 130 / 143. Never add a `process.on('SIGINT')` elsewhere.
- Prompts: `confirmOrRefuse` (`--yes` / `--no-input`) and `promptInteractive` (`plugin`, `agent-setup`) refuse with exit
  2 naming the flags that answer them under `--no-input` or without a terminal.
- Downloads go through `saveVerified` (`src/client/download.ts`): `.part` + rename after the size / SHA-256 / media
  type checks; files are fetched keyless from their stated `url` (public, or a short-lived signed one; a non-2xx is a
  `DownloadStatusError` carrying the status).

## Config and keys

`src/config/config-manager.ts`: `$XDG_CONFIG_HOME/invinite/invd.toml` (`~/.config/invinite`, `%APPDATA%\invinite`;
`INVD_CONFIG_DIR` replaces the directory; `vitest.config.ts` sets it, and `tests/setup.ts` gives every test file a
temporary home, XDG roots and working directory — `tests/unit/shared/test-home.test.ts` guards it), `./.invd.toml` (`--local`), precedence flags > env >
local > global; flat TOML only (`src/config/toml.ts`). The directory is shared with the Web CLI `inv`
(`config.json`): invd reads, writes and deletes only `invd.toml` there and never removes the directory. An older
install is carried over once (5.x / 4.x `invd/config.toml`, else the 3.x `conf` JSON from its platform path, never
from `INVD_CONFIG_DIR`), old file kept, one stderr line. Keys (`src/config/auth.ts`): `INVD_API_KEY` >
`INVINITE_DATA_API_KEY` > `./.env` (either name) > keychain (optional `keytar`) > `invd.toml api_key` (never a project
file). A project file's `base_url` must be a loopback host and `invd api` refuses an absolute URL off the API origin:
nothing a cloned repository or a pasted URL holds may send the key to another host. The update notice (`src/update-notifier.ts`) checks npm once a day — never in CI, under vitest, without a
terminal on stderr, or with `INVD_NO_UPDATE_NOTIFIER`.

## The plugin's skills: vendored, generated, gated

- **The ten Data skills are vendored, never hand-edited.** `invinite-data-api` `src/skills/` (served by its MCP
  server, guarded there against the tool roster) is the source of `claude-plugin/skills/<name>/` for every folder but
  `invinite-data-cli`. Only `pnpm skills:import -- --from ../invinite-data-api --rev <committed sha>`
  (`scripts/import-skills.ts`) writes them: it reads the revision with `git ls-tree` / `git show` (never the API's
  working tree), appends one footer line to each vendored `SKILL.md` (the only CLI mention in them), drops a folder the
  revision no longer has, and writes `reference/data-skills.pin.json` (repository, 40-hex revision, per file the sha256
  of the source and of the written bytes). `pnpm skills:import:check` (CI) recomputes the written hashes and fails on a
  hand edit, an unpinned file or folder, or a pin from another repository. Adopting a new API revision = commit there,
  `skills:import`, commit the plugin, then `reference:export` (the plugin snapshot also hashes the pin).
- **The CLI skill** `claude-plugin/skills/invinite-data-cli/SKILL.md` (`name: invinite-data-cli` = its folder,
  `allowed-tools: Bash(invd *)`) holds only CLI facts: transport selection, the MCP ↔ CLI mapping table,
  prerequisites, grammar, output / pagination flags, CLI-only specifics (financials flags, chartlang upload, batch,
  `--save`), common patterns and tips. The data rules live in the vendored `invinite-financial-data`, in MCP tool terms.
- **Its command block** lives in `claude-plugin/skills/invinite-data-cli/references/commands.md`, between
  `<!-- invd:commands:start -->` … `end`, written by `pnpm skill:commands` (`scripts/build-skill-commands.ts`) from the
  manifest + the roster; `skill:commands:check` and a test cell fail on drift. Edit only inside an
  `<!-- invd:hand:<command> -->` block (one per roster entry, carried over verbatim); the prose around the block is
  hand-written. Each example is the second `--help` example of `src/examples.ts` (positional + required flags + the
  spec's `x-example-params`, valued with the spec's parameter `example`s); `invd financials` appears once for its six
  operations.
- `tests/unit/doc-commands.test.ts` resolves every `invd …` line (fenced, or an inline code span) of `README.md`, the
  agent and every `.md` under `claude-plugin/skills/` against `createProgram()` (default subcommands and variadic
  positionals included): an unknown command, flag or stray positional fails. `invinite`'s docs read this repo only
  through its committed snapshot (`pnpm reference:export`, rerun after a command change).
- **The installer** (`src/commands/plugin.ts`, also `agent-setup`): `installPlan` walks `claude-plugin/skills/` once and
  both `install` and `installedPaths` (what `uninstall` removes) read it. Claude / Codex / Copilot get the eleven
  folders (byte-equal; Codex / Copilot drop only the CLI skill's `allowed-tools`); OpenCode (global only) gets
  `command/invinite-data-cli.md` (the CLI skill with `references/commands.md` appended) and
  `command/analyze-earnings-call.md` (its footer pointing at the `/invinite-data-cli` command) plus the agent. Uninstall
  prunes emptied folders below the runtime's directory, never the directory itself. `LEGACY_PATHS` lists the exact files plugin 0.21.0 wrote and this
  one no longer ships (removed on install and uninstall; never a glob).
- **Dev links**: `.claude/skills/<name>` are directory links into `claude-plugin/skills/`; `.codex/skills/`,
  `.cursor/skills/`, `.agent/skills/` link to `.claude/skills/<name>`. A dangling link fails nothing in CI: check with
  `find -L . -type l -not -path './node_modules/*'` (prints only dangling links).

## Traps

- `pnpm build` wipes `dist/` first — `tsc` never deletes the output of a removed source file, and `files: ["dist"]`
  would publish it.
- `src/generated/cli-manifest.json` is copied into `dist/` by `scripts/copy-manifest.mjs` (`tsc` copies no JSON).
- Breaking command names are allowed pre-release: no alias commands.
- Publishing is by hand, no CI: the gitignored `.npmrc` reads `${NPM_ACCESS_TOKEN}`, which `export $(cat .env | xargs)`
  supplies (`~/.npmrc`'s token is stale). `publish:version` bumps PATCH — a breaking command surface sets the version
  explicitly (`pnpm version X.Y.0 --no-git-tag-version`) and publishes with `pnpm publish --access public`. A 3.x fix
  publishes from the `cli-3.x` branch with `--tag v3-maintenance` so it never becomes `latest`.
- The plugin identity snapshot (`reference/data-plugin-identity.snapshot.json`) refuses uncommitted plugin edits: commit
  the plugin files first (a skills import included), then `pnpm reference:export`, then commit the snapshot.

## Versioned reference exports

`pnpm reference:export` exports Commander registration and plugin packaging into
`reference/` using ONLY this repository's source and its pinned `openapi.json`.
`reference:check` rechecks source/spec hashes, fingerprints and registration without
authentication, network requests or sibling source. Source introspection safety
and freshness tests belong here. `.github/workflows/check.yml` checks the manifest,
skill, references, tests and build, and uploads an immutable SHA-named reference
bundle for frontend docs consumption. Consumers import it without reading CLI source.
The plugin export checks that its download revision really contains the hashed
source: commit plugin edits before exporting a changed immutable plugin download.
CLI packaging/release remains this repo's `build`/`prepublishOnly`/`publish:version`
flow and npm credential; never reintroduce frontend command generation.

Adopt API contracts from a versioned `invinite-data-api` reference bundle: copy its
`openapi.json` AND `api-contract.json` together (`check-api-contract.mjs` checks their
identity and provenance), run `cli:manifest`, `skill:commands`, `reference:export`, then the
corresponding `:check` commands and mocked tests. The reference records exact API
spec identity, CLI version, checkout base revision and source hashes.


Events/alerts CLI release preparation: Data API/SDK 13.4.0 is published and the exact released e5 bundle adds
insider_trade, holder_change, ipo_stage, beneficial_ownership and insider_sale_notice. The manifest supplies the
strict fields and examples; workflows and body help describe their scope and minimum tiers. The normal skills
import is pinned to `e5c69dcfb50c9a1958225faf3f4ad4b0983877a3`. CLI 13.4.0 and plugin 0.32.0 are reversible
source version updates until their coordinated publication. Commit plugin source before `reference:export`;
candidate generation alone is not CLI/plugin publication evidence.
