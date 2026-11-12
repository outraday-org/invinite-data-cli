/**
 * The commands `invd` writes by hand, each with WHY it is not one REST call plus one view. Every other command is
 * generated from the manifest (`src/spec-commands.ts`); `tests/unit/command-roster.test.ts` fails on a hand-written
 * command missing here, on an entry that registers nothing, and on an entry that is also a manifest operation.
 * An entry is a top-level command (covering its subcommands).
 */
export const HAND_WRITTEN_COMMANDS = [
  { command: 'api', reason: 'raw access to any spec path (method, -F fields, --paginate, --jq): the escape hatch when the tree lags the spec' },
  { command: 'auth', reason: 'browser sign-in (loopback or pasted redirect), the local key store, status / token / logout' },
  { command: 'config', reason: 'local settings in invd.toml / ./.invd.toml' },
  { command: 'plugin', reason: 'copies the bundled agent plugin (skill, agent, commands) into agent config dirs' },
  { command: 'agent-setup', reason: 'writes the MCP connector config and installs the skill in one step' },
  { command: 'completion', reason: 'prints the bash / zsh / fish completion script generated from the command tree and spec paths' },
] as const;
