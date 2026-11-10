import { describe, expect, it } from 'vitest';
import { evaluateJq, jqLine, runJq, UnsupportedJqError } from '../../../src/output/jq.js';

const body = { data: [{ accession: 'a1', form: '10-K', n: 3 }, { accession: 'a2', form: '8-K', n: 1 }], has_more: false, meta: { 'form-facet': 2 } };

describe('built-in jq subset', () => {
  it('paths, iteration, index, optional, quoted keys', () => {
    expect(evaluateJq('.data[].accession', body)).toEqual(['a1', 'a2']);
    expect(evaluateJq('.data[1].form', body)).toEqual(['8-K']);
    expect(evaluateJq('.data[-1].n', body)).toEqual([1]);
    expect(evaluateJq('.meta."form-facet"', body)).toEqual([2]);
    expect(evaluateJq('.missing?.x', body)).toEqual([null]);
    expect(evaluateJq('.', 5)).toEqual([5]);
    expect(evaluateJq('.data | length', body)).toEqual([2]);
    expect(evaluateJq('.data[0] | keys', body)).toEqual([['accession', 'form', 'n']]);
  });

  it('pipes, comma, select with a comparison or truthiness, literals', () => {
    expect(evaluateJq('.data[] | select(.form == "10-K") | .accession', body)).toEqual(['a1']);
    expect(evaluateJq('.data[] | select(.n > 1) | .accession', body)).toEqual(['a1']);
    expect(evaluateJq('.data[] | select(.form != "10-K") | .n', body)).toEqual([1]);
    expect(evaluateJq('.data[] | select(.missing) | .n', body)).toEqual([]);
    expect(evaluateJq('.has_more, .meta', body)).toEqual([false, { 'form-facet': 2 }]);
    expect(evaluateJq('"x"', body)).toEqual(['x']);
  });

  it('prints strings raw and the rest as compact JSON', () => {
    expect(jqLine('a')).toBe('a');
    expect(jqLine({ a: 1 })).toBe('{"a":1}');
    expect(runJq('.data[].accession', body)).toEqual(['a1', 'a2']);
  });

  it('refuses outside the subset (a usage error when no jq binary can take over)', () => {
    expect(() => evaluateJq('map(.n)', body)).toThrow(UnsupportedJqError);
    expect(() => evaluateJq('.data[] | .n + 1', body)).toThrow(UnsupportedJqError);
  });
});
