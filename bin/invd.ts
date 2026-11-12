#!/usr/bin/env node
import { CommanderError } from 'commander';
import { createProgram } from '../src/cli.js';
import { exitCodeOfCommanderError } from '../src/shared/errors.js';
import { installSignalExit } from '../src/shared/signals.js';

// Ctrl-C / SIGTERM exit 130 / 143 in every command, after the cleanups a command registered (onInterrupt).
installSignalExit();
try {
  await createProgram().parseAsync();
} catch (error) {
  // `exitOverride` turns commander's own exits into errors: help / version keep their code, a usage error is 2.
  if (error instanceof CommanderError) process.exit(exitCodeOfCommanderError(error));
  throw error;
}
