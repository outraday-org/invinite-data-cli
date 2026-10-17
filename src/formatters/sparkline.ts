const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** One block glyph per value, scaled to the largest; an all-zero (or negative) series is a flat line of `▁`. */
export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  if (max === 0) return BLOCKS[0].repeat(values.length);
  return values
    .map(value => BLOCKS[Math.round((Math.max(0, value) / max) * (BLOCKS.length - 1))])
    .join('');
}
