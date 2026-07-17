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
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
}));

vi.mock('../../db/index.js', () => ({
  letters: {
    type: 'letters.type',
    workflow: 'letters.workflow',
    transcriptionStatus: 'letters.transcriptionStatus',
    metadataStatus: 'letters.metadataStatus',
    entityExtractionStatus: 'letters.entityExtractionStatus',
    transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
  },
}));

vi.mock('../processes/filter-helpers.js', () => ({
  processingFilterSchema: {},
  buildProcessingConditions: buildProcessingConditionsMock,
}));

vi.mock('../processes/letter-process-helpers.js', () => ({
  letterProcessSpecs: {
    metadata: {},
    entity_extraction: {},
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

describe('process registry downstream eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildProcessingConditionsMock.mockResolvedValue({
      conditions: [],
      collectionNotFound: false,
    });
    countEligibleMock.mockResolvedValue(0);
  });

  it('excludes running transcriptions from metadata eligibility', async () => {
    await metadataProcess.getEligibleCount({});

    expect(buildProcessingConditionsMock).toHaveBeenCalledWith({}, [
      { kind: 'eq', field: 'letters.type', value: 'L' },
      { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
      { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
      { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
      { kind: 'isNotNull', field: 'letters.transcriptConfirmedAt' },
    ]);
  });

  it('excludes running transcriptions from entity eligibility', async () => {
    await entityExtractionProcess.getEligibleCount({});

    expect(buildProcessingConditionsMock).toHaveBeenCalledWith({}, [
      { kind: 'eq', field: 'letters.type', value: 'L' },
      { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
      { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
      { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
    ]);
  });
});
