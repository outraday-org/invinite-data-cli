import { Command, Option } from 'commander';
import chalk from 'chalk';
import { apiGet } from '../client/api-client.js';
import { printPdfUrl, savePdf } from '../client/pdf.js';
import { flattenRows } from '../formatters/flatten.js';
import { formatKeyValue } from '../formatters/table-formatter.js';
import { apiErrorHint, withErrorHandling } from '../shared/errors.js';
import { output } from '../shared/output.js';
import { setJsonMode } from '../shared/spinner.js';

/**
 * The hand-written `invd news get`: it can save the item's PDF, so it is not one REST call plus one view
 * (`src/hand-written-commands.ts`). Every other `news` action is generated and attached to the same group.
 */

/** The attribution block, then the text it attributes (backend news task 17); the URL above the long text. */
const COLUMNS = [
  'id',
  'published_at',
  'title',
  'kind',
  'source.id',
  'url',
  'content_status',
  'attribution.publisher',
  'attribution.publisher_host',
  'attribution.source_url',
  'attribution.published_at',
  'attribution.rights',
  'attribution.edgar.form',
  'attribution.edgar.accession',
  'attribution.statement',
  'content_formats',
  'pdf.url',
  'body_text',
  'body_html',
];

export function registerNewsCommands(program: Command): void {
  const news = program.commands.find(command => command.name() === 'news') ?? program.command('news');

  news.command('get')
    .description('Get a news item')
    .requiredOption('--id <id>', 'News item id')
    .addOption(new Option('--body <form>', 'Which text forms to return: text = body_text (plain, default), html = body_html (sanitized HTML with the images inline) instead, both = both').choices(['text', 'html', 'both']))
    .option('--pdf', 'Print the URL of the branded PDF of this item')
    .option('--pdf-out <file>', 'Save the branded PDF of this item (e.g. item.pdf)')
    .option('--force', 'Overwrite an existing --pdf-out file')
    .action(withErrorHandling(async (cmdOpts: { id: string; body?: string; pdf?: boolean; pdfOut?: string; force?: boolean }) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      const data = await apiGet<Record<string, any>>({
        path: `/v1/news/${encodeURIComponent(cmdOpts.id)}`,
        params: { body: cmdOpts.body },
      });
      const saved = await savePdf(data.pdf, cmdOpts, 'Downloading news PDF...');
      output(data, opts, () => {
        if (saved) {
          console.log(chalk.green(`Saved ${saved.path} (${saved.bytes.toLocaleString('en-US')} bytes)`));
          return;
        }
        if (cmdOpts.pdf) {
          printPdfUrl(data.pdf);
          return;
        }
        formatKeyValue(flattenRows([data], COLUMNS)[0]);
      });
    }, apiErrorHint));
}
