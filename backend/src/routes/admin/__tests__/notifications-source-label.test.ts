import { describe, expect, it, vi } from 'vitest';

// The label helper is colocated with the route module, which pulls in drizzle
// + db on import. Stub the heavy modules so this stays a fast unit test.
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  or: vi.fn(),
  eq: vi.fn(),
  desc: vi.fn(),
  count: vi.fn(),
  inArray: vi.fn(),
  ilike: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock('../../../db/index.js', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  adminNotifications: {},
  letters: {},
  collections: {},
}));

vi.mock('../notifications-stream.js', () => ({
  issueStreamToken: vi.fn(),
}));

import { formatLetterLabel } from '../notifications.js';

describe('formatLetterLabel', () => {
  it('joins collection code and letterDate with a middle-dot separator', () => {
    expect(formatLetterLabel('014', '1864-03-15', '1864-03-15')).toBe('014 · 1864-03-15');
  });

  it('falls back to dateRaw when letterDate is null', () => {
    expect(formatLetterLabel('009', null, '1947-09-19')).toBe('009 · 1947-09-19');
  });

  it('omits the date entirely when both letterDate and dateRaw are null', () => {
    expect(formatLetterLabel('014', null, null)).toBe('014');
  });

  it('omits the collection code when null but keeps the date', () => {
    expect(formatLetterLabel(null, '1864-03-15', null)).toBe('1864-03-15');
  });

  it('returns empty string when nothing is present', () => {
    expect(formatLetterLabel(null, null, null)).toBe('');
  });

  it('prefers letterDate over dateRaw when both exist', () => {
    // letterDate is the parsed canonical form; dateRaw is whatever came from
    // the filename. The two can disagree (e.g. uncertain dates) and we want
    // the parsed value.
    expect(formatLetterLabel('014', '1864-03-15', '1864-03')).toBe('014 · 1864-03-15');
  });
});
