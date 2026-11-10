import { spawnSync } from 'node:child_process';
import { UsageError } from '../shared/errors.js';

/**
 * `--jq <expr>` without a jq dependency: a built-in subset — paths (`.a.b`, `."a-b"`, `.[0]`, `.[]`, `.a?`), pipes,
 * `,`, `length`, `keys`, `select(<path> == <literal>)` (also `!= < <= > >=`, or a bare path for truthiness) and
 * literals. An expression outside it goes to a `jq` binary on PATH when there is one, else it is a usage error.
 * Results print like `jq -r`: strings raw, everything else as compact JSON.
 */
export class UnsupportedJqError extends UsageError {}

type Token = { kind: 'op' | 'ident' | 'string' | 'number'; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expr.length) {
    const char = expr[index] ?? '';
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const two = expr.slice(index, index + 2);
    if (['==', '!=', '<=', '>='].includes(two)) {
      tokens.push({ kind: 'op', value: two });
      index += 2;
      continue;
    }
    if ('.[]|,()?<>'.includes(char)) {
      tokens.push({ kind: 'op', value: char });
      index += 1;
      continue;
    }
    if (char === '"') {
      let end = index + 1;
      let value = '';
      while (end < expr.length && expr[end] !== '"') {
        if (expr[end] === '\\') end += 1;
        value += expr[end] ?? '';
        end += 1;
      }
      if (end >= expr.length) throw new UnsupportedJqError('unterminated string');
      tokens.push({ kind: 'string', value });
      index = end + 1;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(expr.slice(index));
    if (number) {
      tokens.push({ kind: 'number', value: number[0] });
      index += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expr.slice(index));
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0] });
      index += ident[0].length;
      continue;
    }
    throw new UnsupportedJqError(`unexpected ${char}`);
  }
  return tokens;
}

type Filter = (input: unknown) => unknown[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Filter {
    const filter = this.pipe();
    if (this.index < this.tokens.length) throw new UnsupportedJqError(`unexpected ${this.tokens[this.index]?.value}`);
    return filter;
  }

  private peek(value?: string): boolean {
    const token = this.tokens[this.index];
    return token !== undefined && (value === undefined || (token.kind === 'op' && token.value === value));
  }

  private take(value: string): void {
    if (!this.peek(value)) throw new UnsupportedJqError(`expected ${value}`);
    this.index += 1;
  }

  private pipe(): Filter {
    let left = this.comma();
    while (this.peek('|')) {
      this.index += 1;
      const first = left;
      const right = this.comma();
      left = input => first(input).flatMap(value => right(value));
    }
    return left;
  }

  private comma(): Filter {
    const parts = [this.term()];
    while (this.peek(',')) {
      this.index += 1;
      parts.push(this.term());
    }
    return parts.length === 1 && parts[0] ? parts[0] : input => parts.flatMap(part => part(input));
  }

  private literal(): unknown | typeof NO_LITERAL {
    const token = this.tokens[this.index];
    if (!token) return NO_LITERAL;
    if (token.kind === 'string') {
      this.index += 1;
      return token.value;
    }
    if (token.kind === 'number') {
      this.index += 1;
      return Number(token.value);
    }
    if (token.kind === 'ident' && ['true', 'false', 'null'].includes(token.value)) {
      this.index += 1;
      return token.value === 'null' ? null : token.value === 'true';
    }
    return NO_LITERAL;
  }

  private term(): Filter {
    const token = this.tokens[this.index];
    if (!token) throw new UnsupportedJqError('empty expression');
    if (token.kind === 'op' && token.value === '.') return this.path();
    if (token.kind === 'ident' && token.value === 'length') {
      this.index += 1;
      return input => [Array.isArray(input) || typeof input === 'string' ? input.length : isRecord(input) ? Object.keys(input).length : 0];
    }
    if (token.kind === 'ident' && token.value === 'keys') {
      this.index += 1;
      return input => [isRecord(input) ? Object.keys(input).sort() : Array.isArray(input) ? input.map((_v, i) => i) : []];
    }
    if (token.kind === 'ident' && token.value === 'select') {
      this.index += 1;
      this.take('(');
      const subject = this.path();
      let compare: ((value: unknown) => boolean) | undefined;
      const op = this.tokens[this.index];
      if (op?.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(op.value)) {
        this.index += 1;
        const expected = this.literal();
        if (expected === NO_LITERAL) throw new UnsupportedJqError('select compares a path with a literal only');
        compare = value => COMPARE[op.value]?.(value, expected) ?? false;
      }
      this.take(')');
      return input => (subject(input).some(value => (compare ? compare(value) : value !== null && value !== false && value !== undefined)) ? [input] : []);
    }
    const literal = this.literal();
    if (literal !== NO_LITERAL) return () => [literal];
    throw new UnsupportedJqError(`unsupported ${token.value}`);
  }

  /** `.`, then any of `name`, `"name"`, `[]`, `[n]`, `["name"]`, each optionally `?`. */
  private path(): Filter {
    this.take('.');
    const steps: Array<(value: unknown) => unknown[]> = [];
    const key = (name: string | number) => (value: unknown) => {
      if (typeof name === 'number') return Array.isArray(value) ? [value.at(name) ?? null] : [null];
      return [isRecord(value) ? value[name] ?? null : null];
    };
    const first = this.tokens[this.index];
    if (first?.kind === 'ident' || first?.kind === 'string') {
      this.index += 1;
      steps.push(key(first.value));
    }
    for (;;) {
      if (this.peek('?')) {
        this.index += 1;
        continue;
      }
      if (this.peek('.')) {
        const next = this.tokens[this.index + 1];
        if (next?.kind !== 'ident' && next?.kind !== 'string') break;
        this.index += 2;
        steps.push(key(next.value));
        continue;
      }
      if (this.peek('[')) {
        this.index += 1;
        if (this.peek(']')) {
          this.index += 1;
          steps.push(value => (Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : []));
          continue;
        }
        const inner = this.tokens[this.index];
        if (inner?.kind !== 'number' && inner?.kind !== 'string') throw new UnsupportedJqError('unsupported index');
        this.index += 1;
        this.take(']');
        steps.push(key(inner.kind === 'number' ? Number(inner.value) : inner.value));
        continue;
      }
      break;
    }
    return input => steps.reduce<unknown[]>((values, step) => values.flatMap(value => step(value)), [input]);
  }
}

const NO_LITERAL = Symbol('no literal');

const COMPARE: Record<string, (a: unknown, b: unknown) => boolean> = {
  '==': (a, b) => JSON.stringify(a) === JSON.stringify(b),
  '!=': (a, b) => JSON.stringify(a) !== JSON.stringify(b),
  '<': (a, b) => (a as number) < (b as number),
  '<=': (a, b) => (a as number) <= (b as number),
  '>': (a, b) => (a as number) > (b as number),
  '>=': (a, b) => (a as number) >= (b as number),
};

/** The built-in evaluation; throws `UnsupportedJqError` outside the subset. */
export function evaluateJq(expr: string, input: unknown): unknown[] {
  return new Parser(tokenize(expr)).parse()(input);
}

/** One result as `jq -r` prints it. */
export const jqLine = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/** The output lines of `expr` over `input`: built-in, else a `jq` on PATH, else a usage error. */
export function runJq(expr: string, input: unknown): string[] {
  try {
    return evaluateJq(expr, input).map(jqLine);
  } catch (error) {
    if (!(error instanceof UnsupportedJqError)) throw error;
    const result = spawnSync('jq', ['-r', expr], { input: JSON.stringify(input), encoding: 'utf8' });
    if (result.error) {
      throw new UnsupportedJqError(
        `--jq ${expr}: ${error.message}; the built-in subset covers paths, [], |, ",", length, keys and select(); install jq for the full language`,
      );
    }
    if (result.status !== 0) throw new UsageError(`--jq: ${result.stderr.trim()}`);
    return result.stdout.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1);
  }
}
