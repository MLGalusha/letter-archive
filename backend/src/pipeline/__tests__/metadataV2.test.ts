import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractMetadataV2Mock,
  extractEntitiesMock,
  getLetterWithPagesMock,
  updateMetadataV2Mock,
  updateEntityExtractionMock,
  updateLetterWorkflowMock,
  claimJobMock,
  processEntityExtractionMock,
  findFirstMock,
} = vi.hoisted(() => ({
  extractMetadataV2Mock: vi.fn(),
  extractEntitiesMock: vi.fn(),
  getLetterWithPagesMock: vi.fn(),
  updateMetadataV2Mock: vi.fn(),
  updateEntityExtractionMock: vi.fn(),
  updateLetterWorkflowMock: vi.fn(),
  claimJobMock: vi.fn(),
  processEntityExtractionMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock('../../ai/openai.js', () => ({
  extractMetadataV2: extractMetadataV2Mock,
  extractEntities: extractEntitiesMock,
}));

vi.mock('../../services/letters.js', () => ({
  getLetterWithPages: getLetterWithPagesMock,
  updateMetadataV2: updateMetadataV2Mock,
  updateEntityExtraction: updateEntityExtractionMock,
  updateLetterWorkflow: updateLetterWorkflowMock,
  incrementMetadataAttempts: vi.fn(),
  claimJob: claimJobMock,
}));

vi.mock('../../services/entities.js', () => ({
  processEntityExtraction: processEntityExtractionMock,
}));

vi.mock('../../services/processing-queue.js', () => ({
  updateJobProgress: vi.fn(),
  clearJobProgress: vi.fn(),
}));

vi.mock('../../services/notifications.js', () => ({ notify: vi.fn() }));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      letters: { findFirst: findFirstMock },
    },
  },
  letters: {
    id: 'letters.id',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}));

import { runEntityExtractionOnly, runMetadataExtractionV2 } from '../metadataV2.js';

const entities = {
  people: [],
  places: [],
  relationships: [],
  person_place_connections: [],
};

function letter() {
  return {
    id: 'letter-1',
    type: 'L',
    transcriptionText: 'A complete transcript',
    sender: 'Alice',
    recipient: 'Bob',
    senderRecipientRelationship: 'friend',
    summary: 'A short summary',
    letterDate: '1947-08-10',
    dateRaw: '19470810',
    extraContentTranscript: null,
    collection: { collectionCode: '009' },
  };
}

describe('metadata entity persistence ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterWithPagesMock.mockResolvedValue(letter());
    claimJobMock.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({
      metadataStatus: 'RUNNING',
      entityExtractionStatus: 'RUNNING',
    });
    extractEntitiesMock.mockResolvedValue({ entities, isStub: true, usage: undefined });
    processEntityExtractionMock.mockResolvedValue({
      peopleProcessed: 0,
      placesProcessed: 0,
      relationshipsCreated: 0,
      errors: [],
    });
    extractMetadataV2Mock.mockResolvedValue({
      metadata: {
        sender: 'Alice',
        recipient: 'Bob',
        summary: 'A short summary',
        emotional_tone: 'neutral',
        sender_recipient_relationship: 'friend',
        primary_topics: [],
        notable_quotes: [],
      },
      isStub: true,
      usage: undefined,
    });
  });

  it('keeps standalone entity extraction RUNNING until entity writes finish', async () => {
    await runEntityExtractionOnly('letter-1');

    expect(processEntityExtractionMock).toHaveBeenCalledTimes(1);
    expect(updateEntityExtractionMock).toHaveBeenCalledWith(
      'letter-1',
      'SUCCESS',
      entities,
      null,
    );
    expect(processEntityExtractionMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateEntityExtractionMock.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps pipeline entity extraction RUNNING until entity writes finish', async () => {
    await runMetadataExtractionV2('letter-1');

    expect(updateMetadataV2Mock).toHaveBeenCalledWith(
      'letter-1',
      'SUCCESS',
      expect.any(Object),
      null,
    );
    expect(updateLetterWorkflowMock).not.toHaveBeenCalledWith(
      'letter-1',
      'METADATA_DRAFTED',
    );
    const successCallIndex = updateEntityExtractionMock.mock.calls.findIndex(
      ([, status]) => status === 'SUCCESS',
    );
    expect(successCallIndex).toBeGreaterThanOrEqual(0);
    expect(processEntityExtractionMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateEntityExtractionMock.mock.invocationCallOrder[successCallIndex]!,
    );
  });
});
