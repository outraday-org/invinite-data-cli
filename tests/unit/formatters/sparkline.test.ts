import { describe, it, expect } from 'vitest';
import { sparkline } from '../../../src/formatters/sparkline.js';

describe('sparkline', () => {
  it('is empty for no values', () => {
    expect(sparkline([])).toBe('');
  });

  it('draws an all-zero series as a flat line of ▁', () => {
    expect(sparkline([0, 0, 0, 0])).toBe('▁▁▁▁');
  });

  it('climbs through all eight glyphs for a monotone series', () => {
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7])).toBe('▁▂▃▄▅▆▇█');
  });

  it('puts one spike at full height and the rest at the floor', () => {
    expect(sparkline([1, 1, 100, 1])).toBe('▁▁█▁');
  });
});
