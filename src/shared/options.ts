import { Option } from 'commander';

export const identifierOption = new Option('-i, --identifier <ticker>', 'Ticker symbol or CIK').makeOptionMandatory();
export const identifiersOption = new Option('-i, --identifiers <tickers>', 'Comma-separated ticker symbols or CIKs').makeOptionMandatory();
export const periodOption = new Option('-p, --period <type>', 'Fiscal period type').choices(['quarterly', 'annual', 'ytd', 'ttm']).makeOptionMandatory();
export const sortOption = new Option('-s, --sort <dir>', 'Sort direction').choices(['asc', 'desc']).default('desc');
export const limitOption = new Option('-l, --limit <n>', 'Maximum results').default('10');
export const offsetOption = new Option('--offset <n>', 'Pagination offset').default('0');
export const startDateOption = new Option('--start-date <date>', 'Start date (YYYY-MM-DD)');
export const endDateOption = new Option('--end-date <date>', 'End date (YYYY-MM-DD)');
export const queryOption = new Option('-q, --query <text>', 'Search query').makeOptionMandatory();
export const cikOption = new Option('--cik <cik>', 'Institution CIK').makeOptionMandatory();
export const jsonOption = new Option('--json', 'Output raw JSON');
export const allOption = new Option('--all', 'Auto-paginate through all results');

/** A comma-separated option value → trimmed, de-duplicated, non-empty items. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}
