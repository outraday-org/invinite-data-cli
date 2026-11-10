import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../../src/cli.js';
import { bundledConnector, mcpConfigPath, mergeClaudeMcp, mergeCodexMcp } from '../../../src/commands/agent-setup.js';
import { apiPathOf, apiRequestFrom } from '../../../src/commands/api.js';
import { completionScript, completionTable } from '../../../src/commands/completion.js';
import { isNewer, updateCheckEnabled } from '../../../src/update-notifier.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('invd api', () => {
  let out: string[];
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.INVD_API_KEY = 'k';
    process.env.INVD_BASE_URL = 'https://api.example.com';
    out = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { out.push(String(line ?? '')); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.INVD_API_KEY;
    delete process.env.INVD_BASE_URL;
  });

  it('method optional (GET), the path query kept, -F typed on GET into the query and into the body otherwise', async () => {
    expect(await apiRequestFrom('/v2/filings?company=AAPL', undefined, { field: ['limit=5'] }))
      .toEqual({ path: '/v2/filings', method: 'GET', query: { company: ['AAPL'], limit: ['5'] } });
    expect(await apiRequestFrom('post', '/v2/webhooks', { field: ['active=true', 'n=3'], rawField: ['url=https://x'], header: ['Idempotency-Key: k1'] }))
      .toEqual({ path: '/v2/webhooks', method: 'POST', query: {}, headers: { 'Idempotency-Key': 'k1' }, body: { active: true, n: 3, url: 'https://x' } });
    await expect(apiRequestFrom('FETCH', '/v2/x', {})).rejects.toThrow('not an HTTP method');
    await expect(apiRequestFrom('GET', undefined as unknown as string, {})).rejects.toThrow();
  });

  it('an absolute URL is followed only on the API origin; another host is refused before any request (the key)', async () => {
    expect(apiPathOf('https://api.example.com/v2/companies/AAPL?x=1', 'https://api.example.com')).toBe('/v2/companies/AAPL?x=1');
    expect(apiPathOf('https://h.test/api/v2/me', 'https://h.test/api')).toBe('/v2/me');
    expect(apiPathOf('v2/me', 'https://api.example.com')).toBe('/v2/me');
    for (const foreign of ['https://evil.test/v2/me', '//evil.test/v2/me', 'http://api.example.com/v2/me', 'file:///etc/passwd']) {
      expect(() => apiPathOf(foreign, 'https://api.example.com'), foreign).toThrow('invd api only calls https://api.example.com');
    }
    await expect(createProgram().parseAsync(['node', 'invd', 'api', 'GET', 'https://evil.test/v2/me'])).rejects.toThrow('exit 2');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invd api GET /v2/filings?company=AAPL --paginate --jq .data[].accession streams accessions across pages', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ data: [{ accession: 'a1' }, { accession: 'a2' }], has_more: true, next_cursor: 'c2', meta: {} }))
      .mockResolvedValueOnce(json({ data: [{ accession: 'a3' }], has_more: false, next_cursor: null, meta: {} }));
    await createProgram().parseAsync(['node', 'invd', 'api', 'GET', '/v2/filings?company=AAPL', '--paginate', '--jq', '.data[].accession']);
    expect(out).toEqual(['a1\na2', 'a3']);
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toBe('https://api.example.com/v2/filings?company=AAPL&cursor=c2');
  });

  it('--dry-run sends nothing; DELETE needs --yes without a terminal', async () => {
    await createProgram().parseAsync(['node', 'invd', 'api', '/v2/companies/AAPL', '--dry-run']);
    expect(out.join('\n')).toContain('GET https://api.example.com/v2/companies/AAPL');
    await expect(createProgram().parseAsync(['node', 'invd', 'api', 'DELETE', '/v2/webhooks/wh_1'])).rejects.toThrow('exit 2');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('invd completion', () => {
  it('the table holds every command path with its subcommands and flags', () => {
    const table = completionTable(createProgram());
    expect(table.get('')).toEqual(expect.arrayContaining(['financials', 'events', 'api', 'auth', '--version']));
    expect(table.get('events')).toEqual(expect.arrayContaining(['transcript', 'list', 'qa']));
    expect(table.get('financials')).toEqual(expect.arrayContaining(['--basis', '--view', '--statement', '--json']));
  });

  it('bash / zsh / fish scripts carry the commands and the spec paths after invd api', () => {
    const program = createProgram();
    const bash = completionScript('bash', program, ['/v2/filings', '/v2/companies/{company}']);
    expect(bash).toContain('complete -o default -F _invd invd');
    expect(bash).toContain("'/v2/filings /v2/companies/{company}'");
    expect(completionScript('zsh', program, [])).toContain('bashcompinit');
    const fish = completionScript('fish', program, ['/v2/filings']);
    expect(fish).toContain("complete -c invd -f -a '(__invd_complete)'");
    expect(fish).toContain("'/v2/filings'");
    expect(() => completionScript('tcsh', program, [])).toThrow('Unknown shell tcsh');
  });
});

describe('invd agent-setup', () => {
  const connector = { name: 'invinite-financial-data', url: 'https://api.data.invinite.com/mcp' };

  it('reads the plugin connector', () => {
    expect(bundledConnector()).toEqual(connector);
  });

  it('merges the connector into Claude Code JSON, keeping every other key and server', () => {
    const merged = JSON.parse(mergeClaudeMcp(JSON.stringify({ theme: 'dark', mcpServers: { other: { url: 'x' } } }), connector));
    expect(merged).toEqual({ theme: 'dark', mcpServers: { other: { url: 'x' }, 'invinite-financial-data': { type: 'http', url: connector.url } } });
    expect(JSON.parse(mergeClaudeMcp(undefined, connector)).mcpServers['invinite-financial-data'].url).toBe(connector.url);
    expect(() => mergeClaudeMcp('[1]', connector)).toThrow('not a JSON object');
  });

  it('adds (or replaces) the Codex [mcp_servers.<name>] table', () => {
    const current = 'model = "o4"\n\n[mcp_servers.invinite-financial-data]\nurl = "https://old"\n\n[profiles.x]\na = 1\n';
    const merged = mergeCodexMcp(current, connector);
    expect(merged).toContain('model = "o4"');
    expect(merged).toContain('[profiles.x]');
    expect(merged.match(/\[mcp_servers\.invinite-financial-data\]/g)).toHaveLength(1);
    expect(merged).toContain(`url = "${connector.url}"`);
    expect(mergeCodexMcp(undefined, connector)).toBe(`[mcp_servers.invinite-financial-data]\nurl = "${connector.url}"\n`);
  });

  it('knows where each runtime reads its MCP servers', () => {
    expect(mcpConfigPath('claude', 'local', '/p', '/h')).toBe('/p/.mcp.json');
    expect(mcpConfigPath('claude', 'global', '/p', '/h')).toBe('/h/.claude.json');
    expect(mcpConfigPath('codex', 'global', '/p', '/h')).toBe('/h/.codex/config.toml');
  });

  it('--dry-run writes nothing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'invd-agent-'));
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => { lines.push(String(line ?? '')); });
    writeFileSync(join(cwd, 'keep.txt'), '');
    await createProgram().parseAsync(['node', 'invd', 'agent-setup', '--claude', '--local', '--dry-run']);
    expect(lines.join('\n')).toContain('would write MCP invinite-financial-data');
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(cwd)).toEqual(['keep.txt']);
    vi.restoreAllMocks();
  });
});

describe('update notifier', () => {
  it('never in CI, under tests, without a terminal, or when switched off', () => {
    expect(updateCheckEnabled({}, true)).toBe(true);
    expect(updateCheckEnabled({ CI: 'true' }, true)).toBe(false);
    expect(updateCheckEnabled({ INVD_NO_UPDATE_NOTIFIER: '1' }, true)).toBe(false);
    expect(updateCheckEnabled({ VITEST: 'true' }, true)).toBe(false);
    expect(updateCheckEnabled({}, false)).toBe(false);
  });

  it('compares plain versions', () => {
    expect(isNewer('4.0.1', '4.0.0')).toBe(true);
    expect(isNewer('4.0.0', '4.0.0')).toBe(false);
    expect(isNewer('3.9.9', '4.0.0')).toBe(false);
    expect(isNewer('4.1.0-beta.1', '4.0.0')).toBe(false);
  });
});
