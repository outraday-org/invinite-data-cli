import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildManifest,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_SPEC_PATH,
  runBuildCliManifest,
  serializeManifest,
} from '../../../scripts/build-cli-manifest.js';

const envelope = (row: string) => ({
  200: {
    description: 'page',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: `#/components/schemas/${row}` } },
            has_more: { type: 'boolean' },
            next_cursor: { type: 'string', nullable: true },
            meta: { type: 'object' },
          },
        },
      },
    },
  },
});
const object = (ref: string) => ({ 200: { description: 'one', content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } } });
const stamps = { 'x-credits': 1, 'x-tier': 'standard' };

const fixture = () => ({
  openapi: '3.1.0',
  info: { title: 'fixture', version: '2026-11-09' },
  security: [{ bearerAuth: [] }],
  tags: [{ name: 'Things', description: 'Things and more' }, { name: 'Shared', description: 'Shared tag' }],
  components: {
    parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 }, example: 25 } },
    schemas: {
      Thing: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
      ThingDoc: {
        type: 'object',
        properties: { id: { type: 'string' }, pdf: { type: 'object', properties: { url: { type: 'string' }, sha256: { type: 'string' } } } },
      },
    },
  },
  paths: {
    '/v1/legacy': { get: { operationId: 'legacy', responses: object('Thing'), 'x-cli': { group: 'legacy', action: 'get', pagination: 'none' } } },
    '/v2/things': {
      get: {
        operationId: 'listThings', summary: 'List things', tags: ['Things'], ...stamps,
        parameters: [
          { name: 'company', in: 'query', required: true, description: 'Ticker or CIK', schema: { type: 'string' }, example: 'AAPL' },
          { name: 'filed_at.gte', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-01-01' },
          { name: 'statement', in: 'query', schema: { type: 'string', pattern: '^(a|b)(,(a|b))*$' } },
          { name: 'reported_only', in: 'query', schema: { type: 'boolean' } },
          { name: 'fields', in: 'query', schema: { type: 'string' } },
          { $ref: '#/components/parameters/Limit' },
        ],
        responses: envelope('Thing'),
        'x-cli': { group: 'things', action: 'list', positional: 'company', flags: { limit: 'l' }, columns: ['id', 'name'] },
        'x-example-params': ['filed_at.gte'],
      },
      post: {
        operationId: 'createThing', summary: 'Create a thing', tags: ['Things'], ...stamps,
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['url'],
                properties: {
                  url: { type: 'string' }, events: { type: 'array', items: { type: 'string' } },
                  filters: { type: 'object', properties: { ciks: { type: 'array', items: { type: 'string' } } } },
                },
              },
              example: { url: 'https://x' },
            },
          },
        },
        responses: object('Thing'),
        'x-cli': { group: 'things', action: 'create', flags: { url: 'u' }, columns: ['id'] },
      },
    },
    '/v2/things/{id}': {
      get: {
        operationId: 'getThing', summary: 'Get a thing', tags: ['Things'], ...stamps,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 't1' }],
        responses: object('ThingDoc'),
        'x-cli': { group: 'things', action: 'get', positional: 'id' },
      },
    },
    '/v2/sums/a': {
      get: {
        operationId: 'getSumA', summary: 'Sum A', tags: ['Shared'], 'x-credits': 1, 'x-tier': 'free',
        parameters: [{ name: 'company', in: 'query', required: true, schema: { type: 'string' } }],
        responses: envelope('Thing'),
        'x-cli': { group: 'sums', action: 'get', positional: 'company', command: 'sums', select: { basis: 'a' } },
      },
    },
    '/v2/sums/b': {
      get: {
        operationId: 'getSumB', summary: 'Sum B', tags: ['Shared'], 'x-credits': 2, 'x-tier': 'pro',
        parameters: [{ name: 'company', in: 'query', required: true, schema: { type: 'string' } }],
        responses: envelope('Thing'),
        'x-cli': { group: 'sums', action: 'get', positional: 'company', command: 'sums', select: { basis: 'b' } },
      },
      ws: { operationId: 'stream' },
    },
  },
});

const build = (spec: unknown = fixture()) => buildManifest(spec, JSON.stringify(spec));
const op = (manifest: ReturnType<typeof build>, id: string) => manifest.operations.find(operation => operation.operationId === id);

describe('buildManifest (v2)', () => {
  it('skips v1 and non-HTTP operations, groups by x-cli, describes single-tag groups by their tag', () => {
    const manifest = build();
    expect(manifest.operations.map(operation => operation.operationId).sort()).toEqual(['createThing', 'getSumA', 'getSumB', 'getThing', 'listThings']);
    expect(manifest.groups).toEqual([{ name: 'sums', description: 'Shared tag' }, { name: 'things', description: 'Things and more' }]);
    expect(manifest.specVersion).toBe('2026-11-09');
  });

  it('a list: positional company (comma-variadic), flags with dots → dashes, pattern, boolean, alias, row fields, table view', () => {
    const list = op(build(), 'listThings');
    expect(list).toMatchObject({ group: 'things', action: 'list', list: true, view: 'table', columns: ['id', 'name'], fields: ['id', 'name'], credits: 1, tier: 'standard', auth: true });
    expect(list?.positional).toEqual({ name: 'company', required: true, variadic: 'comma' });
    expect(list?.params.map(param => param.flag)).toEqual(['company', 'filed-at-gte', 'statement', 'reported-only', 'fields', 'limit']);
    expect(list?.params.find(param => param.name === 'statement')?.pattern).toBe('^(a|b)(,(a|b))*$');
    expect(list?.params.find(param => param.name === 'limit')).toMatchObject({ alias: 'l', default: 25, example: 25 });
    expect(list?.exampleParams).toEqual(['filed_at.gte']);
  });

  it('a member: path positional (never variadic), key/value only with columns, the download object', () => {
    const get = op(build(), 'getThing');
    expect(get).toMatchObject({ list: false, view: 'json', download: 'pdf', fields: ['id', 'pdf'] });
    expect(get?.positional).toEqual({ name: 'id', required: true });
  });

  it('a body: flags for its scalar / list properties one object deep, a header parameter, the example', () => {
    const create = op(build(), 'createThing');
    expect(create?.body?.fields).toEqual([
      { path: ['url'], type: 'string', required: true, flag: 'url', alias: 'u' },
      { path: ['events'], type: 'array', items: 'string', required: false, flag: 'events' },
      { path: ['filters', 'ciks'], type: 'array', items: 'string', required: false, flag: 'ciks' },
    ]);
    expect(create?.body?.example).toEqual({ url: 'https://x' });
    expect(create?.params[0]).toMatchObject({ name: 'Idempotency-Key', in: 'header', flag: 'idempotency-key' });
    expect(create?.view).toBe('keyValue');
  });

  it('x-cli.command: one command (action "") over several operations told apart by select', () => {
    const manifest = build();
    expect(manifest.operations.filter(operation => operation.group === 'sums').map(operation => [operation.action, operation.select, operation.credits]))
      .toEqual([['', { basis: 'a' }, 1], ['', { basis: 'b' }, 2]]);
  });

  it('refuses what the manifest would get wrong, by name', () => {
    const clash = fixture();
    clash.paths['/v2/things'].get.parameters.push({ name: 'json', in: 'query', schema: { type: 'string' } } as never);
    expect(() => build(clash)).toThrow('--json collides with an invd flag of its own');

    const alias = fixture();
    alias.paths['/v2/things'].get['x-cli'].flags = { limit: 'h' };
    expect(() => build(alias)).toThrow('-h collides');

    const twice = fixture();
    (twice.paths['/v2/things/{id}'].get['x-cli'] as Record<string, unknown>).action = 'list';
    expect(() => build(twice)).toThrow('invd things list is also GET /v2/things');

    const stampless = fixture();
    delete (stampless.paths['/v2/things/{id}'].get as Record<string, unknown>)['x-credits'];
    expect(() => build(stampless)).toThrow('x-credits / x-tier missing');

    const positional = fixture();
    positional.paths['/v2/things/{id}'].get['x-cli'].positional = 'nope';
    expect(() => build(positional)).toThrow('x-cli.positional names no parameter: nope');

    const shared = fixture();
    shared.paths['/v2/things/{id}'].get.tags = ['Shared'];
    (shared.paths['/v2/things/{id}'].get['x-cli'] as Record<string, unknown>).group = 'others';
    expect(() => build(shared)).toThrow('shares tag "Shared"');
  });
});

describe('runBuildCliManifest', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'invd-manifest-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('exits 0 when current, 1 when the spec changed or the manifest is missing', () => {
    const specPath = join(dir, 'openapi.json');
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(specPath, JSON.stringify(fixture()));
    expect(runBuildCliManifest({ specPath, manifestPath, check: true })).toBe(1);
    expect(runBuildCliManifest({ specPath, manifestPath, check: false })).toBe(0);
    expect(runBuildCliManifest({ specPath, manifestPath, check: true })).toBe(0);
    writeFileSync(specPath, JSON.stringify({ ...fixture(), info: { title: 'x', version: '2' } }));
    expect(runBuildCliManifest({ specPath, manifestPath, check: true })).toBe(1);
  });

  it('the committed manifest is what the bundled openapi.json produces', () => {
    const text = readFileSync(DEFAULT_SPEC_PATH, 'utf8');
    expect(readFileSync(DEFAULT_MANIFEST_PATH, 'utf8')).toBe(serializeManifest(buildManifest(JSON.parse(text), text)));
  });
});
