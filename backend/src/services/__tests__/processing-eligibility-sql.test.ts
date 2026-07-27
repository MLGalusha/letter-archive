import { and } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/index.js';
import { queuedTranscriptionConditions } from '../processing-eligibility.js';

describe('processing eligibility SQL', () => {
  it('keeps the page prerequisite correlated to letter_pages in relational queries', () => {
    const query = db.query.letters.findMany({
      where: and(...queuedTranscriptionConditions()),
      columns: { id: true },
    });
    const { sql } = query.toSQL();

    expect(sql).toMatch(/from "letter_pages"/i);
    expect(sql).toMatch(
      /where "letter_pages"\."letter_id" = "letters"\."id"/i,
    );
    expect(sql).not.toContain('"letters"."letter_id"');
  });
});
