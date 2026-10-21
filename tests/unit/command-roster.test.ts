import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { createProgram, loadManifest } from '../../src/cli.js';
import { HAND_WRITTEN_COMMANDS } from '../../src/hand-written-commands.js';

/** Every leaf of the command tree as `group action` (a group with no subcommand is its own leaf). */
function leaves(command: Command, prefix: string[] = []): string[] {
  return command.commands.flatMap(child => {
    const path = [...prefix, child.name()];
    return child.commands.length > 0 ? leaves(child, path) : [path.join(' ')];
  });
}

const operationNames = () => loadManifest().operations.map(operation => `${operation.group} ${operation.action}`.trim());
const rosterNames: string[] = HAND_WRITTEN_COMMANDS.map(entry => entry.command);

/** A leaf is covered by a roster entry naming it or naming its top-level group. */
const rosterCovers = (leaf: string) => rosterNames.some(name => leaf === name || leaf.startsWith(`${name} `));

/** The leaves the hand-written roster does not account for, given a program and the manifest's operations. */
function strayCommands(program: Command, operations: readonly string[]): string[] {
  const generated = new Set(operations);
  return leaves(program).filter(leaf => !generated.has(leaf) && !rosterCovers(leaf));
}

describe('the hand-written roster', () => {
  it('every command is a manifest operation or rostered', () => {
    expect(strayCommands(createProgram(), operationNames())).toEqual([]);
  });

  it('every roster entry registers a command (no stale entry)', () => {
    const tree = leaves(createProgram());
    for (const name of rosterNames) {
      expect(tree.some(leaf => leaf === name || leaf.startsWith(`${name} `)), name).toBe(true);
    }
  });

  it('no roster entry is also a manifest operation, and every entry gives its reason', () => {
    const operations = operationNames();
    for (const entry of HAND_WRITTEN_COMMANDS) {
      expect(operations.filter(name => name === entry.command || name.startsWith(`${entry.command} `)), entry.command)
        .toEqual([]);
      expect(entry.reason.length, entry.command).toBeGreaterThan(0);
    }
  });

  it('every manifest operation is registered exactly once', () => {
    const tree = leaves(createProgram());
    for (const name of operationNames()) {
      expect(tree.filter(leaf => leaf === name), name).toHaveLength(1);
    }
  });

  it('a stray hand-written command fails by name', () => {
    const program = createProgram();
    program.commands.find(command => command.name() === 'earnings')?.command('summary');
    program.command('screener');
    expect(strayCommands(program, operationNames())).toEqual(['earnings summary', 'screener']);
  });
});
