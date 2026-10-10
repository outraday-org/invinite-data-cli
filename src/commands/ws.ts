import { Command } from 'commander';
import { connectWebSocket } from '../client/websocket-client.js';
import { parseSinceSeq, parseTarget } from '../client/earnings-live.js';
import { withErrorHandling } from '../shared/errors.js';

export function registerWsCommands(program: Command): void {
  const ws = program
    .command('ws')
    .description('WebSocket streaming');

  ws
    .command('listen')
    .description('Listen to real-time SEC filing stream, or with --earnings follow a live earnings call transcript')
    .option('--earnings <event_id|cik>', 'Follow a live earnings call transcript (PRO): event ID (UUID) or CIK')
    .option('--since-seq <n>', 'Replay finals after this seq (default -1 = the whole call so far)')
    .option('--partials', 'Show interim segments, overwritten in place (terminal only; --json emits them)')
    .option('--names', 'Print each speaker-name snapshot')
    .action(withErrorHandling(async (cmdOpts) => {
      if (!cmdOpts.earnings) {
        if (cmdOpts.sinceSeq !== undefined || cmdOpts.partials || cmdOpts.names) {
          throw new Error('--since-seq, --partials and --names need --earnings');
        }
        await connectWebSocket();
        return;
      }
      await connectWebSocket({
        earnings: {
          target: parseTarget(cmdOpts.earnings),
          sinceSeq: parseSinceSeq(cmdOpts.sinceSeq),
          partials: Boolean(cmdOpts.partials),
          names: Boolean(cmdOpts.names),
          json: Boolean(program.opts().json),
        },
      });
    }));
}
