import { Command } from 'commander';
import { apiGet } from '../client/api-client.js';
import { fetchAllPages } from '../client/pagination.js';
import { withErrorHandling } from '../shared/errors.js';
import { output } from '../shared/output.js';
import { formatTable, printPaginationHint } from '../formatters/table-formatter.js';
import { setJsonMode } from '../shared/spinner.js';
import chalk from 'chalk';

export function registerFilingsCommands(program: Command): void {
  const filings = program
    .command('filings')
    .description('SEC filings');

  filings
    .command('list')
    .description('Fetch SEC filings for a company')
    .requiredOption('-i, --identifier <ticker>', 'Ticker or CIK')
    .option('--form-type <type>', 'SEC form type (e.g., 10-K, 10-Q, 8-K)')
    .option('-s, --sort <dir>', 'Sort direction', 'desc')
    .option('-l, --limit <n>', 'Max results', '40')
    .option('--offset <n>', 'Offset', '0')
    .action(withErrorHandling(async (cmdOpts) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      let data = await apiGet<{ companies: any[] }>({
        path: '/v1/sec-filings/filings',
        params: {
          identifier: cmdOpts.identifier,
          form_type: cmdOpts.formType,
          sort: cmdOpts.sort,
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        },
      });
      if (opts.all) {
        data = await fetchAllPages(data,
          d => d.companies?.[0]?.next_url,
          (acc, page) => ({
            companies: acc.companies.map((c: any, i: number) => ({
              ...c,
              filings: [...c.filings, ...(page.companies[i]?.filings || [])],
              next_url: page.companies[i]?.next_url,
            })),
          }),
        );
      }
      output(data, opts, () => {
        for (const c of data.companies) {
          console.log(chalk.bold(`\n${c.ticker} SEC Filings\n`));
          formatTable(c.filings, ['filing_date', 'form_type', 'fiscal_year', 'fiscal_quarter', 'calendar_year', 'calendar_quarter', 'period_end', 'accession_number', 'html_url']);
          printPaginationHint(c.next_url);
        }
      });
    }));

  filings
    .command('search')
    .description('Search SEC filings using natural language')
    .requiredOption('-r, --request <text>', 'Natural language search query')
    .option('-i, --identifier <ticker>', 'Filter by company')
    .option('--accession-number <num>', 'Filter by accession number')
    .action(withErrorHandling(async (cmdOpts) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      const data = await apiGet<{ text: string; sources: any[] }>({
        path: '/v1/sec-filings/search',
        params: {
          request: cmdOpts.request,
          identifier: cmdOpts.identifier,
          accession_number: cmdOpts.accessionNumber,
        },
      });
      output(data, opts, () => {
        console.log(data.text);
        if (data.sources.length > 0) {
          console.log(chalk.bold('\nSources:'));
          formatTable(data.sources, ['ticker', 'cik', 'form_type', 'filing_date', 'accession_number', 'html_url']);
        }
      });
    }));

  filings
    .command('sections')
    .description('Fetch SEC filing sections')
    .requiredOption('-i, --identifier <ticker>', 'Ticker or CIK')
    .requiredOption('--form-type <type>', 'Form type (10-Q, 10-K, 8-K)')
    .option('--section-id <id>', 'Section ID')
    .option('--accession-number <num>', 'Accession number')
    .option('--fiscal-year <year>', 'Fiscal year')
    .option('--fiscal-quarter <q>', 'Fiscal quarter (1-4)')
    .action(withErrorHandling(async (cmdOpts) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      const data = await apiGet<{ companies: any[] }>({
        path: '/v1/sec-filings/sections',
        params: {
          identifier: cmdOpts.identifier,
          form_type: cmdOpts.formType,
          section_id: cmdOpts.sectionId,
          accession_number: cmdOpts.accessionNumber,
          fiscal_year: cmdOpts.fiscalYear,
          fiscal_quarter: cmdOpts.fiscalQuarter,
        },
      });
      output(data, opts, () => {
        for (const c of data.companies) {
          console.log(chalk.bold(`\n${c.ticker} Filing Sections\n`));
          for (const section of c.sections) {
            console.log(chalk.cyan(`${section.part} - ${section.item_id} - ${section.title}`));
            console.log(chalk.dim(`  ${section.form_type} | ${section.filing_date} | FY${section.fiscal_year} Q${section.fiscal_quarter} | CY${section.calendar_year} Q${section.calendar_quarter} | Period end: ${section.period_end}`));
            console.log(chalk.dim(`  Accession: ${section.accession_number} | CIK: ${section.cik} | Tag: ${section.html_tag_id}`));
            if (section.html_url) {
              console.log(chalk.dim(`  URL: ${section.html_url}`));
            }
            if (section.content) {
              const preview = section.content.substring(0, 500);
              console.log(`  ${preview}${section.content.length > 500 ? '...' : ''}\n`);
            }
          }
        }
      });
    }));

  filings
    .command('form-types')
    .description('List available SEC form types')
    .option('-i, --identifier <ticker>', 'Filter by company')
    .action(withErrorHandling(async (cmdOpts) => {
      const opts = program.opts();
      if (opts.json) setJsonMode(true);
      const data = await apiGet<{ form_types: string[] }>({
        path: '/v1/sec-filings/available-form-types',
        params: { identifier: cmdOpts.identifier },
      });
      output(data, opts, () => {
        console.log(chalk.bold('Available Form Types:\n'));
        for (const ft of data.form_types) {
          console.log(`  ${ft}`);
        }
      });
    }));
}
