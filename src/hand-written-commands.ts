/**
 * The commands `invd` writes by hand, each with WHY it is not one REST call plus one view. Every other command is
 * generated from the manifest (`src/spec-commands.ts`); `tests/unit/command-roster.test.ts` fails on a hand-written
 * command missing here, on an entry that registers nothing, and on an entry that is also a manifest operation.
 * An entry is a top-level command (covering its subcommands) or one subcommand of a generated group.
 */
export const HAND_WRITTEN_COMMANDS = [
  { command: 'api', reason: 'raw access to any spec path (method, -F fields, --paginate, --jq): the escape hatch when the tree lags the spec' },
  { command: 'auth', reason: 'browser sign-in (loopback or pasted redirect), the local key store, status / token / logout' },
  { command: 'config', reason: 'local settings in invd.toml / ./.invd.toml' },
  { command: 'plugin', reason: 'copies the bundled agent plugin (skill folders, agent) into agent config dirs' },
  { command: 'agent-setup', reason: 'writes the MCP connector config and installs the plugin skills in one step' },
  { command: 'completion', reason: 'prints the bash / zsh / fish completion script generated from the command tree and spec paths' },
  { command: 'alert-events tail', reason: 'polls the alert-events pull feed (after=<last event id>) until interrupted and prints each new event as NDJSON' },
  { command: 'scripts upload', reason: 'reads a local chartlang file into createScript / createScriptVersion and turns a compile error (a 201 with status error) into its diagnostics and exit 1' },
] as const;
