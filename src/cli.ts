import { Command } from 'commander';
import { setJsonMode } from './shared/spinner.js';
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
import { registerMarketCommands } from './commands/market.js';
import { registerMetadataCommands } from './commands/metadata.js';
import { registerWsCommands } from './commands/ws.js';
import { registerPluginCommands } from './commands/plugin.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('invd')
    .description('CLI for the Invinite financial data API')
    .version('0.1.0')
    .option('--json', 'Output raw JSON (pipe-friendly)')
    .option('--all', 'Auto-paginate through all results')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();
      if (opts.json) {
        setJsonMode(true);
      }
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
  registerMarketCommands(program);
  registerMetadataCommands(program);
  registerWsCommands(program);
  registerPluginCommands(program);

  return program;
}
