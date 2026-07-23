import { beforeEach, describe, expect, it, vi } from 'vitest';

const { relationshipUpdates } = vi.hoisted(() => ({
  relationshipUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock('drizzle-orm', () => ({
  and: (...clauses: unknown[]) => ({ kind: 'and', clauses }),
  eq: (field: unknown, value: unknown) => ({ kind: 'eq', field, value }),
  inArray: (field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock('../../../db/index.js', () => {
  const table = (name: string, fields: string[]) => ({
    tableName: name,
    ...Object.fromEntries(fields.map((field) => [field, `${name}.${field}`])),
  });
  const canonicalPersons = table('canonicalPersons', ['id']);
  const letterPersons = table('letterPersons', ['id', 'letterId', 'personId', 'role']);
  const letters = table('letters', ['id', 'senderRecipientRelationship']);
  const personRelationships = table('personRelationships', [
    'id',
    'personAId',
    'personBId',
  ]);

  return {
    canonicalPersons,
    letterPersons,
    letters,
    personRelationships,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            { role: 'sender', personId: 'person-a' },
            { role: 'recipient', personId: 'person-b' },
          ]),
        })),
      })),
      query: {
        personRelationships: {
          findFirst: vi.fn(async () => ({
            id: 'relationship-1',
            relationshipType: 'unknown',
            discoveredInLetterId: 'letter-1',
            entityExtractionRevision: 7,
            confidence: 50,
            confirmedBy: null,
            confirmedAt: null,
          })),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn((patch: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            relationshipUpdates.push(patch);
            return [];
          }),
        })),
      })),
    },
  };
});

vi.mock('../matching.js', () => ({
  findMatchingPersons: vi.fn(),
}));

vi.mock('../review-queue.js', () => ({
  addToReviewQueue: vi.fn(),
}));

import { syncSenderRecipientRelationshipFromLetter } from '../participant-sync.js';

describe('participant relationship provenance', () => {
  beforeEach(() => {
    relationshipUpdates.length = 0;
  });

  it('replaces extraction ownership when human metadata changes relationship content', async () => {
    await syncSenderRecipientRelationshipFromLetter(
      'letter-1',
      'friend',
      'reviewer@example.test',
    );

    expect(relationshipUpdates).toHaveLength(1);
    expect(relationshipUpdates[0]).toMatchObject({
      relationshipType: 'friend',
      discoveredInLetterId: 'letter-1',
      confidence: 95,
      entityExtractionRevision: null,
      confirmedBy: 'reviewer@example.test',
    });
    expect(relationshipUpdates[0].confirmedAt).toBeInstanceOf(Date);
    expect(relationshipUpdates[0].updatedAt).toBe(
      relationshipUpdates[0].confirmedAt,
    );
  });
});
