import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram, loadManifest } from '../../src/cli.js';
import { pick } from '../../src/formatters/flatten.js';
import { requestBody, variantExample } from '../../src/spec-body.js';
import { parseManifest, type ManifestBodyVariant } from '../../src/spec-manifest.js';
import { setJsonMode } from '../../src/shared/spinner.js';

vi.mock('../../src/shared/prompt.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/shared/prompt.js')>(),
  readStdin: vi.fn(async () => '{"type":"halt","condition":{}}'),
}));

const create = loadManifest().operations.find(operation => operation.operationId === 'createAlert')!;
const update = loadManifest().operations.find(operation => operation.operationId === 'updateAlert')!;
const variants = create.body!.variants!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (data: unknown[]) => ({ data, has_more: false, next_cursor: null, meta: {} });
let output: string[];
let errors: string[];
const run = (...args: string[]) => createProgram().parseAsync(['node', 'invd', ...args]);
const calls = () => vi.mocked(fetch).mock.calls;
const bodyAt = (index: number) => JSON.parse(String(calls()[index]?.[1]?.body));
const flagsFor = (variant: ManifestBodyVariant): string[] => variant.fields.flatMap(field => {
  const value = pick(variant.example, field.path.join('.'));
  if (value === undefined) return [];
  if (field.type === 'boolean') return [`--${value ? '' : 'no-'}${field.flag}`];
  return [`--${field.flag}`, field.type === 'json' ? JSON.stringify(value) : Array.isArray(value) ? value.join(',') : String(value)];
});

beforeEach(() => {
  setJsonMode(false);
  output = []; errors = [];
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('INVD_API_KEY', 'test');
  vi.stubEnv('INVD_BASE_URL', 'https://api.example.com');
  vi.spyOn(console, 'log').mockImplementation((value?: unknown) => { output.push(String(value)); });
  vi.spyOn(console, 'error').mockImplementation((value?: unknown) => { errors.push(String(value)); });
  vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exited'); }) as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('typed alert manifest and request dispatch', () => {
  it('contains exactly the released 18 schema examples and strict parser metadata', () => {
    const spec = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8'));
    const mapping = spec.components.schemas.AlertCreateRequest.discriminator.mapping;
    expect(variants).toHaveLength(18);
    for (const variant of variants) expect(variant.example).toEqual(spec.components.schemas[mapping[variant.type].split('/').at(-1)].example);
    const invalid = structuredClone(loadManifest());
    Object.assign(invalid.operations.find(operation => operation.operationId === 'createAlert')!.body!.variants![0]!, { stray: true });
    expect(() => parseManifest(invalid)).toThrow('Invalid command manifest');
  });

  it.each(variants.map(variant => [variant.type, variant] as const))('%s spec example becomes the identical request through registered flags', async (_type, variant) => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'alt_test' }));
    await run('alerts', 'create', ...flagsFor(variant), '--json');
    expect(bodyAt(0)).toEqual(variant.example);
    expect(calls()).toHaveLength(1);
  });

  it('keeps every flag path stable across variants and create/update', () => {
    const paths = new Map<string, string>();
    const types = new Map<string, string>();
    for (const variant of [...variants, ...update.body!.variants!]) for (const field of variant.fields) {
      const previous = paths.get(field.flag);
      if (previous) expect(field.path.join('.')).toBe(previous);
      paths.set(field.flag, field.path.join('.'));
      const previousType = types.get(field.flag);
      if (previousType) expect(field.type).toBe(previousType);
      types.set(field.flag, field.type);
    }
    expect(paths.get('condition-mode')).toBe('condition.mode');
    expect(paths.get('trigger-mode')).toBe('trigger.mode');
    expect(paths.has('mode')).toBe(false);
  });

  it('creates the documented price move and rejects foreign fields and missing nested requirements before HTTP', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'alt_test' }));
    await run('alerts', 'create', '--type', 'price_move', '--symbol', 'AAPL', '--pct', '5', '--direction', 'up', '--baseline', 'prior_close');
    expect(bodyAt(0)).toEqual({ type: 'price_move', condition: { symbol: 'AAPL', pct: 5, direction: 'up', baseline: 'prior_close' } });
    vi.mocked(fetch).mockClear();
    await expect(run('alerts', 'create', '--type', 'price_move', '--form-types', '8-K')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('--form-types is not a price_move field');
    await expect(run('alerts', 'create', '--type', 'price_move', '--symbol', 'AAPL')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('Missing --direction');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('has grouped typed help, schema example and a type overview, in either help flag order', async () => {
    for (const args of [['--help', '--type', 'fundamental_metric'], ['--type', 'fundamental_metric', '--help']]) {
      let text = '';
      const program = createProgram().exitOverride().configureOutput({ writeOut: value => { text += value; } });
      await expect(program.parseAsync(['node', 'invd', 'alerts', 'create', ...args])).rejects.toMatchObject({ code: 'commander.helpDisplayed' });
      expect(text).toContain('Condition (fundamental_metric)');
      expect(text).toContain('--rules <json> (required)');
      expect(text).toContain('Name exactly one company with cik or symbol');
      expect(text).toContain('Trigger (fundamental_metric)');
      expect(text).toContain('Delivery (fundamental_metric)');
      expect(text).toContain(variantExample(create, variants.find(variant => variant.type === 'fundamental_metric')!));
      expect(text).not.toContain('--form-types');
    }
    let text = '';
    await expect(createProgram().exitOverride().configureOutput({ writeOut: value => { text += value; } }).parseAsync(['node', 'invd', 'alerts', 'create', '--help'])).rejects.toBeTruthy();
    expect(text).toContain('--help --type <type>');
    for (const variant of variants) expect(text).toContain(`  ${variant.type}:`);
  });

  it('preserves raw-only server validation and inline/file/stdin modes', async () => {
    const raw = { type: 'unrecognized', condition: { custom: 1 } };
    vi.mocked(fetch).mockImplementation(async () => json({ id: 'alt_test' }));
    await run('alerts', 'create', '--body', JSON.stringify(raw));
    expect(bodyAt(0)).toEqual(raw);
    const path = join(process.cwd(), 'body.json');
    writeFileSync(path, JSON.stringify({ type: 'halt', condition: {} }));
    await run('alerts', 'create', '--body-file', path);
    await run('alerts', 'create', '--body-file', '-');
    expect(bodyAt(1)).toEqual({ type: 'halt', condition: {} });
    expect(bodyAt(2)).toEqual({ type: 'halt', condition: {} });
    vi.mocked(fetch).mockClear();
    await expect(run('alerts', 'create', '--body', '{}', '--body-file', path)).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('not both');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('merges structured flag overrides losslessly and rejects malformed JSON or foreign merged fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'alt_test' }));
    await run('alerts', 'create', '--body', '{"type":"indicator","condition":{"symbol":"AAPL","interval":"1h","template":{"key":"old"}},"metadata":{"keep":true}}', '--template', '{"key":"rsi-cross","inputs":{"length":14}}');
    expect(bodyAt(0)).toEqual({ type: 'indicator', condition: { symbol: 'AAPL', interval: '1h', template: { key: 'rsi-cross', inputs: { length: 14 } } }, metadata: { keep: true } });
    vi.mocked(fetch).mockClear();
    await expect(run('alerts', 'create', '--type', 'fundamental_metric', '--rules', '{broken')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('--rules expects JSON');
    await expect(run('alerts', 'create', '--body', '{"type":"halt","condition":{"pct":5}}', '--metadata', '{}')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('condition.pct is not a halt field');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates merged raw enums against the effective type while raw-only keeps server authority', async () => {
    await expect(run('alerts', 'create', '--body', '{"type":"news","condition":{"kinds":["guidance"]}}', '--type', 'dividend')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('--kinds expects one of');
    await expect(run('alerts', 'create', '--body', '{"type":"halt","condition":{"reason_codes":["TYPO"]}}', '--metadata', '{}')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('--reason-codes expects one of');
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'alt_test' }));
    await run('alerts', 'create', '--body', '{"type":"halt","condition":{"reason_codes":["TYPO"]}}');
    expect(bodyAt(0)).toEqual({ type: 'halt', condition: { reason_codes: ['TYPO'] } });
  });

  it('preserves update reference string flags and null clears', async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ id: 'alt_test' }));
    await run('alerts', 'update', 'alt_test', '--client-reference-id', 'my-reference', '--external-user-id', 'user-1');
    expect(bodyAt(0)).toEqual({ client_reference_id: 'my-reference', external_user_id: 'user-1' });
    await run('alerts', 'update', 'alt_test', '--body', '{"client_reference_id":null,"external_user_id":null}');
    expect(bodyAt(1)).toEqual({ client_reference_id: null, external_user_id: null });
    await run('alerts', 'update', 'alt_test', '--body', '{"client_reference_id":null,"external_user_id":null}', '--metadata', '{}');
    expect(bodyAt(2)).toEqual({ client_reference_id: null, external_user_id: null, metadata: {} });
    expect(calls().every(([, init]) => init?.method === 'PATCH')).toBe(true);
  });

  it('validates type-specific enums and rejects non-finite or fractional integer arguments', async () => {
    await expect(run('alerts', 'create', '--type', 'halt', '--reason-codes', 'typo')).rejects.toThrow('exited');
    await expect(run('alerts', 'create', '--type', 'price_move', '--pct', 'NaN')).rejects.toThrow('exited');
    await expect(run('alerts', 'create', '--type', 'price_reminder', '--time-of-day-minutes', '1.5')).rejects.toThrow('exited');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces required paths inside structured objects and array items', async () => {
    await expect(run('alerts', 'create', '--type', 'indicator', '--symbol', 'AAPL', '--interval', '1h', '--template', '{}')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('condition.template.key');
    await expect(run('alerts', 'create', '--type', 'fundamental_metric', '--symbol', 'AAPL', '--rules', '[{}]')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('condition.rules.*.metric_id');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces required map entries in script bindings and nested nodes, allowing absent or empty maps', async () => {
    const script = variants.find(variant => variant.type === 'script')!;
    const flags = flagsFor(script);
    await expect(run('alerts', 'create', ...flags, '--series-inputs', '{"rsi":{}}')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('condition.series_inputs.*.kind');
    const nodes = [{ node_key: 'producer', script_version_id: 'scv_01JQAA00000000000000000000', series_inputs: { rsi: {} } }];
    await expect(run('alerts', 'create', ...flags, '--nodes', JSON.stringify(nodes))).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('condition.nodes.*.series_inputs.*.kind');
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementation(async () => json({ id: 'alt_test' }));
    await run('alerts', 'create', ...flags, '--series-inputs', '{}');
    expect(bodyAt(0)).toEqual({ ...(script.example as Record<string, unknown>), condition: { ...(pick(script.example, 'condition') as Record<string, unknown>), series_inputs: {} } });
    await run('alerts', 'create', ...flags);
    expect(bodyAt(1)).toEqual(script.example);
  });

  it('infers update type before PATCH; explicit type and settings-only writes need no GET', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ type: 'news' })).mockResolvedValueOnce(json({ id: 'alt_test' }));
    await run('alerts', 'update', 'alt_test', '--symbols', 'MSFT');
    expect(calls().map(([, init]) => init?.method)).toEqual(['GET', 'PATCH']);
    expect(bodyAt(1)).toEqual({ type: 'news', condition: { symbols: ['MSFT'] } });
    vi.mocked(fetch).mockClear().mockImplementation(async () => json({ id: 'alt_test' }));
    await run('alerts', 'update', 'alt_test', '--type', 'news', '--symbols', 'AAPL');
    expect(calls()).toHaveLength(1);
    expect(bodyAt(0)).toEqual({ type: 'news', condition: { symbols: ['AAPL'] } });
    vi.mocked(fetch).mockClear();
    await run('alerts', 'update', 'alt_test', '--metadata', '{"tag":"test"}', '--trigger-mode', 'once');
    expect(calls()).toHaveLength(1);
    expect(bodyAt(0)).toEqual({ metadata: { tag: 'test' }, trigger: { mode: 'once' } });
  });

  it('sends no PATCH after failed type lookup, and dry-run stays offline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ detail: 'missing', code: 'not_found' }, 404));
    await expect(run('alerts', 'update', 'alt_test', '--symbols', 'MSFT')).rejects.toThrow('exited');
    expect(calls()).toHaveLength(1);
    expect(calls()[0]?.[1]?.method).toBe('GET');
    vi.mocked(fetch).mockClear();
    await expect(run('alerts', 'update', 'alt_test', '--symbols', 'MSFT', '--dry-run')).rejects.toThrow('exited');
    expect(errors.join('\n')).toContain('--dry-run stays offline');
    await run('alerts', 'update', 'alt_test', '--type', 'news', '--symbols', 'MSFT', '--dry-run', '--json');
    expect(JSON.parse(output.at(-1)!).steps[0].body).toEqual({ type: 'news', condition: { symbols: ['MSFT'] } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates inferred condition fields against their stored type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ type: 'halt' }));
    await expect(run('alerts', 'update', 'alt_test', '--form-types', '8-K')).rejects.toThrow('exited');
    expect(calls()).toHaveLength(1);
    expect(errors.join('\n')).toContain('not a halt field');
  });

  it('retains raw-only validation without even invoking inference', async () => {
    const infer = vi.fn();
    await expect(requestBody(update, { body: '{"condition":{"symbols":["MSFT"]}}' }, infer)).resolves.toEqual({ condition: { symbols: ['MSFT'] } });
    expect(infer).not.toHaveBeenCalled();
  });
});

describe('typed event output and catalogs', () => {
  const fired = { id: 'evt_1', type: 'alert.fired', alert_id: 'alt_1', occurred_at: '2026-11-27T00:00:00Z', payload: { alert_type: 'price_move', reason: { details: { pct: 5, baseline: 'prior_close' } } } };
  const notice = { id: 'evt_2', type: 'alert_user.fire_cap_reached', occurred_at: '2026-11-27T00:00:00Z', payload: { external_user_id: 'u1' } };
  it('uses exactly the six feed discriminator values and never delivery-only batch', () => {
    const operation = loadManifest().operations.find(item => item.operationId === 'getAlertEvent')!;
    expect(operation.discriminatorValues).toHaveLength(6);
    expect(operation.discriminatorValues).toContain('alert_user.fire_cap_reached');
    expect(operation.discriminatorValues).not.toContain('alert.fired.batch');
    const tail = createProgram().commands.find(command => command.name() === 'alert-events')!.commands.find(command => command.name() === 'tail')!;
    expect(tail.options.find(option => option.long === '--type')!.description).toContain('alert_user.fire_cap_reached');
  });
  it('exposes shared union fields for list/member help and selectors', () => {
    for (const id of ['listAlerts', 'getAlert', 'listAlertEvents', 'getAlertEvent']) {
      const fields = loadManifest().operations.find(item => item.operationId === id)!.fields;
      expect(fields).toContain('id'); expect(fields).toContain('type');
      expect(fields).toContain(id.includes('Event') ? 'payload' : 'condition');
    }
  });
  it('renders fired details and alert_type as table fields while non-fired events retain their output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(fired)).mockResolvedValueOnce(json(notice));
    await run('alert-events', 'get', 'evt_1', '--plain');
    expect(output.join('\n')).toContain('payload.alert_type');
    expect(output.join('\n')).toContain('payload.reason.details.pct');
    expect(output.join('\n')).toContain('price_move');
    await run('alert-events', 'get', 'evt_2', '--plain');
    expect(output.at(-1)).toContain('alert_user.fire_cap_reached');
  });
  it('keeps fired/non-fired JSON projection and list output', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page([fired, notice]))).mockResolvedValueOnce(json(fired)).mockResolvedValueOnce(json(page([fired, notice])));
    await run('alert-events', 'list', '--json', 'id,type,payload.alert_type');
    expect(JSON.parse(output.at(-1)!).data).toEqual([{ id: 'evt_1', type: 'alert.fired', 'payload.alert_type': 'price_move' }, { id: 'evt_2', type: 'alert_user.fire_cap_reached', 'payload.alert_type': null }]);
    await run('alert-events', 'get', 'evt_1', '--json', 'payload.reason.details');
    expect(JSON.parse(output.at(-1)!)).toEqual({ 'payload.reason.details': { pct: 5, baseline: 'prior_close' } });
    await run('alert-events', 'list', '--plain');
    expect(output.at(-1)).toContain('alert.fired'); expect(output.at(-1)).toContain('alert_user.fire_cap_reached');
  });
  it.each(['alert-types', 'news-kinds', 'halt-reasons', 'dividend-types'])('registers the %s catalog from x-cli', async action => {
    vi.mocked(fetch).mockResolvedValueOnce(json(page([{ type: 'halt', name: 'Halt', family: 'market', coverage: 'US stocks' }])));
    await run('catalog', action, '--plain');
    expect(String(calls()[0]?.[0])).toContain(`/v1/catalog/${action}`);
    if (action === 'alert-types') expect(output.at(-1)).toContain('type\tname\tfamily\tcoverage');
  });
});
