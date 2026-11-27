import { describe, expect, it } from '@jest/globals';
import { emptySafeJsonTransformer } from '../emptySafeJson.js';

describe('emptySafeJsonTransformer', () => {
  it('reads an empty string as absent instead of throwing', () => {
    expect(emptySafeJsonTransformer.from('')).toBeUndefined();
  });

  it('reads null and undefined as absent', () => {
    expect(emptySafeJsonTransformer.from(null)).toBeUndefined();
    expect(emptySafeJsonTransformer.from(undefined)).toBeUndefined();
  });

  it('parses a valid JSON payload', () => {
    expect(emptySafeJsonTransformer.from('{"Authorization":"Bearer x"}')).toEqual({
      Authorization: 'Bearer x',
    });
    expect(emptySafeJsonTransformer.from('[1,2]')).toEqual([1, 2]);
  });

  it('reads unparseable payloads as absent rather than failing the query', () => {
    expect(emptySafeJsonTransformer.from('{oops')).toBeUndefined();
  });

  it('writes undefined and null as SQL NULL', () => {
    expect(emptySafeJsonTransformer.to(undefined)).toBeNull();
    expect(emptySafeJsonTransformer.to(null)).toBeNull();
  });

  it('writes objects and arrays as JSON text', () => {
    expect(emptySafeJsonTransformer.to({ a: 'b' })).toBe('{"a":"b"}');
    expect(emptySafeJsonTransformer.to(['a'])).toBe('["a"]');
  });
});
