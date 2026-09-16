import { describe, it, expect } from 'vitest';
import { archiveSearchQuerySchema } from './letter.js';

describe('archive year query validation', () => {
  it('accepts old years and open or equal ranges', () => {
    for (const query of [{ yearTo: '1863' }, { yearFrom: '1860' }, { yearFrom: '1863', yearTo: '1863' }]) {
      expect(archiveSearchQuerySchema.safeParse(query).success).toBe(true);
    }
  });

  it('rejects inverted, zero, fractional and out-of-range years', () => {
    for (const query of [{ yearFrom: '1948', yearTo: '1947' }, { yearFrom: '0' }, { yearTo: '10000' }, { year: '1863.5' }]) {
      expect(archiveSearchQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});
