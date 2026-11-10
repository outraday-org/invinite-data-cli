import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { configDir } from './config/config-manager.js';

const PACKAGE = '@invinite-org/invinite-data-cli';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A once-a-day look at npm's `latest` for this package; the notice prints on stderr from the cached answer. Never
 * in CI, under a test runner, without a terminal on stderr, or with `INVD_NO_UPDATE_NOTIFIER` set.
 */
export function updateCheckEnabled(env: NodeJS.ProcessEnv = process.env, stderrIsTty = Boolean(process.stderr.isTTY)): boolean {
  return stderrIsTty && !env.CI && !env.INVD_NO_UPDATE_NOTIFIER && !env.VITEST && env.NODE_ENV !== 'test';
}

/** `a` newer than `b` (plain `x.y.z`; anything else is never newer). */
export function isNewer(a: string, b: string): boolean {
  const parse = (version: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return false;
  for (let index = 0; index < 3; index += 1) {
    if ((x[index] ?? 0) !== (y[index] ?? 0)) return (x[index] ?? 0) > (y[index] ?? 0);
  }
  return false;
}

interface State {
  checkedAt?: number;
  latest?: string;
}

const statePath = () => join(configDir(), 'update-check.json');

function readState(): State {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as State;
  } catch {
    return {};
  }
}

/** Prints the cached notice and, at most once a day, refreshes the cache (≤ 1.5 s, failures ignored). */
export async function runUpdateNotifier(current: string): Promise<void> {
  if (!updateCheckEnabled()) return;
  const state = readState();
  if (state.latest && isNewer(state.latest, current)) {
    console.error(chalk.yellow(`invd ${state.latest} is available (you have ${current}): npm install -g ${PACKAGE}`));
  }
  if (state.checkedAt && Date.now() - state.checkedAt < DAY_MS) return;
  let latest = state.latest;
  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json() as { version?: unknown };
    if (typeof body.version === 'string') latest = body.version;
  } catch {
    // offline or slow: the next check is tomorrow either way
  }
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(statePath(), JSON.stringify({ checkedAt: Date.now(), ...(latest ? { latest } : {}) }));
  } catch {
    // a read-only config dir: no cache, no notice
  }
}
