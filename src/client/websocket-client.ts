import { getApiKey } from '../config/auth.js';
import { getBaseUrl } from '../config/config-manager.js';
import chalk from 'chalk';
import {
  initialLiveState,
  isEarningsFrame,
  liveStep,
  subscribeFrame,
  type LiveState,
  type LiveTarget,
} from './earnings-live.js';

export interface EarningsListenOptions {
  target: LiveTarget;
  sinceSeq: number;
  partials: boolean;
  names: boolean;
  /** NDJSON: every earnings frame as one line, nothing else on stdout. */
  json: boolean;
}

/** Close codes of `/v1/ws` that a reconnect cannot fix (bad key, plan, connection limit). */
const PERMANENT_CLOSE_CODES = new Set([4001, 4003, 4029]);

const CLEAR_LINE = '\r\x1b[2K';

export async function connectWebSocket(opts: { earnings?: EarningsListenOptions } = {}): Promise<void> {
  const apiKey = await getApiKey();
  const base = getBaseUrl().replace(/\/+$/, '').replace(/^http/, 'ws');
  const url = `${base}/v1/ws?api_key=${encodeURIComponent(apiKey)}`;
  const earnings = opts.earnings;
  const status = (line: string) => {
    if (!earnings?.json) console.log(line);
  };

  let reconnectDelay = 1000;
  let shouldReconnect = true;
  let current: WebSocket | null = null;
  let live: LiveState | null = earnings ? initialLiveState(earnings.sinceSeq) : null;
  let partialShown = false;

  return new Promise<void>((resolve, reject) => {
    function clearPartial() {
      if (partialShown) {
        process.stdout.write(CLEAR_LINE);
        partialShown = false;
      }
    }

    function finish(error?: Error) {
      shouldReconnect = false;
      clearPartial();
      current?.close();
      if (error) reject(error);
      else resolve();
    }

    function handleEarnings(ws: WebSocket, data: Record<string, any>) {
      if (!earnings || !live || !isEarningsFrame(data)) return;
      if (earnings.json) console.log(JSON.stringify(data));
      const step = liveStep(live, data, earnings);
      live = step.state;
      if (!earnings.json) {
        if (step.lines.length) clearPartial();
        for (const line of step.lines) console.log(line);
        if (step.partial && process.stdout.isTTY) {
          const width = (process.stdout.columns ?? 80) - 1;
          process.stdout.write(CLEAR_LINE + step.partial.slice(0, width));
          partialShown = true;
        }
      }
      if (step.end) {
        if (step.end.code === 0) {
          status(chalk.dim(step.end.message));
          finish();
        } else {
          finish(new Error(step.end.message));
        }
      } else if (step.reconnect) {
        ws.close();
      }
    }

    function connect() {
      status(chalk.dim('Connecting to WebSocket...'));
      const ws = new WebSocket(url);
      current = ws;

      ws.addEventListener('open', () => {
        reconnectDelay = 1000;
        if (earnings && live) {
          status(chalk.green(`Connected; subscribing to ${earnings.partials ? 'live transcript + partials' : 'live transcript'}`));
          // A reconnect resumes after the last printed final (the API replays the gap).
          ws.send(JSON.stringify(subscribeFrame(earnings.target, live.lastSeq, earnings.partials)));
        } else {
          console.log(chalk.green('Connected to filing stream'));
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === 'ping') return;
          if (earnings) {
            handleEarnings(ws, data);
          } else if (data.type === 'new_filing') {
            const f = data.filing;
            console.log(chalk.bold(`[${f.form_type}]`) + ` ${f.cik} - Filed ${f.filing_date}`);
            if (f.html_url) console.log(chalk.dim(`  ${f.html_url}`));
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        } catch {
          if (!earnings) console.log(String(event.data));
        }
      });

      ws.addEventListener('close', (event) => {
        if (!shouldReconnect) return;
        if (PERMANENT_CLOSE_CODES.has(event.code)) {
          finish(new Error(`WebSocket closed (${event.code}): ${event.reason || 'refused'}`));
          return;
        }
        clearPartial();
        status(chalk.yellow(`Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`));
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      });

      ws.addEventListener('error', (error) => {
        if (!earnings?.json) console.error(chalk.red('WebSocket error:'), error);
      });
    }

    process.once('SIGINT', () => {
      shouldReconnect = false;
      clearPartial();
      current?.close();
      status(chalk.dim('\nDisconnected.'));
      process.exit(0);
    });

    connect();
  });
}
