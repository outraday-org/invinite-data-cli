import { getApiKey } from '../config/auth.js';
import { getBaseUrl } from '../config/config-manager.js';
import chalk from 'chalk';
import {
  initialLiveState,
  isAllLive,
  isEarningsFrame,
  liveStep,
  subscribeFrame,
  type KeywordOptions,
  type LiveState,
  type LiveTarget,
} from './earnings-live.js';
import { isNewsFrame, newsStep, newsSubscribeFrame, type NewsListenOptions } from './news-live.js';

export interface EarningsListenOptions {
  target: LiveTarget;
  sinceSeq: number;
  partials: boolean;
  names: boolean;
  /** NDJSON: every earnings frame as one line, nothing else on stdout. */
  json: boolean;
  /** Price ticks of the call (`prices: true`; per-call only). */
  prices?: boolean;
  /** Keyword / guidance alerts on the subscription (required with the `all_live` target). */
  keywords?: KeywordOptions;
}

/** Close codes of `/v1/ws` that a reconnect cannot fix (bad key, plan, connection limit). */
const PERMANENT_CLOSE_CODES = new Set([4001, 4003, 4029]);

const CLEAR_LINE = '\r\x1b[2K';

/** `earnings` and `news` exclude each other (`ws listen` refuses both); neither = the filing stream. */
export async function connectWebSocket(opts: { earnings?: EarningsListenOptions; news?: NewsListenOptions } = {}): Promise<void> {
  const apiKey = await getApiKey();
  const base = getBaseUrl().replace(/\/+$/, '').replace(/^http/, 'ws');
  const url = `${base}/v1/ws?api_key=${encodeURIComponent(apiKey)}`;
  const earnings = opts.earnings;
  const news = opts.news;
  const ndjson = Boolean(earnings?.json || news?.json);
  const status = (line: string) => {
    if (!ndjson) console.log(line);
  };

  let reconnectDelay = 1000;
  let shouldReconnect = true;
  let current: WebSocket | null = null;
  let live: LiveState | null = earnings ? initialLiveState(earnings.sinceSeq) : null;
  const liveOpts = earnings ? { partials: earnings.partials, names: earnings.names, allLive: isAllLive(earnings.target) } : null;
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
      if (!earnings || !live || !liveOpts || !isEarningsFrame(data)) return;
      if (earnings.json) console.log(JSON.stringify(data));
      const step = liveStep(live, data, liveOpts);
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

    function handleNews(ws: WebSocket, data: Record<string, any>) {
      if (!news) return;
      if (news.json) console.log(JSON.stringify(data));
      const step = newsStep(data);
      if (!news.json) for (const line of step.lines) console.log(line);
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
          const what = isAllLive(earnings.target)
            ? 'keyword alerts on every live call'
            : `${earnings.partials ? 'live transcript + partials' : 'live transcript'}${earnings.keywords ? ' + keyword alerts' : ''}${earnings.prices ? ' + prices' : ''}`;
          status(chalk.green(`Connected; subscribing to ${what}`));
          // A reconnect resumes after the last printed final (the API replays the gap).
          ws.send(JSON.stringify(subscribeFrame(earnings.target, live.lastSeq, earnings.partials, earnings.keywords, earnings.prices)));
        } else if (news) {
          status(chalk.green('Connected; subscribing to news.live'));
          // Items published while disconnected are not replayed: `invd news list` has them.
          ws.send(JSON.stringify(newsSubscribeFrame(news)));
        } else {
          console.log(chalk.green('Connected to filing stream'));
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === 'ping') return;
          if (news) {
            // Only news frames: the filing broadcasts on the same socket are not what --news asked for.
            if (isNewsFrame(data)) handleNews(ws, data);
          } else if (earnings) {
            handleEarnings(ws, data);
          } else if (data.type === 'new_filing') {
            const f = data.filing;
            console.log(chalk.bold(`[${f.form_type}]`) + ` ${f.cik} - Filed ${f.filing_date}`);
            if (f.html_url) console.log(chalk.dim(`  ${f.html_url}`));
          } else {
            console.log(JSON.stringify(data, null, 2));
          }
        } catch {
          if (!earnings && !news) console.log(String(event.data));
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
        if (!ndjson) console.error(chalk.red('WebSocket error:'), error);
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
