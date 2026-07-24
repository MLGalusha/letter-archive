import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractMetadataV2Mock,
  extractEntitiesMock,
  getLetterWithPagesMock,
  claimQueuedEntityExtractionMock,
  claimRequestedEntityExtractionMock,
  failEntityExtractionMock,
  observeEntityExtractionStateMock,
  withEntityExtractionHeartbeatMock,
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
    claimQueuedEntityExtractionMock: vi.fn(),
    claimRequestedEntityExtractionMock: vi.fn(),
    failEntityExtractionMock: vi.fn(),
    observeEntityExtractionStateMock: vi.fn(),
    withEntityExtractionHeartbeatMock: vi.fn(),
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
}));

vi.mock('../../services/letter/entity-extraction-job.js', () => ({
  claimQueuedEntityExtraction: claimQueuedEntityExtractionMock,
  claimRequestedEntityExtraction: claimRequestedEntityExtractionMock,
  failEntityExtraction: failEntityExtractionMock,
  observeEntityExtractionState: observeEntityExtractionStateMock,
  withEntityExtractionHeartbeat: withEntityExtractionHeartbeatMock,
}));

vi.mock('../../services/letter/metadata-job.js', () => ({
  observeMetadataState: observeMetadataStateMock,
  claimQueuedMetadata: claimQueuedMetadataMock,
  completeMetadata: completeMetadataMock,
  failMetadata: failMetadataMock,
  withMetadataHeartbeat: withMetadataHeartbeatMock,
}));

vi.mock('../../services/entities.js', () => ({
  EntityExtractionClaimLostError: class EntityExtractionClaimLostError extends Error {},
  processEntityExtraction: processEntityExtractionMock,
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
import { EntityExtractionClaimLostError } from '../../services/entities.js';

const entities = {
  people: [],
  places: [],
  relationships: [],
  person_place_connections: [],
};
const entityClaim = { runId: 'entity-run-a', revision: 1 };

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
    entityExtractionRevision: 0,
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionLeaseExpiresAt: null,
    entityExtractionLeaseRunId: null,
    entityExtractionClaimKind: null,
    extraContentJobStatus: 'PENDING',
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

function entityReadyLetter() {
  return {
    ...letter(),
    metadataStatus: 'SUCCESS',
    metadataRunId: null,
    metadataRunRevision: null,
    metadataLeaseExpiresAt: null,
    metadataLeaseRunId: null,
    metadataClaimKind: null,
  };
}

function ownedEntityLetter(claimKind: 'QUEUED' | 'REQUESTED' = 'QUEUED') {
  return {
    ...entityReadyLetter(),
    entityExtractionStatus: 'RUNNING',
    entityExtractionRunId: entityClaim.runId,
    entityExtractionRunRevision: entityClaim.revision,
    entityExtractionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
    entityExtractionLeaseRunId: entityClaim.runId,
    entityExtractionClaimKind: claimKind,
  };
}

function useStandaloneEntitySource() {
  getLetterWithPagesMock.mockImplementation(async () => (
    claimQueuedEntityExtractionMock.mock.calls.length > 0
      ? ownedEntityLetter('QUEUED')
      : claimRequestedEntityExtractionMock.mock.calls.length > 0
        ? ownedEntityLetter('REQUESTED')
        : entityReadyLetter()
  ));
}

describe('metadata entity persistence ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterWithPagesMock.mockImplementation(async () => (
      claimQueuedEntityExtractionMock.mock.calls.length > 0
        ? ownedEntityLetter('QUEUED')
        : claimRequestedEntityExtractionMock.mock.calls.length > 0
          ? ownedEntityLetter('REQUESTED')
          : letter()
    ));
    claimQueuedEntityExtractionMock.mockResolvedValue(entityClaim);
    claimRequestedEntityExtractionMock.mockResolvedValue(entityClaim);
    failEntityExtractionMock.mockResolvedValue(true);
    observeEntityExtractionStateMock.mockImplementation(source => source);
    withEntityExtractionHeartbeatMock.mockImplementation(
      async (_letterId, _claim, operation) =>
        operation({ hasOwnership: () => true }),
    );
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

  it('passes standalone ownership to the atomic entity commit boundary', async () => {
    useStandaloneEntitySource();

    await expect(runEntityExtractionOnly('letter-1', {
      claimKind: 'QUEUED',
      workerExecutionToken: 'execution-a',
    })).resolves.toEqual({ kind: 'completed' });

    expect(claimQueuedEntityExtractionMock).toHaveBeenCalledWith(
      'letter-1',
      expect.any(Object),
      'execution-a',
    );
    expect(getLetterWithPagesMock.mock.invocationCallOrder[0]).toBeLessThan(
      claimQueuedEntityExtractionMock.mock.invocationCallOrder[0]!,
    );
    expect(claimQueuedEntityExtractionMock.mock.invocationCallOrder[0]).toBeLessThan(
      getLetterWithPagesMock.mock.invocationCallOrder[1]!,
    );
    expect(processEntityExtractionMock).toHaveBeenCalledWith(
      entities,
      'letter-1',
      entityClaim,
    );
    expect(failEntityExtractionMock).not.toHaveBeenCalled();
  });

  it('binds standalone model input to the authoritative post-claim reload', async () => {
    getLetterWithPagesMock
      .mockResolvedValueOnce(entityReadyLetter())
      .mockResolvedValueOnce({
        ...ownedEntityLetter('REQUESTED'),
        transcriptionText: 'Fresh post-claim transcript',
        sender: 'Fresh Alice',
        recipient: 'Fresh Bob',
        summary: 'Fresh summary',
      });

    await runEntityExtractionOnly('letter-1', { claimKind: 'REQUESTED' });

    expect(claimRequestedEntityExtractionMock).toHaveBeenCalledWith(
      'letter-1',
      expect.any(Object),
    );
    expect(extractEntitiesMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: 'Fresh post-claim transcript',
      basicMetadata: {
        sender: 'Fresh Alice',
        recipient: 'Fresh Bob',
        senderRecipientRelationship: 'friend',
        summary: 'Fresh summary',
      },
    }));
  });

  it('keeps entity extraction automatic by default and passes pipeline ownership', async () => {
    await runMetadataExtractionV2('letter-1', undefined, { runId: 'run-a', revision: 4 });

    expect(completeMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { runId: 'run-a', revision: 4 },
      expect.any(Object),
    );
    expect(claimQueuedEntityExtractionMock).toHaveBeenCalledWith(
      'letter-1',
      expect.any(Object),
      undefined,
    );
    expect(claimRequestedEntityExtractionMock).not.toHaveBeenCalled();
    expect(processEntityExtractionMock).toHaveBeenCalledWith(
      entities,
      'letter-1',
      entityClaim,
    );
    expect(failEntityExtractionMock).not.toHaveBeenCalled();
  });

  it('uses the post-claim identity instead of stale Phase 1 corrections for entities', async () => {
    getLetterWithPagesMock
      .mockResolvedValueOnce({
        ...letter(),
        sender: 'Original Alice',
        recipient: 'Original Bob',
      })
      .mockResolvedValueOnce({
        ...entityReadyLetter(),
        sender: 'Newly edited Carol',
        recipient: 'Newly edited Dana',
      })
      .mockResolvedValueOnce({
        ...ownedEntityLetter('QUEUED'),
        sender: 'Newly edited Carol',
        recipient: 'Newly edited Dana',
      });

    await runMetadataExtractionV2(
      'letter-1',
      {
        confirmedSender: 'Original Alice',
        confirmedRecipient: 'Original Bob',
      },
      { runId: 'run-a', revision: 4 },
    );

    expect(extractMetadataV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      corrections: expect.objectContaining({
        confirmedSender: 'Original Alice',
        confirmedRecipient: 'Original Bob',
      }),
    }));
    expect(extractEntitiesMock).toHaveBeenCalledWith(expect.objectContaining({
      basicMetadata: expect.objectContaining({
        sender: 'Newly edited Carol',
        recipient: 'Newly edited Dana',
      }),
      corrections: undefined,
    }));
  });

  it('preserves reviewer correction semantics when the claimed identity still matches', async () => {
    getLetterWithPagesMock
      .mockResolvedValueOnce(letter())
      .mockResolvedValueOnce({
        ...entityReadyLetter(),
        sender: 'Confirmed Alice',
        recipient: 'Confirmed Bob',
      })
      .mockResolvedValueOnce({
        ...ownedEntityLetter('QUEUED'),
        sender: 'Confirmed Alice',
        recipient: 'Confirmed Bob',
      });

    await runMetadataExtractionV2(
      'letter-1',
      {
        confirmedSender: 'Confirmed Alice',
        confirmedRecipient: 'Confirmed Bob',
        previousAiSender: 'Old Alice',
        previousAiRecipient: 'Old Bob',
      },
      { runId: 'run-a', revision: 4 },
    );

    expect(extractEntitiesMock).toHaveBeenCalledWith(expect.objectContaining({
      corrections: {
        confirmedSender: 'Confirmed Alice',
        confirmedRecipient: 'Confirmed Bob',
        previousAiSender: 'Old Alice',
        previousAiRecipient: 'Old Bob',
      },
    }));
  });

  it('leaves entity extraction on the durable queue when the worker defers it', async () => {
    await expect(
      runMetadataExtractionV2(
        'letter-1',
        { entityExtraction: 'deferred' },
        { runId: 'run-a', revision: 4 },
      ),
    ).resolves.toEqual({ kind: 'completed' });

    expect(completeMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { runId: 'run-a', revision: 4 },
      expect.any(Object),
    );
    expect(extractMetadataV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      corrections: {
        confirmedSender: 'Alice',
        confirmedRecipient: 'Bob',
      },
    }));
    expect(claimQueuedEntityExtractionMock).not.toHaveBeenCalled();
    expect(claimRequestedEntityExtractionMock).not.toHaveBeenCalled();
    expect(extractEntitiesMock).not.toHaveBeenCalled();
    expect(processEntityExtractionMock).not.toHaveBeenCalled();
  });

  it('fails only the exact standalone run when extraction throws', async () => {
    useStandaloneEntitySource();
    extractEntitiesMock.mockRejectedValueOnce(new Error('provider failed'));

    await expect(runEntityExtractionOnly('letter-1', {
      claimKind: 'REQUESTED',
    })).rejects.toThrow('provider failed');

    expect(failEntityExtractionMock).toHaveBeenCalledWith(
      'letter-1',
      entityClaim,
      'provider failed',
    );
  });

  it('returns claim_lost without calling OpenAI when a standalone claim loses the CAS', async () => {
    useStandaloneEntitySource();
    claimRequestedEntityExtractionMock.mockResolvedValueOnce(null);

    await expect(runEntityExtractionOnly('letter-1', {
      claimKind: 'REQUESTED',
    })).resolves.toEqual({ kind: 'claim_lost' });

    expect(extractEntitiesMock).not.toHaveBeenCalled();
    expect(processEntityExtractionMock).not.toHaveBeenCalled();
    expect(failEntityExtractionMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('returns superseded without calling OpenAI when the entity heartbeat starts unowned', async () => {
    useStandaloneEntitySource();
    withEntityExtractionHeartbeatMock.mockImplementationOnce(
      async (_letterId, _claim, operation) =>
        operation({ hasOwnership: () => false }),
    );

    await expect(runEntityExtractionOnly('letter-1', {
      claimKind: 'REQUESTED',
    })).resolves.toEqual({ kind: 'superseded' });

    expect(extractEntitiesMock).not.toHaveBeenCalled();
    expect(processEntityExtractionMock).not.toHaveBeenCalled();
    expect(failEntityExtractionMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('returns superseded when transactional publication loses entity ownership', async () => {
    useStandaloneEntitySource();
    processEntityExtractionMock.mockRejectedValueOnce(
      new EntityExtractionClaimLostError(),
    );

    await expect(runEntityExtractionOnly('letter-1', {
      claimKind: 'REQUESTED',
    })).resolves.toEqual({ kind: 'superseded' });

    expect(failEntityExtractionMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('returns superseded when standalone failure no longer owns the attempt', async () => {
    useStandaloneEntitySource();
    extractEntitiesMock.mockRejectedValueOnce(new Error('provider failed'));
    failEntityExtractionMock.mockResolvedValueOnce(false);

    await expect(runEntityExtractionOnly('letter-1', {
      claimKind: 'REQUESTED',
    })).resolves.toEqual({ kind: 'superseded' });

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('treats embedded entity heartbeat loss as non-fatal after metadata publishes', async () => {
    withEntityExtractionHeartbeatMock.mockImplementationOnce(
      async (_letterId, _claim, operation) =>
        operation({ hasOwnership: () => false }),
    );

    await expect(
      runMetadataExtractionV2(
        'letter-1',
        undefined,
        { runId: 'run-a', revision: 4 },
      ),
    ).resolves.toEqual({ kind: 'completed' });

    expect(completeMetadataMock).toHaveBeenCalledTimes(1);
    expect(extractEntitiesMock).not.toHaveBeenCalled();
    expect(failEntityExtractionMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'metadata_success' }),
    );
    expect(notifyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'entity_success' }),
    );
  });

  it('records and reports an owned embedded entity failure without failing metadata', async () => {
    extractEntitiesMock.mockRejectedValueOnce(new Error('entity provider failed'));

    await expect(
      runMetadataExtractionV2(
        'letter-1',
        undefined,
        { runId: 'run-a', revision: 4 },
      ),
    ).resolves.toEqual({ kind: 'completed' });

    expect(failEntityExtractionMock).toHaveBeenCalledWith(
      'letter-1',
      entityClaim,
      'entity provider failed',
    );
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'entity_failed',
      metadata: {
        error: 'entity provider failed',
        fatal: false,
      },
    }));
  });

  it('does not report an embedded failure after entity ownership is superseded', async () => {
    extractEntitiesMock.mockRejectedValueOnce(new Error('entity provider failed'));
    failEntityExtractionMock.mockResolvedValueOnce(false);

    await expect(
      runMetadataExtractionV2(
        'letter-1',
        undefined,
        { runId: 'run-a', revision: 4 },
      ),
    ).resolves.toEqual({ kind: 'completed' });

    expect(notifyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'entity_failed' }),
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

  it('binds a queued metadata claim to its worker execution token', async () => {
    await expect(runMetadataExtractionV2('letter-1', {
      entityExtraction: 'deferred',
      workerExecutionToken: 'execution-a',
    })).resolves.toEqual({ kind: 'completed' });

    expect(claimQueuedMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      expect.any(Object),
      'execution-a',
    );
    expect(claimQueuedEntityExtractionMock).not.toHaveBeenCalled();
    expect(claimRequestedEntityExtractionMock).not.toHaveBeenCalled();
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
    expect(claimQueuedEntityExtractionMock).not.toHaveBeenCalled();
    expect(claimRequestedEntityExtractionMock).not.toHaveBeenCalled();
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
