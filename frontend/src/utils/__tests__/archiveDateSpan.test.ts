import { describe, expect, it } from 'vitest';
import { archiveDateSpan } from '../archiveDateSpan';

describe('archiveDateSpan', () => {
  it('compares ISO and filename dates consistently', () => {
    expect(archiveDateSpan(['1947-08-10', '19471018'], false)?.label).toBe('Aug 1947 — Oct 1947');
  });
  it('includes a year-only item without inventing a month or day', () => {
    expect(archiveDateSpan(['19470810', '19471018', '1947XXXX'])?.label).toBe('1947');
  });
  it('preserves month and decade precision', () => {
    expect(archiveDateSpan(['188XXXXX', '194708XX'])?.label).toBe('1880s — Aug 1947');
    expect(archiveDateSpan(['19470810'])?.label).toBe('Aug 10, 1947');
  });
  it('does not invent a year for undated material', () => {
    expect(archiveDateSpan(['XXXXXXXX', undefined, null])).toBeNull();
  });
});
