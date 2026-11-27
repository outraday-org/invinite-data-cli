import { readFile } from 'node:fs/promises';
import { pick } from './formatters/flatten.js';
import { UsageError } from './shared/errors.js';
import { splitList } from './shared/options.js';
import { readStdin } from './shared/prompt.js';
import { attributeName } from './spec-flags.js';
import { commandName, type ManifestBodyField, type ManifestBodyVariant, type ManifestOperation } from './spec-manifest.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (['__proto__', 'constructor', 'prototype'].includes(head)) throw new UsageError('Invalid body field path');
  if (!rest.length) {
    target[head] = value;
    return;
  }
  const child = isRecord(target[head]) ? target[head] : {};
  target[head] = child;
  setPath(child, rest, value);
}

function checkEnum(field: ManifestBodyField, value: unknown): void {
  if (field.enum && (Array.isArray(value) ? value : [value]).some(item => !field.enum?.includes(String(item)))) {
    throw new UsageError(`--${field.flag} expects one of ${field.enum.join(', ')}`);
  }
}

function fieldValue(field: ManifestBodyField, raw: unknown): unknown {
  if (field.type === 'json') {
    try {
      return JSON.parse(String(raw));
    } catch {
      throw new UsageError(`--${field.flag} expects JSON (quote the complete object or array)`);
    }
  }
  if (field.type === 'number' || field.type === 'integer') {
    const value = Number(raw);
    if (String(raw).trim() === '' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) {
      throw new UsageError(`--${field.flag} expects ${field.type === 'integer' ? 'an integer' : 'a number'}`);
    }
    return value;
  }
  const numeric = field.items === 'integer' || field.items === 'number';
  const value = field.type === 'array' ? splitList(String(raw)).map(item => numeric ? Number(item) : item) : raw;
  const invalidNumber = (item: unknown) => typeof item === 'number' && (!Number.isFinite(item) || (field.items === 'integer' && !Number.isInteger(item)));
  if (Array.isArray(value) && value.some(invalidNumber)) {
    throw new UsageError(`--${field.flag} expects a list of ${field.items} values`);
  }
  checkEnum(field, value);
  return value;
}

async function rawBody(opts: Record<string, unknown>): Promise<unknown> {
  const inline = typeof opts.body === 'string' ? opts.body : undefined;
  const file = typeof opts.bodyFile === 'string' ? opts.bodyFile : undefined;
  if (inline !== undefined && file !== undefined) throw new UsageError('Pass --body or --body-file, not both');
  if (inline === undefined && file === undefined) return undefined;
  const text = inline ?? (file === '-' ? await readStdin() : await readFile(file ?? '', 'utf8'));
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${inline !== undefined ? '--body' : '--body-file'} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function selectedVariant(operation: ManifestOperation, body: Record<string, unknown>): ManifestBodyVariant | undefined {
  const variants = operation.body?.variants;
  if (!variants || body.type === undefined) return undefined;
  const variant = variants.find(candidate => candidate.type === body.type);
  if (!variant) throw new UsageError(`--type must be one of ${variants.map(candidate => candidate.type).join(', ')}`);
  return variant;
}

function missingPath(value: unknown, path: readonly string[]): boolean {
  const [head, ...rest] = path;
  if (head === undefined) return value === undefined;
  if (value === undefined || value === null) return false;
  if (head === '*') return Array.isArray(value) && value.some(item => missingPath(item, rest));
  return isRecord(value) && (rest.length === 0 ? value[head] === undefined : missingPath(value[head], rest));
}

function checkVariant(operation: ManifestOperation, body: Record<string, unknown>, fields: ManifestBodyField[]): void {
  const variant = selectedVariant(operation, body);
  if (!variant) {
    if (operation.operationId === 'createAlert') throw new UsageError('Pass --type <type>; see --help for the 18 alert types');
    return;
  }
  for (const field of fields) {
    if (!variant.fields.some(candidate => candidate.flag === field.flag)) {
      throw new UsageError(`--${field.flag} is not a ${variant.type} field (${variant.type} takes: ${variant.fields.map(candidate => `--${candidate.flag}`).join(', ')})`);
    }
  }
  // Mixed raw input remains intact, but must not sneak a foreign field into a typed request.
  for (const parent of ['condition', 'trigger']) {
    const value = body[parent];
    if (!isRecord(value)) continue;
    for (const name of Object.keys(value)) {
      if (!variant.fields.some(field => field.path[0] === parent && field.path[1] === name)) {
        throw new UsageError(`${parent}.${name} is not a ${variant.type} field`);
      }
    }
  }
  for (const field of variant.fields) {
    const value = pick(body, field.path.join('.'));
    if (value !== undefined) checkEnum(field, value);
  }
  const needsCondition = operation.operationId === 'createAlert' || body.condition !== undefined;
  if (operation.operationId === 'createAlert') body.condition ??= {};
  for (const path of variant.required) {
    if (path[0] === 'condition' && !needsCondition) continue;
    if (!missingPath(body, path)) continue;
    const field = variant.fields.find(candidate => candidate.path.every((part, index) => path[index] === part));
    const nested = field && field.path.length < path.length ? ` (${path.join('.')})` : '';
    throw new UsageError(`Missing --${field?.flag ?? path.join('-')}${nested} for ${variant.type}`);
  }
}

/** Raw-only requests retain server validation; mixed flags are checked against the effective variant after merging. */
export async function requestBody(
  operation: ManifestOperation,
  opts: Record<string, unknown>,
  inferType: () => Promise<string>,
): Promise<unknown> {
  let body = await rawBody(opts);
  const fields = (operation.body?.fields ?? []).filter(field => opts[attributeName(field.flag)] !== undefined);
  if (!fields.length && body !== undefined) return body;
  if (body !== undefined && !isRecord(body)) throw new UsageError('--body must be a JSON object to combine with field flags');
  const merged: Record<string, unknown> = isRecord(body) ? body : {};
  if (operation.body?.variants && opts.type !== undefined) merged.type = opts.type;
  const conditionEdit = merged.condition !== undefined || fields.some(field => field.path[0] === 'condition');
  if (operation.operationId === 'updateAlert' && conditionEdit && merged.type === undefined) {
    if (opts.dryRun) throw new UsageError('Condition flags need GET /v1/alerts/{id} to infer the type; --dry-run stays offline. Pass --type <type> for a resolved preview.');
    merged.type = await inferType();
  }
  for (const field of fields) {
    const variantField = operation.body?.variants?.find(variant => variant.type === merged.type)?.fields.find(candidate => candidate.flag === field.flag);
    const effective = field.path[0] === 'type' && operation.body?.variants ? { ...field, enum: undefined } : variantField ?? field;
    setPath(merged, field.path, fieldValue(effective, opts[attributeName(field.flag)]));
  }
  if (operation.body?.variants) checkVariant(operation, merged, fields);
  body = fields.length || operation.body?.variants ? merged : body;
  if (body === undefined && operation.body?.required) throw new UsageError('This command needs a request body: field flags, --body / --body-file');
  return body;
}

const shell = (value: string): string => /^[A-Za-z0-9_.,:/-]+$/.test(value) ? value : `'${value.replace(/'/g, '\'"\'"\'')}'`;

/** The schema example, losslessly represented using the same flags as the dispatcher. */
export function variantExample(operation: ManifestOperation, variant: ManifestBodyVariant): string {
  const example = variant.example;
  const flags = variant.fields.flatMap(field => {
    const value = pick(example, field.path.join('.'));
    if (value === undefined) return [];
    if (field.type === 'boolean') return [`--${value ? '' : 'no-'}${field.flag}`];
    let text = String(value);
    if (Array.isArray(value)) text = value.join(',');
    if (field.type === 'json') text = JSON.stringify(value);
    return [`--${field.flag} ${shell(text)}`];
  });
  return `invd ${commandName(operation)} ${flags.join(' ')}`;
}

export function variantHelp(operation: ManifestOperation, type: unknown): string {
  const variants = operation.body?.variants ?? [];
  const variant = variants.find(candidate => candidate.type === type);
  const lookup = operation.operationId === 'updateAlert' ? '\nCondition flags without --type first GET the alert to infer its type (one extra request). --dry-run requires explicit --type. Settings-only updates need no lookup.\n' : '';
  if (!variant) return `\nAlert types (use --help --type <type>):\n${variants.map(item => `  ${item.type}: ${item.description}`).join('\n')}\n${lookup}`;
  const groups = ['Condition', 'Trigger', 'Delivery'].map(group => {
    const parent = group.toLowerCase();
    const fields = variant.fields.filter(field => parent === 'delivery' ? !['condition', 'trigger'].includes(field.path[0] ?? '') : field.path[0] === parent);
    return `${group} (${variant.type}):\n${fields.map(field => `  --${field.flag}${field.type === 'json' ? ' <json>' : ''}${field.required ? ' (required)' : ''}: ${field.description ?? ''}`).join('\n')}`;
  });
  return `\n${groups.join('\n\n')}\n${variant.notes.join('\n')}\nExample: ${variantExample(operation, variant)}\n${lookup}`;
}
