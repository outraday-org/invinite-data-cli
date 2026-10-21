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

const ok = { 200: { description: 'ok' } };

const fixture = () => ({
  openapi: '3.0.0',
  info: { title: 'fixture', version: '9.9.9' },
  tags: [{ name: 'Things', description: 'Things and more' }, { name: 'Other', description: 'Other' }],
  components: {
    parameters: {
      Limit: { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 10 } },
    },
  },
  paths: {
    '/v1/things/search': {
      get: {
        operationId: 'thingsSearch',
        summary: 'Search things',
        tags: ['Things'],
        parameters: [
          { name: 'query', in: 'query', required: true, description: 'Text', schema: { type: 'string' } },
          { $ref: '#/components/parameters/Limit' },
          { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30] } },
          { name: 'status', in: 'query', schema: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } },
        ],
        responses: ok,
        'x-cli': {
          group: 'things', action: 'search', view: 'table', rowsPath: 'things', columns: ['name'],
          flags: { query: 'q' }, pagination: 'top',
        },
      },
    },
    '/v1/things/{thing_id}': {
      get: {
        operationId: 'thingsGet',
        summary: 'One thing',
        tags: ['Things'],
        parameters: [{ name: 'thing_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: ok,
        'x-cli': { group: 'things', action: 'get', view: 'keyValue', rowsPath: 'thing', pagination: 'none' },
      },
    },
    '/v1/things/history': {
      get: {
        operationId: 'thingsHistory',
        summary: 'History',
        tags: ['Things'],
        responses: ok,
        'x-cli': { group: 'things', action: 'history', allItemsPath: 'periods', pagination: 'perCompany' },
      },
    },
    '/v1/hooks': {
      post: {
        operationId: 'hooksCreate',
        summary: 'Create a hook',
        tags: ['Things', 'Other'],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 201: { description: 'created' } },
        'x-cli': { group: 'hooks', action: 'create', groupDescription: 'Hooks', pagination: 'none' },
      },
    },
    '/v1/things/download': {
      get: {
        operationId: 'thingsDownload',
        summary: 'Download',
        tags: ['Things'],
        responses: ok,
        'x-cli': { exclude: 'hand-written: invd things download' },
      },
    },
    '/v1/ws': { ws: { summary: 'socket', responses: ok } },
  },
});

const build = (spec: unknown) => buildManifest(spec, JSON.stringify(spec));

describe('buildManifest', () => {
  it('maps types, a $ref parameter, an integer enum, an array enum and an alias', () => {
    const search = build(fixture()).operations.find(operation => operation.operationId === 'thingsSearch');
    expect(search?.params).toEqual([
      { name: 'query', in: 'query', required: true, type: 'string', description: 'Text', alias: 'q' },
      { name: 'limit', in: 'query', required: false, type: 'integer', default: 10 },
      { name: 'days', in: 'query', required: false, type: 'integer', enum: ['7', '30'] },
      { name: 'status', in: 'query', required: false, type: 'array', items: 'string', enum: ['a', 'b'] },
    ]);
    expect(search).toMatchObject({ method: 'get', view: 'table', pagination: 'top', allItemsPath: ['things'] });
  });

  it('a path parameter is required, a body op records its body, view defaults to json', () => {
    const manifest = build(fixture());
    const get = manifest.operations.find(operation => operation.operationId === 'thingsGet');
    expect(get?.params[0]).toMatchObject({ name: 'thing_id', in: 'path', required: true });
    const create = manifest.operations.find(operation => operation.operationId === 'hooksCreate');
    expect(create).toMatchObject({ method: 'post', body: { required: true, contentType: 'application/json' }, view: 'json' });
    const history = manifest.operations.find(operation => operation.operationId === 'thingsHistory');
    expect(history).toMatchObject({ pagination: 'perCompany', allItemsPath: ['periods'] });
  });

  it('carries parameter examples, x-example-params and the request-body example; refuses an unknown example param', () => {
    const spec = fixture();
    const search = spec.paths['/v1/things/search'].get;
    spec.paths['/v1/things/search'].get = {
      ...search,
      parameters: [{ ...search.parameters[0], example: 'apple' }, ...search.parameters.slice(1)],
      'x-example-params': ['days'],
    } as typeof search;
    const hook = spec.paths['/v1/hooks'].post;
    hook.requestBody.content['application/json'] = { schema: { type: 'object' }, example: { url: 'https://x.test' } } as never;
    const manifest = build(spec);
    const built = manifest.operations.find(operation => operation.operationId === 'thingsSearch');
    expect(built?.params[0]).toMatchObject({ name: 'query', example: 'apple' });
    expect(built?.exampleParams).toEqual(['days']);
    expect(manifest.operations.find(operation => operation.operationId === 'hooksCreate')?.body)
      .toEqual({ required: true, contentType: 'application/json', example: { url: 'https://x.test' } });
    spec.paths['/v1/things/search'].get = { ...spec.paths['/v1/things/search'].get, 'x-example-params': ['nope'] } as typeof search;
    expect(() => build(spec)).toThrow(/GET \/v1\/things\/search: x-example-params names no parameter: nope/);
  });

  it('auth: an operation security list wins over the document one; none at all or [] is public', () => {
    const spec = fixture();
    spec.paths['/v1/things/search'].get = { ...spec.paths['/v1/things/search'].get, security: [{ bearerAuth: [] }] };
    spec.paths['/v1/things/{thing_id}'].get = { ...spec.paths['/v1/things/{thing_id}'].get, security: [] };
    const auth = (manifestSpec: unknown) => Object.fromEntries(build(manifestSpec).operations
      .map(operation => [operation.operationId, operation.auth]));
    expect(auth(spec)).toMatchObject({ thingsSearch: true, thingsGet: false, thingsHistory: false });
    expect(auth({ ...spec, security: [{ bearerAuth: [] }] }))
      .toMatchObject({ thingsSearch: true, thingsGet: false, thingsHistory: true });
  });

  it('omits excluded and non-HTTP operations, sorts, and describes each group once', () => {
    const manifest = build(fixture());
    expect(manifest.operations.map(operation => `${operation.group} ${operation.action}`))
      .toEqual(['hooks create', 'things get', 'things history', 'things search']);
    expect(manifest.groups).toEqual([
      { name: 'hooks', description: 'Hooks' },
      { name: 'things', description: 'Things and more' },
    ]);
    expect(manifest.specVersion).toBe('9.9.9');
    expect(manifest.specSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses what the manifest adds, by name', () => {
    const noAllPath = fixture();
    delete (noAllPath.paths['/v1/things/history'].get['x-cli'] as { allItemsPath?: string }).allItemsPath;
    expect(() => build(noAllPath)).toThrow(/GET \/v1\/things\/history: a perCompany operation needs x-cli.allItemsPath/);

    const twoTags = fixture();
    delete (twoTags.paths['/v1/hooks'].post['x-cli'] as { groupDescription?: string }).groupDescription;
    expect(() => build(twoTags)).toThrow(/group "hooks": spans 2 tags/);

    const twoDescriptions = fixture();
    Object.assign(twoDescriptions.paths['/v1/things/history'].get['x-cli'], { groupDescription: 'A' });
    Object.assign(twoDescriptions.paths['/v1/things/{thing_id}'].get['x-cli'], { groupDescription: 'B' });
    expect(() => build(twoDescriptions)).toThrow(/group "things": two descriptions/);

    const badType = fixture();
    badType.paths['/v1/things/{thing_id}'].get.parameters.push({ name: 'x', in: 'query', required: false, schema: { type: 'object' } });
    expect(() => build(badType)).toThrow(/parameter "x": unmappable type "object"/);

    const reserved = fixture();
    reserved.paths['/v1/things/{thing_id}'].get.parameters.push({ name: 'all', in: 'query', required: false, schema: { type: 'string' } });
    expect(() => build(reserved)).toThrow(/--all collides with an invd flag/);

    const topWithoutRows = fixture();
    delete (topWithoutRows.paths['/v1/things/search'].get['x-cli'] as { rowsPath?: string }).rowsPath;
    expect(() => build(topWithoutRows)).toThrow(/a top-paginated operation needs x-cli.rowsPath or allItemsPath/);
  });
});

describe('runBuildCliManifest --check', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it('exits 0 when current, 1 when the spec changed or the manifest is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'invd-manifest-'));
    const specPath = join(dir, 'openapi.json');
    const manifestPath = join(dir, 'generated', 'cli-manifest.json');
    writeFileSync(specPath, JSON.stringify(fixture()));

    expect(runBuildCliManifest({ specPath, manifestPath, check: true })).toBe(1);
    expect(runBuildCliManifest({ specPath, manifestPath, check: false })).toBe(0);
    expect(runBuildCliManifest({ specPath, manifestPath, check: true })).toBe(0);

    const edited = fixture();
    edited.paths['/v1/things/search'].get.summary = 'Search things!';
    writeFileSync(specPath, JSON.stringify(edited));
    expect(runBuildCliManifest({ specPath, manifestPath, check: true })).toBe(1);
  });

  it('the committed manifest is what the bundled openapi.json produces', () => {
    const specText = readFileSync(DEFAULT_SPEC_PATH, 'utf8');
    expect(readFileSync(DEFAULT_MANIFEST_PATH, 'utf8')).toBe(serializeManifest(buildManifest(JSON.parse(specText), specText)));
  });
});
