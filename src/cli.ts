import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setJsonMode } from './shared/spinner.js';
import { formatCreditUsage, takeCreditUsage } from './client/api-client.js';
import { registerConfigCommands } from './commands/config.js';
import { registerEarningsCommands } from './commands/earnings.js';
import { registerLoginCommands } from './commands/login.js';
import { registerPluginCommands } from './commands/plugin.js';
import { registerWsCommands } from './commands/ws.js';
import { registerSpecCommands } from './spec-commands.js';
import { parseManifest, type Manifest } from './spec-manifest.js';

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

export function createProgram(): Command {
  const program = new Command();

  program
    .name('invd')
    .description('CLI for the Invinite financial data API')
    .version(packageVersion())
    .option('--json', 'Output raw JSON (pipe-friendly)')
    .option('--all', 'Auto-paginate through all results')
    .option('--show-cost', 'Print the credits a command cost to stderr (or set INVD_SHOW_COST=1)')
    // Inherited by every group, so rostered and generated commands list alphabetically together.
    .configureHelp({ sortSubcommands: true })
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.json) {
        setJsonMode(true);
      }
    })
    .hook('postAction', (thisCommand) => {
      // Always drained, so a long-lived program never carries one command's cost into the next.
      const usage = takeCreditUsage();
      if (!usage || !(thisCommand.opts().showCost || process.env.INVD_SHOW_COST === '1')) return;
      console.error(formatCreditUsage(usage));
    });

  // The hand-written roster (`src/hand-written-commands.ts`) first, then every manifest operation; a generated
  // `earnings` action attaches to the group `registerEarningsCommands` created.
  registerLoginCommands(program);
  registerConfigCommands(program);
  registerPluginCommands(program);
  registerWsCommands(program);
  registerEarningsCommands(program);
  registerSpecCommands(program, loadManifest());

  return program;
}
