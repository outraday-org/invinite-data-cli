# invinite-data-cli (`invd`)

## Commands come from the Data API's spec, not from this repo

Every plain command — one REST call, printed as a table, a key/value list or JSON — is GENERATED. The chain:

```
../invinite-data-api  route schema x-cli { group, action, view?, columns?, rowsPath?, flags?, allItemsPath? }
  → gen:openapi → openapi.json, copied byte for byte here (and to invinite/files/openapi.json)
  → pnpm cli:manifest → src/generated/cli-manifest.json (committed)
  → src/spec-commands.ts registers each operation as `invd <group> <action>`
```

- **To add or change a command**: author `x-cli` on the route in `../invinite-data-api`, regenerate and deploy the
  spec there, copy `openapi.json` here, run `pnpm cli:manifest`. Never hand-write a command for a one-call operation.
- **`pnpm cli:manifest:check` is the drift gate**: it fails when the committed manifest is not what `openapi.json`
  produces (the manifest carries the spec's sha256).
- Flags derive from parameter names (`company_name` → `--company-name`, path parameters are flags too, never
  positional); `x-cli.flags` only adds a one-letter alias. Help text is the spec's `summary` / parameter description.
- `--all` follows `next_url` (`pagination: top`) or `companies[0].next_url` merged per company (`perCompany`), both
  derived from the response schema — never a per-command merge. A page refused with 429 / 503 is retried after its
  `Retry-After` (`PAGE_RETRY` in `src/client/pagination.ts`, bounded) — a long walk meets the API's admission limit.
- An operation whose spec `security` is empty (`health`, `status …`) sends no key (`auth: false` in the manifest).

## The hand-written ROSTER

`src/hand-written-commands.ts` lists the few commands that are NOT one call plus one view (login, local config,
plugin install, the WebSocket stream, the earnings downloads / text renders in `src/commands/earnings.ts`), each with
its reason. `tests/unit/command-roster.test.ts` fails on a hand-written command missing from it, on a stale entry and on
an entry that is also a manifest operation. A rostered `group action` may share its group with generated actions
(`earnings`): the roster registers first and the dispatcher attaches to the existing group; commander refuses a
duplicate name. The spec marks such an operation `x-cli.exclude` naming the hand-written command.

## The skill's command block and the docs' spellings are generated / gated

- `claude-plugin/skills/invinite-data-cli/SKILL.md`'s `<!-- invd:commands:start -->` … `end` block is written by
  `pnpm skill:commands` (`scripts/build-skill-commands.ts`) from the manifest + the roster; `skill:commands:check` and a
  test cell fail on drift. Edit only inside an `<!-- invd:hand:<command> -->` block (one per roster entry, carried over
  verbatim); the prose around the block is hand-written. Each example line passes the required flags plus the spec's
  `x-example-params`, valued with the spec's parameter `example`s (`manifest param.example`, `exampleParams`,
  `body.example`; also shown in `--help` as `e.g. …`) — a `<name>` placeholder only where the spec has no example.
- `tests/unit/doc-commands.test.ts` resolves every `invd …` line (fenced, or an inline code span) of `README.md` and
  the plugin's skill, agent and commands against `createProgram()`: an unknown command, flag or stray positional fails. `invinite`'s docs read this repo only
  through its committed snapshot (`pnpm reference:export`, rerun after a command change).

## Traps

- `pnpm build` wipes `dist/` first — `tsc` never deletes the output of a removed source file, and `files: ["dist"]`
  would publish it.
- `src/generated/cli-manifest.json` is copied into `dist/` by `scripts/copy-manifest.mjs` (`tsc` copies no JSON).
- Breaking command names are allowed pre-release: no alias commands.
- Publishing is by hand, no CI: the gitignored `.npmrc` reads `${NPM_ACCESS_TOKEN}`, which `export $(cat .env | xargs)`
  supplies (`~/.npmrc`'s token is stale). `publish:version` bumps PATCH — a breaking command surface sets the version
  explicitly (`pnpm version X.Y.0 --no-git-tag-version`) and publishes with `pnpm publish --access public`.

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
