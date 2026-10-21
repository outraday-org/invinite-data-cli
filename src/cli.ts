import { createRequire } from 'node:module';
import { Command } from 'commander';
import { setJsonMode } from './shared/spinner.js';
import { formatCreditUsage, takeCreditUsage } from './client/api-client.js';
import { registerConfigCommands } from './commands/config.js';
import { registerHealthCommand } from './commands/health.js';
import { registerCompanyCommands } from './commands/company.js';
import { registerFinancialsCommands } from './commands/financials.js';
import { registerMetricsCommands } from './commands/metrics.js';
import { registerSegmentsCommands } from './commands/segments.js';
import { registerIposCommands } from './commands/ipos.js';
import { registerOwnershipCommands } from './commands/ownership.js';
import { registerInsiderTradesCommands } from './commands/insider-trades.js';
import { registerFilingsCommands } from './commands/filings.js';
import { registerEarningsCommands } from './commands/earnings.js';
import { registerMarketCommands } from './commands/market.js';
import { registerMetadataCommands } from './commands/metadata.js';
import { registerWebhooksCommands } from './commands/webhooks.js';
import { registerWsCommands } from './commands/ws.js';
import { registerPluginCommands } from './commands/plugin.js';
import { registerLoginCommands } from './commands/login.js';
import { registerUsageCommands } from './commands/usage.js';
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

  registerConfigCommands(program);
  registerHealthCommand(program);
  registerCompanyCommands(program);
  registerFinancialsCommands(program);
  registerMetricsCommands(program);
  registerSegmentsCommands(program);
  registerIposCommands(program);
  registerOwnershipCommands(program);
  registerInsiderTradesCommands(program);
  registerFilingsCommands(program);
  registerEarningsCommands(program);
  registerMarketCommands(program);
  registerMetadataCommands(program);
  registerWebhooksCommands(program);
  registerWsCommands(program);
  registerPluginCommands(program);
  registerLoginCommands(program);
  registerUsageCommands(program);

  // Generated from the spec — only for groups no hand-written file above registered.
  registerSpecCommands(program, loadManifest(), { skipGroups: program.commands.map(command => command.name()) });

  return program;
}
