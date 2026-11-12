import { Command } from 'commander';
import chalk from 'chalk';
import {
  SETTINGS,
  getSetting,
  globalConfigPath,
  isSettingKey,
  localConfigPath,
  setSetting,
  unsetSetting,
  type SettingKey,
} from '../config/config-manager.js';
import { OUTPUT_FORMATS } from '../output/render.js';
import { UsageError, withErrorHandling } from '../shared/errors.js';

function settingKey(key: string): SettingKey {
  if (!isSettingKey(key)) throw new UsageError(`Unknown setting ${key}. Settings: ${Object.keys(SETTINGS).join(', ')}`);
  return key;
}

function checkValue(key: SettingKey, value: string): void {
  if (key === 'output' && value !== '' && !(OUTPUT_FORMATS as readonly string[]).includes(value)) {
    throw new UsageError(`output must be one of ${OUTPUT_FORMATS.join(', ')}`);
  }
  if (key === 'confirm_credits' && !/^\d+$/.test(value)) throw new UsageError('confirm_credits must be a whole number');
  if (key === 'base_url') {
    try {
      new URL(value);
    } catch {
      throw new UsageError(`base_url must be a URL (got ${value})`);
    }
  }
}

const shown = (key: SettingKey, value: string) => (key === 'api_key' && value ? `${value.slice(0, 4)}…` : value);

/**
 * `invd config`: the settings in `$XDG_CONFIG_HOME/invinite/invd.toml` (`INVD_CONFIG_DIR` replaces the directory)
 * and the project file `./.invd.toml` (`--local`). Precedence: flags > env > `./.invd.toml` > `invd.toml`. A value
 * asked for (`list`, `get`, `path`) goes to stdout; confirmations go to stderr.
 */
export function registerConfigCommands(program: Command): void {
  const config = program
    .command('config')
    .description('Local settings: ~/.config/invinite/invd.toml (XDG) and ./.invd.toml; flags > env > local > global');

  config
    .command('list')
    .description('Every setting with its value and where it comes from')
    .option('--json', 'Print JSON')
    .addHelpText('before', 'Examples:\n  $ invd config list\n  $ invd config list --json\n')
    .action(withErrorHandling(async (opts: { json?: boolean }) => {
      const rows = (Object.keys(SETTINGS) as SettingKey[]).map(key => {
        const { value, source } = getSetting(key);
        return { key, value: shown(key, value), source, env: SETTINGS[key].env };
      });
      if (opts.json) {
        console.log(JSON.stringify({ global: globalConfigPath(), local: localConfigPath(), settings: rows }, null, 2));
        return;
      }
      for (const row of rows) {
        console.log(`  ${chalk.bold(row.key.padEnd(16))} ${row.value === '' ? chalk.dim('(unset)') : row.value}  ${chalk.dim(`${row.source} · $${row.env}`)}`);
      }
      console.error(chalk.dim(`\nglobal: ${globalConfigPath()}\nlocal:  ${localConfigPath()}`));
    }));

  config
    .command('get')
    .description('Print one setting\'s effective value')
    .argument('<key>', `One of ${Object.keys(SETTINGS).join(', ')}`)
    .addHelpText('before', 'Examples:\n  $ invd config get base_url\n  $ invd config get output\n')
    .action(withErrorHandling(async (key: string) => {
      const name = settingKey(key);
      console.log(shown(name, getSetting(name).value));
    }));

  config
    .command('set')
    .description('Write a setting to invd.toml (or ./.invd.toml with --local)')
    .argument('<key>', `One of ${Object.keys(SETTINGS).join(', ')}`)
    .argument('<value>', 'The value')
    .option('--local', 'Write ./.invd.toml (this project) instead of the global file')
    .addHelpText('before', 'Examples:\n  $ invd config set output json\n  $ invd config set base_url http://localhost:4000 --local\n')
    .action(withErrorHandling(async (key: string, value: string, opts: { local?: boolean }) => {
      const name = settingKey(key);
      checkValue(name, value);
      const path = setSetting(name, value, opts.local ? 'local' : 'global');
      console.error(chalk.green(`${name} = ${shown(name, value)}`) + chalk.dim(` (${path})`));
    }));

  config
    .command('unset')
    .description('Remove a setting from invd.toml (or ./.invd.toml with --local)')
    .argument('<key>', `One of ${Object.keys(SETTINGS).join(', ')}`)
    .option('--local', 'Edit ./.invd.toml instead of the global file')
    .addHelpText('before', 'Examples:\n  $ invd config unset output\n  $ invd config unset base_url --local\n')
    .action(withErrorHandling(async (key: string, opts: { local?: boolean }) => {
      const path = unsetSetting(settingKey(key), opts.local ? 'local' : 'global');
      console.error(chalk.green(`${key} unset`) + chalk.dim(` (${path})`));
    }));

  config
    .command('path')
    .description('Print the global config file path')
    .addHelpText('before', 'Examples:\n  $ invd config path\n  $ cat "$(invd config path)"\n')
    .action(() => {
      console.log(globalConfigPath());
    });
}
