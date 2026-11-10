/**
 * The flat TOML subset `invd`'s config files use: `key = value` lines, `#` comments, basic strings, integers,
 * floats and booleans. A table header or any other construct fails by line number rather than being guessed at.
 */
export type TomlValue = string | number | boolean;

const KEY = /^[A-Za-z0-9_-]+$/;

function parseString(raw: string, line: number): string {
  let out = '';
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index];
    if (char !== '\\') {
      out += char;
      continue;
    }
    index += 1;
    const escaped = raw[index];
    const map: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' };
    const value = escaped === undefined ? undefined : map[escaped];
    if (value === undefined) throw new Error(`line ${line}: unsupported escape \\${escaped ?? ''}`);
    out += value;
  }
  return out;
}

/** Strips a trailing `# comment` that is not inside a string. */
function stripComment(text: string): string {
  // The quote that opened the current string (`"` or `'`); the other one inside it is just a character.
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && quote === '"') {
      index += 1;
      continue;
    }
    if (quote === undefined && (char === '"' || char === "'")) quote = char;
    else if (char === quote) quote = undefined;
    else if (char === '#' && quote === undefined) return text.slice(0, index);
  }
  return text;
}

function parseValue(raw: string, line: number): TomlValue {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return parseString(raw, line);
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (/^[+-]?\d+(\.\d+)?$/.test(raw.replace(/_/g, ''))) return Number(raw.replace(/_/g, ''));
  throw new Error(`line ${line}: unsupported value ${raw}`);
}

export function parseToml(text: string): Record<string, TomlValue> {
  const out: Record<string, TomlValue> = {};
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = stripComment(rawLine).trim();
    if (!line) return;
    if (line.startsWith('[')) throw new Error(`line ${index + 1}: tables are not supported (flat keys only)`);
    const equals = line.indexOf('=');
    if (equals < 0) throw new Error(`line ${index + 1}: expected key = value`);
    const key = line.slice(0, equals).trim();
    if (!KEY.test(key)) throw new Error(`line ${index + 1}: invalid key ${key}`);
    out[key] = parseValue(line.slice(equals + 1).trim(), index + 1);
  });
  return out;
}

const quote = (value: string) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')}"`;

export function stringifyToml(values: Record<string, TomlValue>, header?: string): string {
  const lines = header ? header.split('\n').map(line => `# ${line}`) : [];
  for (const key of Object.keys(values).sort()) {
    const value = values[key];
    if (value === undefined) continue;
    lines.push(`${key} = ${typeof value === 'string' ? quote(value) : String(value)}`);
  }
  return `${lines.join('\n')}\n`;
}
