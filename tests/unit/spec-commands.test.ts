import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

vi.mock('../../src/config/auth.js', () => ({
  getApiKey: vi.fn().mockResolvedValue('test-api-key'),
}));

vi.mock('../../src/config/config-manager.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://api.example.com'),
  DASHBOARD_URL: 'https://app.example.com/data-api',
}));

vi.mock('../../src/shared/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({ succeed: vi.fn(), fail: vi.fn() }),
  setJsonMode: vi.fn(),
}));

import { registerSpecCommands } from '../../src/spec-commands.js';
import { createProgram, loadManifest } from '../../src/cli.js';
import type { Manifest, ManifestOperation } from '../../src/spec-manifest.js';
import { flagName } from '../../src/spec-flags.js';

const op = (overrides: Partial<ManifestOperation> & Pick<ManifestOperation, 'group' | 'action' | 'path'>): ManifestOperation => ({
  operationId: `${overrides.group}-${overrides.action}`,
  method: 'get',
  summary: `${overrides.group} ${overrides.action}`,
  params: [],
  view: 'json',
  pagination: 'none',
  ...overrides,
});

const MANIFEST: Manifest = {
  specVersion: '1.0.0',
  specSha256: '0'.repeat(64),
  groups: [
    { name: 'things', description: 'Things' },
    { name: 'hooks', description: 'Hooks' },
    { name: 'ping', description: 'Ping the API' },
  ],
  operations: [
    op({
      group: 'things',
      action: 'search',
      path: '/v1/things/search',
      view: 'table',
      rowsPath: 'things',
      columns: ['name', 'owner.name'],
      pagination: 'top',
      allItemsPath: ['things'],
      params: [
        { name: 'query', in: 'query', required: true, type: 'string', alias: 'q', description: 'Search text' },
        { name: 'limit', in: 'query', required: false, type: 'integer', default: 10, alias: 'l' },
        { name: 'min_value', in: 'query', required: false, type: 'number' },
        { name: 'sort', in: 'query', required: false, type: 'string', enum: ['asc', 'desc'] },
        { name: 'status', in: 'query', required: false, type: 'array', items: 'string', enum: ['open', 'closed'] },
      ],
    }),
    op({
      group: 'things',
      action: 'history',
      path: '/v1/things/history',
      view: 'table',
      rowsPath: 'companies.0.periods',
      columns: ['year'],
      pagination: 'perCompany',
      allItemsPath: ['periods'],
      params: [{ name: 'identifier', in: 'query', required: true, type: 'string', alias: 'i' }],
    }),
    op({
      group: 'things',
      action: 'get',
      path: '/v1/things/{thing_id}',
      view: 'keyValue',
      rowsPath: 'thing',
      columns: ['name', 'owner.name'],
      params: [{ name: 'thing_id', in: 'path', required: true, type: 'string' }],
    }),
    op({
      group: 'things',
      action: 'extract',
      path: '/v1/things/extract',
      pagination: 'top',
      allItemsPath: ['guidance', 'kpis'],
    }),
    op({
      group: 'hooks',
      action: 'create',
      method: 'post',
      path: '/v1/hooks',
      body: { required: true, contentType: 'application/json' },
      view: 'keyValue',
      columns: ['id', 'url'],
    }),
    op({ group: 'hooks', action: 'delete', method: 'delete', path: '/v1/hooks/{id}', params: [{ name: 'id', in: 'path', required: true, type: 'string' }] }),
    op({ group: 'ping', action: '', path: '/ping', view: 'keyValue', columns: ['status'] }),
  ],
};

function respond(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  const text = body === undefined ? '' : JSON.stringify(body);
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status',
    headers: new Headers(init.headers ?? {}),
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  } as unknown as Response);
}

const program = () => {
  const root = new Command().exitOverride().option('--json').option('--all');
  registerSpecCommands(root, MANIFEST);
  return root;
};
const run = (...args: string[]) => program().parseAsync(['node', 'invd', ...args]);
const requestedUrl = (call = 0) => String(vi.mocked(fetch).mock.calls[call][0]);
const requestInit = (call = 0) => vi.mocked(fetch).mock.calls[call][1];

describe('registerSpecCommands', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { err.push(parts.map(String).join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
    vi.mocked(process.exit).mockRestore();
  });

  it('maps flags (long and alias) to query parameters and sends no default', async () => {
    respond({ things: [] });
    await run('things', 'search', '-q', 'apple', '--min-value', '1.5', '--sort', 'asc');
    expect(requestedUrl()).toBe('https://api.example.com/v1/things/search?query=apple&min_value=1.5&sort=asc');
  });

  it('coerces an integer and refuses a non-integer by flag name without a request', async () => {
    respond({ things: [] });
    await run('things', 'search', '--query', 'a', '-l', '007');
    expect(requestedUrl()).toContain('limit=7');

    vi.mocked(fetch).mockClear();
    await run('things', 'search', '--query', 'a', '--limit', 'ten');
    expect(fetch).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('--limit expects an integer (got "ten")');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('refuses a missing required flag and an unknown enum value', async () => {
    await expect(run('things', 'search')).rejects.toThrow(/required option '-q, --query <value>' not specified/);
    await expect(run('things', 'search', '-q', 'a', '--sort', 'up')).rejects.toThrow(/Allowed choices are asc, desc/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('takes an array as one comma list, sent repeated, items checked against the enum', async () => {
    respond({ things: [] });
    await run('things', 'search', '-q', 'a', '--status', 'open, closed,open');
    expect(requestedUrl()).toContain('status=open&status=closed');

    vi.mocked(fetch).mockClear();
    await run('things', 'search', '-q', 'a', '--status', 'open,pending');
    expect(fetch).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('--status expects a comma-separated list, each item one of open, closed');
  });

  it('puts a path parameter into the path, encoded', async () => {
    respond({ thing: { name: 'x', owner: { name: 'y' } } });
    await run('things', 'get', '--thing-id', 'a/b c');
    expect(requestedUrl()).toBe('https://api.example.com/v1/things/a%2Fb%20c');
  });

  it('sends a JSON body from --body', async () => {
    respond({ id: 'h1', url: 'https://x' }, { status: 201 });
    await run('hooks', 'create', '--body', '{"url":"https://x"}');
    expect(requestInit()).toMatchObject({ method: 'POST', body: '{"url":"https://x"}' });
  });

  it('reads the body from stdin with --body-file -', async () => {
    const stdin = vi.spyOn(process, 'stdin', 'get')
      .mockReturnValue(Readable.from(['{"url":', '"https://y"}']) as unknown as typeof process.stdin);
    respond({ id: 'h2', url: 'https://y' }, { status: 201 });
    await run('hooks', 'create', '--body-file', '-');
    stdin.mockRestore();
    expect(requestInit()).toMatchObject({ method: 'POST', body: '{"url":"https://y"}' });
  });

  it('refuses a missing body, two bodies and invalid JSON before any request', async () => {
    await run('hooks', 'create');
    await run('hooks', 'create', '--body', '{}', '--body-file', 'x.json');
    await run('hooks', 'create', '--body', '{nope');
    expect(fetch).not.toHaveBeenCalled();
    const text = err.join('\n');
    expect(text).toContain('This command needs a JSON body');
    expect(text).toContain('Pass --body or --body-file, not both');
    expect(text).toContain('--body is not valid JSON');
  });

  it('--all follows a top-level next_url and concatenates the rows', async () => {
    respond({ things: [{ name: 'a' }], next_url: 'https://api.example.com/v1/things/search?query=a&offset=1' });
    respond({ things: [{ name: 'b' }] });
    await run('--all', '--json', 'things', 'search', '-q', 'a');
    expect(requestedUrl(1)).toBe('https://api.example.com/v1/things/search?query=a&offset=1');
    expect(JSON.parse(out.join('\n')).things).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('--all on a top op concatenates every listed array a page carries', async () => {
    respond({ guidance: [1], next_url: 'https://api.example.com/v1/things/extract?offset=1' });
    respond({ guidance: [2], kpis: [3] });
    await run('--all', '--json', 'things', 'extract');
    expect(JSON.parse(out.join('\n'))).toMatchObject({ guidance: [1, 2], kpis: [3] });
  });

  it('--all follows companies[0].next_url and merges each company by index', async () => {
    respond({
      companies: [
        { ticker: 'A', periods: [{ year: 1 }], next_url: 'https://api.example.com/v1/things/history?identifier=A&offset=1' },
        { ticker: 'B', periods: [{ year: 10 }], next_url: 'https://api.example.com/v1/things/history?identifier=B&offset=1' },
      ],
    });
    respond({ companies: [{ ticker: 'A', periods: [{ year: 2 }] }, { ticker: 'B', periods: [{ year: 11 }] }] });
    await run('--all', '--json', 'things', 'history', '-i', 'A');
    const merged = JSON.parse(out.join('\n'));
    expect(merged.companies.map((c: { periods: unknown }) => c.periods)).toEqual([[{ year: 1 }, { year: 2 }], [{ year: 10 }, { year: 11 }]]);
    expect(merged.companies.every((c: { next_url?: unknown }) => c.next_url === undefined)).toBe(true);
  });

  it('refuses --all on an operation that does not paginate', async () => {
    await run('--all', 'things', 'get', '--thing-id', 'x');
    expect(fetch).not.toHaveBeenCalled();
    expect(err.join('\n')).toContain('invd things get does not paginate');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('renders a table from rowsPath with dotted columns and the pagination hint', async () => {
    respond({ things: [{ name: 'a', owner: { name: 'o' } }], next_url: 'https://api.example.com/next' });
    await run('things', 'search', '-q', 'a');
    const text = out.join('\n');
    expect(text).toMatch(/name\s+owner\.name/);
    expect(text).toMatch(/a\s+o/);
    expect(text).toContain('More results available');
  });

  it('prints No results. for an empty rowsPath array', async () => {
    respond({ things: [] });
    await run('things', 'search', '-q', 'a');
    expect(out.join('\n')).toContain('No results.');
  });

  it('renders keyValue over the object rowsPath names', async () => {
    respond({ thing: { name: 'x', owner: { name: 'y' } } });
    await run('things', 'get', '--thing-id', '1');
    const text = out.join('\n');
    expect(text).toMatch(/name\s+x/);
    expect(text).toMatch(/owner\.name\s+y/);
  });

  it('a group-level command (action "") and the json view', async () => {
    respond({ status: 'ok' });
    await run('ping');
    expect(out.join('\n')).toMatch(/status\s+ok/);
    respond({ guidance: [] });
    await run('things', 'extract');
    expect(JSON.parse(out.slice(1).join('\n'))).toEqual({ guidance: [] });
  });

  it('--json prints the raw body', async () => {
    respond({ thing: { name: 'x' }, extra: true });
    await run('--json', 'things', 'get', '--thing-id', '1');
    expect(JSON.parse(out.join('\n'))).toEqual({ thing: { name: 'x' }, extra: true });
  });

  it('a 204 prints Done. (and nothing with --json)', async () => {
    respond(undefined, { status: 204 });
    await run('hooks', 'delete', '--id', 'h1');
    expect(requestInit()).toMatchObject({ method: 'DELETE' });
    expect(out).toEqual(['Done.']);
    respond(undefined, { status: 204 });
    await run('--json', 'hooks', 'delete', '--id', 'h1');
    expect(out).toEqual(['Done.']);
  });

  it('an ApiError exits 1', async () => {
    respond({ error: 'Not Found', message: 'No such thing' }, { status: 404 });
    await run('things', 'get', '--thing-id', 'nope');
    expect(err.join('\n')).toContain('Error 404: Not Found');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('skips groups a hand-written file owns', () => {
    const root = new Command();
    root.command('things');
    registerSpecCommands(root, MANIFEST, { skipGroups: root.commands.map(command => command.name()) });
    expect(root.commands.map(command => command.name())).toEqual(['things', 'hooks', 'ping']);
    expect(root.commands[0].commands).toEqual([]);
  });
});

describe('the real manifest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.error).mockRestore();
    if (vi.isMockFunction(console.log)) vi.mocked(console.log).mockRestore();
  });

  it('registers every operation once, with no colliding command or flag', () => {
    const manifest = loadManifest();
    const root = new Command().option('--json').option('--all').option('--show-cost');
    registerSpecCommands(root, manifest);

    const names = manifest.operations.map(operation => `${operation.group} ${operation.action}`.trim());
    expect(new Set(names).size).toBe(names.length);
    const registered = root.commands.flatMap(group => (group.commands.length
      ? group.commands.map(command => `${group.name()} ${command.name()}`)
      : [group.name()]));
    expect(registered.sort()).toEqual([...names].sort());

    for (const operation of manifest.operations) {
      const flags = operation.params.map(param => flagName(param.name));
      const aliases = operation.params.flatMap(param => (param.alias ? [param.alias] : []));
      expect(new Set(flags).size, operation.operationId).toBe(flags.length);
      expect(new Set(aliases).size, operation.operationId).toBe(aliases.length);
    }
  });

  it('createProgram registers the generated groups no hand-written file owns (status), and they run', async () => {
    const program = createProgram();
    expect(program.commands.filter(command => command.name() === 'status')).toHaveLength(1);
    expect(program.commands.find(command => command.name() === 'status')?.commands.map(c => c.name()).sort())
      .toEqual(['licensing', 'show']);
    const names = program.commands.map(command => command.name());
    expect(new Set(names).size).toBe(names.length);
  });

  it('--show-cost still prints for a generated command', async () => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
    vi.mocked(console.error).mockImplementation((line?: unknown) => { err.push(String(line ?? '')); });
    respond({ status: 'operational', components: [] }, { headers: { 'X-Credits-Charged': '0', 'X-Credits-Included-Remaining': '7' } });
    await createProgram().exitOverride().parseAsync(['node', 'invd', '--show-cost', 'status', 'show']);
    expect(requestedUrl()).toBe('https://api.example.com/status');
    expect(err).toEqual(['credits: 0 · included left: 7']);
  });
});
