import { describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  exists: vi.fn((query: unknown) => ({ kind: 'exists', query })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => ({
          kind: 'subquery',
          condition,
        })),
      })),
    })),
  },
  letters: {
    type: 'letters.type',
    workflow: 'letters.workflow',
    transcriptionStatus: 'letters.transcriptionStatus',
    transcriptionRunId: 'letters.transcriptionRunId',
    transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
    transcriptionClaimKind: 'letters.transcriptionClaimKind',
    metadataStatus: 'letters.metadataStatus',
    metadataRunId: 'letters.metadataRunId',
    metadataRunRevision: 'letters.metadataRunRevision',
    metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
    metadataLeaseRunId: 'letters.metadataLeaseRunId',
    metadataClaimKind: 'letters.metadataClaimKind',
    entityExtractionStatus: 'letters.entityExtractionStatus',
    entityExtractionRunId: 'letters.entityExtractionRunId',
    entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
    entityExtractionLeaseExpiresAt: 'letters.entityExtractionLeaseExpiresAt',
    entityExtractionLeaseRunId: 'letters.entityExtractionLeaseRunId',
    entityExtractionClaimKind: 'letters.entityExtractionClaimKind',
    extraContentJobStatus: 'letters.extraContentJobStatus',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
    transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
    transcriptionText: 'letters.transcriptionText',
    deadLetter: 'letters.deadLetter',
    id: 'letters.id',
  },
  letterPages: {
    letterId: 'letterPages.letterId',
  },
}));

import {
  extraContentPrerequisiteConditions,
  isMetadataStateEligible,
  queuedEntityExtractionConditions,
  queuedExtraContentConditions,
  queuedMetadataConditions,
  queuedTranscriptionConditions,
} from '../processing-eligibility.js';

describe('durable processing eligibility', () => {
  it('keeps in-memory metadata eligibility aligned with SQL whitespace semantics', () => {
    const eligibleState = {
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      entityExtractionStatus: 'PENDING',
      extraContentJobStatus: 'PENDING',
      transcriptConfirmedAt: new Date('2026-07-17T11:00:00Z'),
      transcriptionText: 'A real transcript',
    };

    expect(isMetadataStateEligible({
      ...eligibleState,
      transcriptionText: '\n\t  ',
    })).toBe(false);
    expect(isMetadataStateEligible(eligibleState)).toBe(true);
  });

  it('defines a page-backed durable transcription queue', () => {
    expect(queuedTranscriptionConditions()).toEqual([
      {
        kind: 'inArray',
        field: 'letters.type',
        values: ['L', 'T', 'C', 'E', 'N', 'A', 'D'],
      },
      { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
      { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      expect.objectContaining({ kind: 'exists' }),
      { kind: 'eq', field: 'letters.workflow', value: 'UPLOADED' },
      { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
      { kind: 'isNull', field: 'letters.transcriptionRunId' },
      expect.objectContaining({ kind: 'or' }),
      { kind: 'eq', field: 'letters.deadLetter', value: false },
    ]);
  });

  it('defines a confirmation-gated durable metadata queue', () => {
    expect(queuedMetadataConditions()).toEqual([
      { kind: 'eq', field: 'letters.type', value: 'L' },
      { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
      { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      { kind: 'ne', field: 'letters.extraContentJobStatus', value: 'RUNNING' },
      { kind: 'isNotNull', field: 'letters.transcriptConfirmedAt' },
      { kind: 'isNotNull', field: 'letters.transcriptionText' },
      expect.objectContaining({
        kind: 'sql',
        strings: ['', " ~ '[^[:space:]]'"],
        values: ['letters.transcriptionText'],
      }),
      { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
      { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
      { kind: 'isNull', field: 'letters.metadataRunId' },
      { kind: 'isNull', field: 'letters.metadataRunRevision' },
      { kind: 'isNull', field: 'letters.metadataLeaseExpiresAt' },
      { kind: 'isNull', field: 'letters.metadataLeaseRunId' },
      { kind: 'isNull', field: 'letters.metadataClaimKind' },
      { kind: 'eq', field: 'letters.deadLetter', value: false },
    ]);
  });

  it('defines an entity queue only after metadata succeeds', () => {
    expect(queuedEntityExtractionConditions()).toEqual([
      { kind: 'eq', field: 'letters.type', value: 'L' },
      { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
      { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
      { kind: 'ne', field: 'letters.extraContentJobStatus', value: 'RUNNING' },
      { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
      { kind: 'isNull', field: 'letters.entityExtractionRunId' },
      { kind: 'isNull', field: 'letters.entityExtractionRunRevision' },
      {
        kind: 'or',
        clauses: [
          {
            kind: 'and',
            clauses: [
              {
                kind: 'isNull',
                field: 'letters.entityExtractionLeaseExpiresAt',
              },
              {
                kind: 'isNull',
                field: 'letters.entityExtractionLeaseRunId',
              },
              {
                kind: 'isNull',
                field: 'letters.entityExtractionClaimKind',
              },
            ],
          },
          {
            kind: 'and',
            clauses: [
              {
                kind: 'isNotNull',
                field: 'letters.entityExtractionLeaseExpiresAt',
              },
              {
                kind: 'isNotNull',
                field: 'letters.entityExtractionLeaseRunId',
              },
              {
                kind: 'isNotNull',
                field: 'letters.entityExtractionClaimKind',
              },
            ],
          },
        ],
      },
      { kind: 'eq', field: 'letters.deadLetter', value: false },
    ]);
  });

  it('shares archive identity between extra-content prerequisites and its queue', () => {
    const prerequisites = extraContentPrerequisiteConditions();

    expect(prerequisites).toEqual([
      { kind: 'eq', field: 'letters.type', value: 'L' },
      { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
      expect.objectContaining({
        kind: 'sql',
        strings: expect.arrayContaining([
          expect.stringContaining("rel.type IN ('T', 'C', 'E')"),
        ]),
        values: [
          'letters.collectionId',
          'letters.dateRaw',
          'letters.typeSequence',
          'letters.id',
        ],
      }),
    ]);
    expect(queuedExtraContentConditions()).toEqual([
      ...prerequisites,
      { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
    ]);
  });
});
