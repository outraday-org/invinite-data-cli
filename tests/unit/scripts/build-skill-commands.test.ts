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
import type { ManifestOperation } from '../../../src/spec-manifest.js';

/** The generated lines of a block (hand blocks cut out), so a hand example never counts as the generated one. */
const generatedPart = (block: string) => block.replace(/<!-- invd:hand:([^>]+?) -->\n[\s\S]*?<!-- \/invd:hand:\1 -->/g, '');

const operationName = (operation: ManifestOperation) => `${operation.group} ${operation.action}`.trim();

const op = (overrides: Partial<ManifestOperation>): ManifestOperation => ({
  operationId: 'thing',
  group: 'things',
  action: 'get',
  method: 'get',
  path: '/v1/things',
  auth: true,
  summary: 'Get a thing',
  params: [],
  view: 'json',
  pagination: 'none',
  ...overrides,
});

describe('build-skill-commands', () => {
  it('names every manifest operation exactly once and gives every roster entry one hand block', () => {
    const block = renderCommandBlock(loadManifest(), HAND_WRITTEN_COMMANDS, new Map());
    const lines = generatedPart(block).split('\n');
    for (const operation of loadManifest().operations) {
      const prefix = `invd ${operationName(operation)}`;
      const hits = lines.filter(line => line === prefix || line.startsWith(`${prefix} `));
      expect(hits, prefix).toHaveLength(1);
    }
    for (const entry of HAND_WRITTEN_COMMANDS) {
      expect(block.split(`<!-- invd:hand:${entry.command} -->`), entry.command).toHaveLength(2);
    }
  });

  it('example: required flags with a placeholder (alias first, enum first value), the required body, --json', () => {
    expect(exampleLine(op({
      params: [
        { name: 'identifier', in: 'query', required: true, type: 'string', alias: 'i' },
        { name: 'fiscal_period_type', in: 'query', required: true, type: 'string', enum: ['quarterly', 'annual'], alias: 'p' },
        { name: 'person_id', in: 'path', required: true, type: 'string' },
        { name: 'limit', in: 'query', required: false, type: 'integer' },
      ],
    }))).toBe('invd things get -i <identifier> -p quarterly --person-id <person_id> --json');
    expect(exampleLine(op({ action: '', body: { required: true, contentType: 'application/json' } })))
      .toBe("invd things --body '<json>' --json");
  });

  it('values a flag with the spec example, adds the x-example-params flags and the body example, quoting for the shell', () => {
    expect(exampleLine(op({
      params: [
        { name: 'identifier', in: 'query', required: true, type: 'string', alias: 'i', example: 'AAPL' },
        { name: 'request', in: 'query', required: true, type: 'string', example: "What are Apple's risks?" },
        { name: 'event_id', in: 'query', required: false, type: 'string', example: 'cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c' },
        { name: 'include', in: 'query', required: false, type: 'array', items: 'string', example: ['body', 'pages'] },
        { name: 'limit', in: 'query', required: false, type: 'integer', example: 5 },
      ],
      exampleParams: ['event_id', 'include'],
      body: { required: false, contentType: 'application/json', example: { active: true } },
    }))).toBe(
      'invd things get -i AAPL --request "What are Apple\'s risks?" --event-id cfbcf4f8-6d4d-41ef-9197-1c91ff2aef8c'
        + ` --include body,pages --body '{"active":true}' --json`,
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
