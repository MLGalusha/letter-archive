import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  buildProcessingConditionsMock,
  countEligibleMock,
} = vi.hoisted(() => ({
  buildProcessingConditionsMock: vi.fn(),
  countEligibleMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
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

vi.mock('../processes/filter-helpers.js', () => ({
  processingFilterSchema: {},
  buildProcessingConditions: buildProcessingConditionsMock,
}));

vi.mock('../processes/letter-process-helpers.js', () => ({
  letterProcessSpecs: {
    transcription: {},
    metadata: {},
    entity_extraction: {},
    extra_content: {},
  },
  queueSnapshot: vi.fn(),
  activeJobSnapshot: vi.fn(),
  recentJobsSnapshot: vi.fn(),
  removeFromQueue: vi.fn(),
  clearQueue: vi.fn(),
  retryJob: vi.fn(),
  cancelActive: vi.fn(),
  runLetterBatch: vi.fn(),
  countEligible: countEligibleMock,
  resolveEligibleLetterIds: vi.fn(),
}));

vi.mock('../processes/runner.js', () => ({
  getJobProgress: vi.fn(),
}));

import { metadataProcess } from '../processes/metadata.js';
import { entityExtractionProcess } from '../processes/entity-extraction.js';
import { extraContentProcess } from '../processes/extra-content.js';
import { transcriptionProcess } from '../processes/transcription.js';
import {
  extraContentPrerequisiteConditions,
  isMetadataStateEligible,
  queuedExtraContentConditions,
} from '../processing-eligibility.js';

describe('process registry downstream eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildProcessingConditionsMock.mockResolvedValue({
      conditions: [],
      collectionNotFound: false,
    });
    countEligibleMock.mockResolvedValue(0);
  });

  it('keeps the in-memory metadata transcript check aligned with SQL whitespace semantics', () => {
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

  it('uses the shared page-backed transcription queue predicate', async () => {
    await transcriptionProcess.getEligibleCount({});

    expect(buildProcessingConditionsMock).toHaveBeenCalledWith({}, [
      {
        kind: 'inArray',
        field: 'letters.type',
        values: ['L', 'T', 'C', 'E', 'N', 'A', 'D'],
      },
      { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
      { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      expect.objectContaining({
        kind: 'sql',
        strings: expect.arrayContaining([
          expect.stringContaining('EXISTS'),
        ]),
        values: [
          { letterId: 'letterPages.letterId' },
          'letterPages.letterId',
          'letters.id',
        ],
      }),
      { kind: 'eq', field: 'letters.workflow', value: 'UPLOADED' },
      { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
      { kind: 'isNull', field: 'letters.transcriptionRunId' },
      expect.objectContaining({ kind: 'or' }),
      { kind: 'eq', field: 'letters.deadLetter', value: false },
    ]);
  });

  it('uses the confirmation-gated metadata queue predicate', async () => {
    await metadataProcess.getEligibleCount({});

    expect(buildProcessingConditionsMock).toHaveBeenCalledWith({}, [
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

  it('uses the metadata-success entity queue predicate', async () => {
    await entityExtractionProcess.getEligibleCount({});

    expect(buildProcessingConditionsMock).toHaveBeenCalledWith({}, [
      { kind: 'eq', field: 'letters.type', value: 'L' },
      { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
      { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
      { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
      { kind: 'eq', field: 'letters.deadLetter', value: false },
    ]);
  });

  it('shares the archive-identity extra-content predicate without requiring PENDING', () => {
    expect(extraContentPrerequisiteConditions()).toEqual([
      { kind: 'eq', field: 'letters.type', value: 'L' },
      expect.objectContaining({
        kind: 'sql',
        strings: expect.arrayContaining([
          expect.stringContaining('rel.collection_id'),
          expect.stringContaining('rel.date_raw'),
          expect.stringContaining('rel.type_sequence'),
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
  });

  it('uses the shared queued extra-content predicate in the registry adapter', async () => {
    await extraContentProcess.getEligibleCount({});

    expect(buildProcessingConditionsMock).toHaveBeenCalledWith(
      {},
      queuedExtraContentConditions(),
    );
    expect(buildProcessingConditionsMock.mock.calls[0]?.[1]).toEqual([
      { kind: 'eq', field: 'letters.type', value: 'L' },
      expect.objectContaining({ kind: 'sql' }),
      { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
    ]);
  });
});
