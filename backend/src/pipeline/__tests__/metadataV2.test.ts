import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractMetadataV2Mock,
  extractEntitiesMock,
  getLetterWithPagesMock,
  updateEntityExtractionMock,
  claimEntityExtractionMock,
  observeMetadataStateMock,
  claimQueuedMetadataMock,
  completeMetadataMock,
  failMetadataMock,
  withMetadataHeartbeatMock,
  processEntityExtractionMock,
  findFirstMock,
  notifyMock,
} = vi.hoisted(() => ({
  extractMetadataV2Mock: vi.fn(),
  extractEntitiesMock: vi.fn(),
  getLetterWithPagesMock: vi.fn(),
  updateEntityExtractionMock: vi.fn(),
  claimEntityExtractionMock: vi.fn(),
  observeMetadataStateMock: vi.fn(),
  claimQueuedMetadataMock: vi.fn(),
  completeMetadataMock: vi.fn(),
  failMetadataMock: vi.fn(),
  withMetadataHeartbeatMock: vi.fn(),
  processEntityExtractionMock: vi.fn(),
  findFirstMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('../../ai/openai.js', () => ({
  extractMetadataV2: extractMetadataV2Mock,
  extractEntities: extractEntitiesMock,
}));

vi.mock('../../services/letters.js', () => ({
  getLetterWithPages: getLetterWithPagesMock,
  updateEntityExtraction: updateEntityExtractionMock,
  claimEntityExtraction: claimEntityExtractionMock,
}));

vi.mock('../../services/letter/metadata-job.js', () => ({
  observeMetadataState: observeMetadataStateMock,
  claimQueuedMetadata: claimQueuedMetadataMock,
  completeMetadata: completeMetadataMock,
  failMetadata: failMetadataMock,
  withMetadataHeartbeat: withMetadataHeartbeatMock,
}));

vi.mock('../../services/entities.js', () => ({
  processEntityExtraction: processEntityExtractionMock,
}));

vi.mock('../../services/processing-queue.js', () => ({
  updateJobProgress: vi.fn(),
  clearJobProgress: vi.fn(),
}));

vi.mock('../../services/notifications.js', () => ({ notify: notifyMock }));

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
  const leaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
  return {
    id: 'letter-1',
    type: 'L',
    transcriptionText: 'A complete transcript',
    transcriptionStatus: 'SUCCESS',
    transcriptConfirmedAt: new Date('2026-07-17T12:00:00.000Z'),
    metadataStatus: 'RUNNING',
    metadataRevision: 4,
    metadataRunId: 'run-a',
    metadataRunRevision: 4,
    metadataLeaseExpiresAt: leaseExpiresAt,
    metadataLeaseRunId: 'run-a',
    metadataClaimKind: 'QUEUED',
    entityExtractionStatus: 'PENDING',
    deadLetter: false,
    workflow: 'METADATA_EXTRACTING',
    updatedAt: new Date('2026-07-17T12:00:00.000Z'),
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
    claimEntityExtractionMock.mockResolvedValue(true);
    findFirstMock.mockResolvedValue({
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-a',
      entityExtractionStatus: 'RUNNING',
    });
    observeMetadataStateMock.mockReturnValue({ status: 'PENDING' });
    claimQueuedMetadataMock.mockResolvedValue({ runId: 'run-a', revision: 4 });
    completeMetadataMock.mockResolvedValue(true);
    failMetadataMock.mockResolvedValue(true);
    withMetadataHeartbeatMock.mockImplementation(
      async (_letterId, _claim, operation) => operation({ hasOwnership: () => true }),
    );
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
    await runMetadataExtractionV2('letter-1', undefined, { runId: 'run-a', revision: 4 });

    expect(completeMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { runId: 'run-a', revision: 4 },
      expect.any(Object),
    );
    const successCallIndex = updateEntityExtractionMock.mock.calls.findIndex(
      ([, status]) => status === 'SUCCESS',
    );
    expect(successCallIndex).toBeGreaterThanOrEqual(0);
    expect(processEntityExtractionMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateEntityExtractionMock.mock.invocationCallOrder[successCallIndex]!,
    );
  });

  it('returns claim_lost before calling OpenAI when queued ownership is stale', async () => {
    claimQueuedMetadataMock.mockResolvedValue(null);

    await expect(runMetadataExtractionV2('letter-1')).resolves.toEqual({
      kind: 'claim_lost',
    });

    expect(extractMetadataV2Mock).not.toHaveBeenCalled();
    expect(getLetterWithPagesMock).toHaveBeenCalledTimes(1);
  });

  it('reloads input after claim and returns superseded without notifications or entities', async () => {
    completeMetadataMock.mockResolvedValue(false);

    await expect(runMetadataExtractionV2('letter-1')).resolves.toEqual({
      kind: 'superseded',
    });

    expect(getLetterWithPagesMock).toHaveBeenCalledTimes(2);
    expect(extractMetadataV2Mock).toHaveBeenCalledTimes(1);
    expect(extractEntitiesMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(claimEntityExtractionMock).not.toHaveBeenCalledWith(
      'letter-1',
      'PENDING',
    );
  });

  it('rejects a post-claim source revision change before calling OpenAI', async () => {
    getLetterWithPagesMock.mockResolvedValue({
      ...letter(),
      metadataRevision: 5,
    });

    await expect(
      runMetadataExtractionV2('letter-1', undefined, { runId: 'run-a', revision: 4 }),
    ).resolves.toEqual({ kind: 'superseded' });

    expect(extractMetadataV2Mock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(failMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { runId: 'run-a', revision: 4 },
      'Metadata source changed immediately after claim',
    );
  });

  it('derives queued identity corrections from the post-claim reload', async () => {
    getLetterWithPagesMock
      .mockResolvedValueOnce({
        ...letter(),
        metadataStatus: 'PENDING',
        metadataRunId: null,
        metadataRunRevision: null,
        metadataLeaseExpiresAt: null,
        metadataLeaseRunId: null,
        metadataClaimKind: null,
        sender: 'Stale Alice',
      })
      .mockResolvedValueOnce({
        ...letter(),
        sender: 'Fresh Bob',
        recipient: 'Fresh Carol',
      });

    await expect(runMetadataExtractionV2('letter-1')).resolves.toEqual({
      kind: 'completed',
    });

    expect(extractMetadataV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      corrections: expect.objectContaining({
        confirmedSender: 'Fresh Bob',
        confirmedRecipient: 'Fresh Carol',
      }),
    }));
  });

  it('does not couple a valid owned run to unrelated updatedAt changes', async () => {
    getLetterWithPagesMock.mockResolvedValue({
      ...letter(),
      updatedAt: new Date('2026-07-17T12:00:01.000Z'),
    });

    await expect(
      runMetadataExtractionV2('letter-1', undefined, { runId: 'run-a', revision: 4 }),
    ).resolves.toEqual({ kind: 'completed' });

    expect(extractMetadataV2Mock).toHaveBeenCalledTimes(1);
    expect(failMetadataMock).not.toHaveBeenCalled();
  });

  it('does not let a stale failure replace newer metadata state', async () => {
    const providerError = new Error('provider failed');
    extractMetadataV2Mock.mockRejectedValue(providerError);
    failMetadataMock.mockResolvedValue(false);

    await expect(
      runMetadataExtractionV2('letter-1', undefined, { runId: 'run-a', revision: 4 }),
    ).resolves.toEqual({ kind: 'superseded' });

    expect(failMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { runId: 'run-a', revision: 4 },
      'provider failed',
    );
  });

  it('stops before OpenAI when the immediate heartbeat loses ownership', async () => {
    withMetadataHeartbeatMock.mockImplementationOnce(
      async (_letterId, _claim, operation) => operation({ hasOwnership: () => false }),
    );

    await expect(
      runMetadataExtractionV2('letter-1', undefined, { runId: 'run-a', revision: 4 }),
    ).resolves.toEqual({ kind: 'superseded' });

    expect(extractMetadataV2Mock).not.toHaveBeenCalled();
    expect(completeMetadataMock).not.toHaveBeenCalled();
  });
});
