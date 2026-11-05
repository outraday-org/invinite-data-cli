import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('formatTable', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should print "No results." for empty rows', async () => {
    const { formatTable } = await import('../../../src/formatters/table-formatter.js');
    formatTable([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('should print header and rows', async () => {
    const { formatTable } = await import('../../../src/formatters/table-formatter.js');
    formatTable([{ name: 'Apple', ticker: 'AAPL' }], ['name', 'ticker']);
    expect(consoleSpy).toHaveBeenCalledTimes(3); // header + separator + 1 row
  });
});

describe('printPaginationHint', () => {
  it('names --cursor for a cursor-paged next_url, offset/limit otherwise', async () => {
    const { printPaginationHint } = await import('../../../src/formatters/table-formatter.js');
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { lines.push(String(line ?? '')); });
    printPaginationHint('https://api.example.com/v1/sec/filings?identifier=AAPL&cursor=abc');
    printPaginationHint('https://api.example.com/v1/things?offset=10');
    spy.mockRestore();
    expect(lines[0]).toContain('--cursor abc');
    expect(lines[1]).toContain('--offset/--limit');
  });
});
