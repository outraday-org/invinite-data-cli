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
  derived from the response schema — never a per-command merge.
- An operation whose spec `security` is empty (`health`, `status …`) sends no key (`auth: false` in the manifest).

## The hand-written ROSTER

`src/hand-written-commands.ts` lists the few commands that are NOT one call plus one view (login, local config,
plugin install, the WebSocket stream, the earnings downloads / text renders in `src/commands/earnings.ts`), each with
its reason. `tests/unit/command-roster.test.ts` fails on a hand-written command missing from it, on a stale entry and on
an entry that is also a manifest operation. A rostered `group action` may share its group with generated actions
(`earnings`): the roster registers first and the dispatcher attaches to the existing group; commander refuses a
duplicate name. The spec marks such an operation `x-cli.exclude` naming the hand-written command.

## Traps

- `pnpm build` wipes `dist/` first — `tsc` never deletes the output of a removed source file, and `files: ["dist"]`
  would publish it.
- `src/generated/cli-manifest.json` is copied into `dist/` by `scripts/copy-manifest.mjs` (`tsc` copies no JSON).
- Breaking command names are allowed pre-release: no alias commands.
