import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  BLOCK_END,
  BLOCK_START,
  DEFAULT_SKILL_PATH,
  exampleLine,
  extractHandBlocks,
  renderCommandBlock,
  renderSkill,
  shellWord,
} from '../../../scripts/build-skill-commands.js';
import { loadManifest } from '../../../src/cli.js';
import { HAND_WRITTEN_COMMANDS } from '../../../src/hand-written-commands.js';
import { commandName, type ManifestOperation } from '../../../src/spec-manifest.js';

/** The generated lines of a block (hand blocks cut out), so a hand example never counts as the generated one. */
const generatedPart = (block: string) => block.replace(/<!-- invd:hand:([^>]+?) -->\n[\s\S]*?<!-- \/invd:hand:\1 -->/g, '');

const op = (overrides: Partial<ManifestOperation>): ManifestOperation => ({
  operationId: 'thing',
  group: 'things',
  action: 'get',
  method: 'get',
  path: '/v1/things',
  auth: true,
  summary: 'Get a thing',
  credits: 1,
  tier: 'standard',
  params: [],
  list: false,
  view: 'json',
  fields: [],
  ...overrides,
});

describe('build-skill-commands', () => {
  it('names every command exactly once (financials once for six operations) and gives every roster entry one hand block', () => {
    const block = renderCommandBlock(loadManifest(), HAND_WRITTEN_COMMANDS, new Map());
    const lines = generatedPart(block).split('\n');
    for (const name of new Set(loadManifest().operations.map(operation => commandName(operation)))) {
      const prefix = `invd ${name}`;
      const hits = lines.filter(line => line.startsWith(`${prefix} `)
        && !loadManifest().operations.some(other => commandName(other) !== name && commandName(other).startsWith(name) && line.startsWith(`invd ${commandName(other)} `)));
      expect(hits, prefix).toHaveLength(1);
    }
    for (const entry of HAND_WRITTEN_COMMANDS) {
      expect(block.split(`<!-- invd:hand:${entry.command} -->`), entry.command).toHaveLength(2);
    }
  });

  it('example: positional and required flags valued from the spec (alias first, enum first value), the required body, --json', () => {
    expect(exampleLine(op({
      positional: { name: 'company', required: true, variadic: 'comma' },
      params: [
        { name: 'company', in: 'query', required: true, type: 'string', flag: 'company', example: 'AAPL,MSFT' },
        { name: 'period', in: 'query', required: true, type: 'string', enum: ['quarterly', 'annual'], alias: 'p', flag: 'period' },
        { name: 'person_id', in: 'query', required: true, type: 'string', flag: 'person-id' },
        { name: 'limit', in: 'query', required: false, type: 'integer', flag: 'limit' },
      ],
    }))).toBe('invd things get AAPL MSFT -p quarterly --person-id <person_id> --json');
    expect(exampleLine(op({ action: '', body: { required: true, contentType: 'application/json', fields: [] } })))
      .toBe("invd things --body '<json>' --json");
  });

  it('values a flag with the spec example, adds the x-example-params flags and the body example, quoting for the shell', () => {
    expect(exampleLine(op({
      positional: { name: 'q', required: true, variadic: 'space' },
      params: [
        { name: 'q', in: 'query', required: true, type: 'string', flag: 'q', example: "What are Apple's risks?" },
        { name: 'event', in: 'query', required: false, type: 'string', flag: 'event', example: 'cfbcf4f8' },
        { name: 'filed_at.gte', in: 'query', required: false, type: 'string', flag: 'filed-at-gte', example: '2026-01-01' },
      ],
      exampleParams: ['event', 'filed_at.gte'],
      body: { required: false, contentType: 'application/json', example: { active: true }, fields: [] },
    }))).toBe(
      'invd things get "What are Apple\'s risks?" --event cfbcf4f8 --filed-at-gte 2026-01-01'
        + ` --body '{"active":true}' --json`,
    );
    expect(shellWord('it costs $5')).toBe("'it costs $5'");
    expect(shellWord("it's $5")).toBe("'it'\\''s $5'");
  });

  it('carries a hand block over verbatim and refuses one for a command off the roster', () => {
    const roster = [{ command: 'things export', reason: 'downloads' }];
    const manifest = { specVersion: '1', specSha256: 'a'.repeat(64), groups: [{ name: 'things', description: 'Things' }], operations: [op({})] };
    const skill = `intro\n${BLOCK_START}\n<!-- invd:hand:things export -->\nkept *exactly*\n<!-- /invd:hand:things export -->\n${BLOCK_END}\noutro\n`;
    const next = renderSkill(skill, manifest, roster);
    expect(extractHandBlocks(next).get('things export')).toBe('kept *exactly*\n');
    expect(next.startsWith('intro\n')).toBe(true);
    expect(next.endsWith(`${BLOCK_END}\noutro\n`)).toBe(true);
    expect(renderSkill(next, manifest, roster)).toBe(next);
    expect(() => renderSkill(skill, manifest, [])).toThrow('`invd things export`');
  });

  it('refuses a SKILL.md without the markers', () => {
    expect(() => renderSkill('no markers', loadManifest(), HAND_WRITTEN_COMMANDS)).toThrow(BLOCK_START);
  });

  it('the committed SKILL.md is what the manifest produces (pnpm skill:commands)', () => {
    const skill = readFileSync(DEFAULT_SKILL_PATH, 'utf8');
    expect(renderSkill(skill, loadManifest(), HAND_WRITTEN_COMMANDS)).toBe(skill);
  });
});
