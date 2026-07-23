import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rawSqlMock } = vi.hoisted(() => ({
  rawSqlMock: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  sql: rawSqlMock,
}));

import { pickFeaturedLetter } from '../pick-featured-letter.js';
import { PUBLIC_CATALOGUE_LETTER_TYPES } from '../public-catalogue-unit.js';

describe('pickFeaturedLetter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rawSqlMock.mockImplementation((strings: TemplateStringsArray | readonly unknown[], ...values: unknown[]) => {
      const queryText = Array.from(strings).join('');
      if (queryText.includes('WITH ranked AS')) return Promise.resolve([]);
      return { strings, values };
    });
  });

  it('only considers letter types that can establish public catalogue units', async () => {
    await pickFeaturedLetter();

    const rankedQuery = rawSqlMock.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join('').includes('WITH ranked AS')
    );
    expect(rankedQuery).toBeDefined();
    expect(Array.from(rankedQuery?.[0] as TemplateStringsArray).join('')).toContain('AND l.type IN');
    expect(rawSqlMock).toHaveBeenCalledWith(PUBLIC_CATALOGUE_LETTER_TYPES);
  });

  it('only exposes reviewed standalone photo descriptions', async () => {
    await pickFeaturedLetter();

    const rankedQuery = rawSqlMock.mock.calls.find(([strings]) =>
      Array.from(strings as TemplateStringsArray).join('').includes('WITH ranked AS')
    );
    expect(Array.from(rankedQuery?.[0] as TemplateStringsArray).join('')).toContain(
      "l.photo_description_status = 'VERIFIED'",
    );
  });
});
