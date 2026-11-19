import { createRequire } from 'node:module';
import { Command } from 'commander';
import { formatCreditUsage, takeCreditUsage } from './client/api-client.js';
import { registerAgentSetupCommand } from './commands/agent-setup.js';
import { registerAlertEventsTailCommand } from './commands/alert-events.js';
import { registerApiCommand } from './commands/api.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerCompletionCommand } from './commands/completion.js';
import { registerConfigCommands } from './commands/config.js';
import { registerPluginCommands } from './commands/plugin.js';
import { registerScriptsUploadCommand } from './commands/scripts.js';
import { DASHBOARD_URL } from './config/config-manager.js';
import { applyColorEnv } from './output/render.js';
import { registerSpecCommands } from './spec-commands.js';
import { parseManifest, type Manifest } from './spec-manifest.js';
import { runUpdateNotifier } from './update-notifier.js';

const PACKAGE_NAME = '@invinite-org/invinite-data-cli';

/** `package.json` sits one level up under tsx (`src/cli.ts`), two in the build (`dist/src/cli.js`). */
export function packageVersion(): string {
  const requireJson = createRequire(import.meta.url);
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const pkg = requireJson(candidate) as { name?: string; version?: string };
      if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version;
    } catch {
      // not at this level
    }
  }
  return '0.0.0';
}

let manifest: Manifest | undefined;

/**
 * The committed command manifest, parsed once. Resolved next to this file: `src/generated/` under tsx,
 * `dist/src/generated/` in the build (`scripts/copy-manifest.mjs` puts it there — `tsc` copies no JSON).
 */
export function loadManifest(): Manifest {
  manifest ??= parseManifest(createRequire(import.meta.url)('./generated/cli-manifest.json'));
  return manifest;
}

/** The eight commands `invd --help` lists first. */
export const TOP_COMMANDS: ReadonlyArray<[string, string]> = [
  ['invd instruments get TQQQ', 'what a ticker is (stock, ETF, closed-end fund, ETN) and what is served for it'],
  ['invd financials AAPL --period quarterly --limit 4', 'statements (standardized / as-reported; --view detailed)'],
  ['invd companies get AAPL', 'company profile (a fund: invd funds get SPY)'],
  ['invd filings AAPL --form 10-K', 'SEC filings'],
  ['invd events transcript AAPL 2026Q3', 'a call transcript by fiscal period'],
  ['invd funds holdings SPY', 'a fund\'s holdings (also weights)'],
  ['invd holders NVDA --source 13f', 'who holds a stock or a fund (13f, nport, issuer_file)'],
  ['invd search filings "supply chain risk" --symbol AAPL', 'full-text search (also transcripts, news)'],
];

/**
 * The command groups invd 8.0 removed (Data API 7.0) → what replaces them. Commander's own suggestion only names a
 * similar existing command, so an unknown-command error naming one of these gets the replacement instead.
 */
export const REMOVED_COMMANDS: Readonly<Record<string, string>> = {
  holdings: 'invd holders <symbol> --source 13f (who holds it), invd filers holdings <cik> (a manager\'s portfolio)',
  'fund-holdings': 'invd funds holdings <fund> (what a fund holds), invd holders <symbol> --source nport (the funds holding it)',
  'etf-holdings': 'invd funds holdings <fund> (what a fund holds), invd holders <symbol> --source issuer_file (the ETFs holding it)',
  'etf-weights': 'invd funds weights <fund>',
};

/** Commander's unknown-command error with the replacement of a removed command instead of its similar-name guess. */
export function withRemovedCommandHint(text: string): string {
  const match = /unknown command '([^']+)'/.exec(text);
  const replacement = match?.[1] ? REMOVED_COMMANDS[match[1]] : undefined;
  if (!replacement || !match?.[1]) return text;
  const head = text.replace(/\n?\(Did you mean [^)]*\)\??/, '').trimEnd();
  return `${head}\n\`invd ${match[1]}\` was removed in invd 8.0 (Data API 7.0). Use: ${replacement}\n`;
}

function topHelp(): string {
  const width = Math.max(...TOP_COMMANDS.map(([command]) => command.length));
  return [
    'Most used:',
    ...TOP_COMMANDS.map(([command, what]) => `  ${command.padEnd(width)}  ${what}`),
    '',
    'Output: table on a terminal, tab-separated when piped; --json [fields], --output json|jsonl|csv, --jq, --all.',
    `Docs: ${DASHBOARD_URL}/docs/cli · keys and usage: ${DASHBOARD_URL}`,
    '',
  ].join('\n');
}

const EXIT_HELP = '\nExit codes: 0 ok · 1 refused / failed · 2 usage · 3 not found · 4 auth required · 5 integrity · 6 credits / plan · 7 partial · 130 / 143 interrupted\n';

export function createProgram(): Command {
  const program = new Command();
  applyColorEnv();

  program
    .name('invd')
    .description('CLI for the Invinite financial data API (v1)')
    .version(packageVersion(), '-V, --version')
    // Root options only before the subcommand: an operation's own `--version` (a transcript version) is its own.
    .enablePositionalOptions()
    .configureHelp({ sortSubcommands: true })
    .showSuggestionAfterError()
    // Inherited by every command registered below: a removed 7.x command names its 8.0 replacement.
    .configureOutput({ outputError: (text, write) => write(withRemovedCommandHint(text)) })
    // Inherited by every command registered below: commander's usage errors become exit code 2 (bin/invd.ts).
    .exitOverride()
    .addHelpText('beforeAll', (context) => (context.command === program ? topHelp() : ''))
    .addHelpText('after', EXIT_HELP)
    .hook('postAction', async (_thisCommand, actionCommand) => {
      // Always drained, so a long-lived program never carries one command's cost into the next.
      const usage = takeCreditUsage();
      if (usage && (actionCommand.opts().showCost || process.env.INVD_SHOW_COST === '1')) console.error(formatCreditUsage(usage));
      await runUpdateNotifier(packageVersion());
    });

  registerAuthCommands(program);
  registerConfigCommands(program);
  registerPluginCommands(program);
  registerAgentSetupCommand(program);
  registerApiCommand(program);
  registerCompletionCommand(program, () => [...new Set(loadManifest().operations.map(operation => operation.path))].sort());
  registerSpecCommands(program, loadManifest());
  registerAlertEventsTailCommand(program);
  registerScriptsUploadCommand(program);

  return program;
}
