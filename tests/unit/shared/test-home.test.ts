import { realpathSync } from 'node:fs';
import os, { homedir, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RUNTIMES } from '../../../src/commands/plugin.js';
import { mcpConfigPath } from '../../../src/commands/agent-setup.js';

describe('tests run on a temporary home (tests/setup.ts)', () => {
  it('os.homedir, the working directory, HOME / XDG / APPDATA roots and the install targets all sit under the temp dir', () => {
    // process.cwd() is the resolved path (/private/var/… on macOS), the others are as tmpdir() gives them.
    const roots = [tmpdir(), realpathSync(tmpdir())];
    const inTemp = (value: string | undefined): boolean => roots.some(root => value?.startsWith(root) === true);
    for (const value of [
      homedir(), os.homedir(), process.cwd(), process.env.HOME, process.env.USERPROFILE,
      process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_STATE_HOME, process.env.XDG_CACHE_HOME,
      process.env.APPDATA, process.env.LOCALAPPDATA, RUNTIMES.claude.globalDir, mcpConfigPath('claude', 'global'),
      mcpConfigPath('claude', 'local'),
    ]) {
      expect(inTemp(value), value).toBe(true);
    }
    expect(inTemp(process.env.INVD_CONFIG_DIR)).toBe(true);
  });
});
