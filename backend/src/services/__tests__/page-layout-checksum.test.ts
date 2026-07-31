import { describe, expect, it } from 'vitest';
import { pageLayoutChecksum } from '../page-layout-checksum.js';

describe('PageLayout canonical checksum', () => {
  it('is independent of object insertion order', () => {
    expect(pageLayoutChecksum({ beta: 2, alpha: 1 })).toBe(
      pageLayoutChecksum({ alpha: 1, beta: 2 }),
    );
  });

  it('uses locale-independent UTF-16 key order for Unicode metadata', () => {
    expect(pageLayoutChecksum({ ä: 2, z: 1 })).toBe(
      '7832a5d6150a56da1a4f0c8fa00c26a7350389b0fc8696707cd2abbbd32be0c1',
    );
  });

  it('matches JSON persistence semantics for undefined values', () => {
    expect(pageLayoutChecksum({
      retained: true,
      omitted: undefined,
      values: [1, undefined, 3],
    })).toBe(pageLayoutChecksum({
      retained: true,
      values: [1, null, 3],
    }));
  });

  it('rejects a non-JSON root value', () => {
    expect(() => pageLayoutChecksum(undefined)).toThrow(
      /canonical JSON value/,
    );
  });
});
