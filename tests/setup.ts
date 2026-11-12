import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

/**
 * Every test file runs on a temporary home: `os.homedir()` (plugin / agent-setup global targets, the config fallbacks)
 * the XDG / APPDATA roots and the working directory point into it, so no test can read or write the person's real ~/.config,
 * ~/Library/Preferences, ~/.claude, ~/.codex … (one test once overwrote a real config file). `INVD_CONFIG_DIR` is set
 * in vitest.config.ts; a test file may still mock `node:os` itself with its own temporary home.
 */
const { home } = vi.hoisted(() => {
  // node:fs / node:os are not mocked yet inside vi.hoisted; require the real modules.
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  return { home: fs.mkdtempSync(path.join(os.tmpdir(), 'invd-test-home-')) };
});

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, default: { ...os, homedir: () => home }, homedir: () => home };
});

process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = mkdtempSync(join(home, 'xdg-'));
process.env.XDG_DATA_HOME = join(home, '.local', 'share');
process.env.XDG_STATE_HOME = join(home, '.local', 'state');
process.env.XDG_CACHE_HOME = join(home, '.cache');
process.env.APPDATA = join(home, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = join(home, 'AppData', 'Local');

// A temporary working directory too: `--local` installs, `./.invd.toml` and `./.env` resolve against `process.cwd()`,
// so a test that forgets to mock it writes (or reads a real `.env`) inside the temp dir, never in the checkout.
process.chdir(mkdtempSync(join(home, 'cwd-')));
