# invinite-data-cli (`invd`)

`invd` 4.x is the CLI of the Data API **v2** (`/v2/*`). `invd` 3.x is the v1 CLI: it stays installable from npm
(`@invinite-org/invinite-data-cli@3`) and is fixed only on a `cli-3.x` maintenance branch cut from `9bbdb29` (the
3.0.0 commit), never from `main`.

## Commands come from the Data API's spec, not from this repo

Every plain command — one REST call, printed as a table, a key/value list or JSON — is GENERATED. The chain:

```
../invinite-data-api  spec/openapi.v2.json x-cli { group, action, positional?, columns?, flags?, command?, select? }
  → reference bundle (reference/openapi.json + api-contract.json), copied byte for byte here
  → pnpm cli:manifest → src/generated/cli-manifest.json (committed; /v2 operations only)
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
  → `--save <file>`). Groups spanning several tags (or sharing one) take `GROUP_DESCRIPTIONS`; a spec alias commander
  owns is dropped only through `DROPPED_ALIASES` (both in `scripts/build-cli-manifest.ts`, proposals D7 / D8 of
  `backend/tasks/data-api-v2/10-cli-v4.md`).
- Flags are the parameter names, `_` / `.` → `-` (`filed_at.gte` → `--filed-at-gte`), booleans get `--x` / `--no-x`.
  `x-cli.positional` names the first positional: a company on company lists (several words → `company=A,B`), `q` on
  searches (words joined by a space), the member id on member routes. Every `event_id` command also takes
  `<company> <YYYYQn>` and resolves the event through `GET /v2/events` (said on stderr). A group's `list` is its
  default subcommand (`invd filings AAPL` = `invd filings list AAPL`).
- `x-cli.command` + `select` make ONE command over several operations: `invd financials` picks one of six by
  `--basis` × `--view`; a flag only some of them have is refused on the others. `IMPLIED` in `src/spec-commands.ts`
  fills the spec-required `period` there (proposal D10).
- The program uses positional options: every data command carries its own output / paging / metering flags
  (`src/output/options.ts`: `--json [fields]`, `--output`, `--jq`, `--plain`, `--fields`, `--all`, `--dry-run`, `--yes`,
  `--no-input`, `--show-cost`), so an operation's own `--version` never meets the root's.
- `--all` walks `next_cursor` / `Link rel="next"` (`src/client/pagination.ts`); a page refused with 429 / 503 is retried
  after its `Retry-After` (`PAGE_RETRY`, bounded); a failure after written rows is exit 3 with the resume cursor.
- An operation whose spec `security` is empty sends no key (`auth: false` in the manifest).

## The hand-written ROSTER

`src/hand-written-commands.ts` lists the commands that are NOT one call plus one view (`api`, `auth`, `config`,
`plugin`, `agent-setup`, `completion`), each with its reason. `tests/unit/command-roster.test.ts` fails on a
hand-written command missing from it, on a stale entry, on an entry that is also a manifest operation, and on a tree
that differs from the v2 groups + the roster. There is no WebSocket command in 4.0 (`WS /v2/stream` has no `x-cli`).

## Output, errors, exit codes

- Data to stdout (table on a terminal, tab-separated when piped, or JSON / JSONL / CSV); progress, cost, the
  `meta.coverage` note (`pending` / `partial`) and hints to stderr. `NO_COLOR` / `FORCE_COLOR`; human output longer
  than the terminal goes through `INVD_PAGER` / `PAGER`.
- Errors are RFC 9457 problems: `ApiError` keeps `title`, `detail`, `code` and the whole body (`--json` prints it as one
  JSON line on stderr). Exit codes (`EXIT` in `src/shared/errors.ts`): 0 ok, 1 failure, 2 usage (commander errors via
  `bin/invd.ts`, `UsageError`, problem codes `invalid_parameter` / `unknown_parameter` / `cursor_mismatch`), 3 partial
  (interrupted `--all`, short download), 4 auth (no key, 401, `unauthorized` / `forbidden`), 5 integrity, 6 credits /
  plan (402, `plan_required`, `insufficient_credits`).
- Downloads go through `saveVerified` (`src/client/download.ts`): `.part` + rename after the size / SHA-256 / media
  type checks; files are fetched keyless from their stated public `url`.

## Config and keys

`src/config/config-manager.ts`: `$XDG_CONFIG_HOME/invd/config.toml` (`INVD_CONFIG_DIR` replaces the directory; the
tests always set it), `./.invd.toml` (`--local`), precedence flags > env > local > global; flat TOML only
(`src/config/toml.ts`). The 3.x `conf` JSON is imported once. Keys (`src/config/auth.ts`): `INVD_API_KEY` >
`INVINITE_DATA_API_KEY` > `./.env` (either name) > keychain (optional `keytar`) > `config.toml api_key` (never a project
file). A project file's `base_url` must be a loopback host and `invd api` refuses an absolute URL off the API origin:
nothing a cloned repository or a pasted URL holds may send the key to another host. The update notice (`src/update-notifier.ts`) checks npm once a day — never in CI, under vitest, without a
terminal on stderr, or with `INVD_NO_UPDATE_NOTIFIER`.

## The skill's command block and the docs' spellings are generated / gated

- `claude-plugin/skills/invinite-data-cli/SKILL.md`'s `<!-- invd:commands:start -->` … `end` block is written by
  `pnpm skill:commands` (`scripts/build-skill-commands.ts`) from the manifest + the roster; `skill:commands:check` and a
  test cell fail on drift. Edit only inside an `<!-- invd:hand:<command> -->` block (one per roster entry, carried over
  verbatim); the prose around the block is hand-written. Each example is the second `--help` example of
  `src/examples.ts` (positional + required flags + the spec's `x-example-params`, valued with the spec's parameter
  `example`s); `invd financials` appears once for its six operations.
- `tests/unit/doc-commands.test.ts` resolves every `invd …` line (fenced, or an inline code span) of `README.md` and
  the plugin's skill, agent and commands against `createProgram()` (default subcommands and variadic positionals
  included): an unknown command, flag or stray positional fails. `invinite`'s docs read this repo only through its
  committed snapshot (`pnpm reference:export`, rerun after a command change).

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
  the plugin files first, then `pnpm reference:export`, then commit the snapshot.

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
