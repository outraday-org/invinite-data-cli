import { Command, Option } from 'commander';
import { splitList } from '../shared/options.js';
import { UsageError } from '../shared/errors.js';
import { setJsonMode } from '../shared/spinner.js';
import { checkFields, defaultFormat, OUTPUT_FORMATS, type OutputFormat, type OutputSettings } from './render.js';

/**
 * The output / paging / metering flags every data command carries (the program uses positional options, so they are
 * the command's own, never the root's): `--json [fields]`, `--output`, `--jq`, `--plain`, `--fields`, `--show-cost`,
 * `--dry-run`, `--yes`, `--no-input`, and on a list `--all`.
 */
export function addOutputOptions(command: Command, opts: { list: boolean; fieldsParam?: boolean }): Command {
  command
    .option('--json [fields]', 'Print JSON; with a comma list, only those fields of each row (see Fields below)')
    .addOption(new Option('--output <format>', 'Output format').choices([...OUTPUT_FORMATS]))
    .option('--jq <expr>', 'Filter the JSON with a jq expression (strings print raw)')
    .option('--plain', 'Tab-separated rows without colour or decoration (the default when piped)')
    .option('--fields <list>', opts.fieldsParam
      ? 'Only these root fields (sent as fields=, pruned by the API)'
      : 'Only these fields of each row (pruned locally)');
  if (opts.list) command.option('--all', 'Fetch every page (streams JSONL, or CSV with --output csv)');
  command
    .option('--dry-run', 'Print the request plan and its credit estimate; send nothing')
    .option('--yes', 'Do not ask before a costly --all walk or a delete')
    .option('--no-input', 'Never prompt (a confirmation that is needed fails instead)')
    .option('--show-cost', 'Print the credits this command cost to stderr (or set INVD_SHOW_COST=1)');
  return command;
}

export interface OutputFlags {
  json?: boolean | string;
  output?: string;
  jq?: string;
  plain?: boolean;
  fields?: string;
  all?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  input?: boolean;
  showCost?: boolean;
}

/** The output settings a command's flags ask for; `knownFields` checks `--json a,b`. */
export function resolveOutput(
  flags: OutputFlags,
  opts: { knownFields?: readonly string[]; fieldsParam?: boolean; list?: boolean } = {},
): OutputSettings {
  const settings: OutputSettings = { format: defaultFormat() };
  if (flags.plain) settings.format = 'plain';
  if (flags.output) settings.format = flags.output as OutputFormat;
  if (flags.json !== undefined && flags.json !== false) {
    if (flags.output && flags.output !== 'json' && flags.output !== 'jsonl') {
      throw new UsageError(`--json and --output ${flags.output} contradict each other`);
    }
    if (!flags.output) settings.format = 'json';
    if (typeof flags.json === 'string') {
      const fields = splitList(flags.json);
      if (fields.length === 0) throw new UsageError('--json takes a comma list of fields, or nothing');
      checkFields(fields, opts.knownFields ?? []);
      settings.select = fields;
    }
  }
  if (flags.jq !== undefined) {
    if (settings.format !== 'json' && settings.format !== 'jsonl' && (flags.output || flags.plain)) {
      throw new UsageError('--jq prints JSON; it cannot be combined with --output table|plain|csv');
    }
    settings.jq = flags.jq;
  }
  if (flags.fields !== undefined && opts.fieldsParam) settings.order = splitList(flags.fields);
  if (flags.fields !== undefined && !opts.fieldsParam) {
    const fields = splitList(flags.fields);
    checkFields(fields, opts.knownFields ?? [], '--fields');
    settings.prune = fields;
  }
  // --all streams: JSON becomes one row per line.
  if (flags.all && settings.format === 'json') settings.format = 'jsonl';
  if (flags.all && !flags.output && !flags.plain && flags.json === undefined && !flags.jq) settings.format = 'jsonl';
  if (settings.format === 'json' || settings.format === 'jsonl' || settings.format === 'csv' || settings.jq) setJsonMode(true);
  return settings;
}
