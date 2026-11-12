import { afterEach, describe, expect, it, vi } from 'vitest';

const { stopSpinners } = vi.hoisted(() => ({ stopSpinners: vi.fn() }));
vi.mock('../../../src/shared/spinner.js', () => ({ stopSpinners }));

import { ABORT_SIGNALS, installSignalExit, onInterrupt, resumeOnInterrupt } from '../../../src/shared/signals.js';

describe('the shared interrupt exit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('installs one handler per signal, however often it is asked', () => {
    installSignalExit();
    const counts = Object.keys(ABORT_SIGNALS).map(signal => process.listenerCount(signal));
    installSignalExit();
    onInterrupt(() => undefined)();
    expect(Object.keys(ABORT_SIGNALS).map(signal => process.listenerCount(signal))).toEqual(counts);
  });

  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('%s stops the spinners, runs the cleanups newest first, exits %i', (signal, code) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const order: string[] = [];
    const first = onInterrupt(() => order.push('first'));
    const failing = onInterrupt(() => { throw new Error('cleanup failed'); });
    const second = onInterrupt(name => order.push(`second ${name}`));
    process.emit(signal, signal);
    expect(stopSpinners).toHaveBeenCalled();
    expect(order).toEqual([`second ${signal}`, 'first']);
    expect(exit).toHaveBeenCalledWith(code);
    [first, failing, second].forEach(unregister => unregister());
  });

  it('an unregistered cleanup no longer runs; the exit still happens', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const cleanup = vi.fn();
    onInterrupt(cleanup)();
    process.emit('SIGINT', 'SIGINT');
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('a walk prints its resume cursor only once rows were written and a cursor is known', () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let progress: { written: number; cursor?: string } = { written: 0 };
    const unregister = resumeOnInterrupt(() => progress);
    process.emit('SIGINT', 'SIGINT');
    expect(stderr).not.toHaveBeenCalled();
    progress = { written: 50, cursor: 'c9' };
    process.emit('SIGINT', 'SIGINT');
    expect(stderr).toHaveBeenCalledWith('Stopped after 50 row(s) — resume with --cursor c9');
    unregister();
  });
});
