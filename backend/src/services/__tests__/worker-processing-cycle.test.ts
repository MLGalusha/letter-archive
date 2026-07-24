import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  andMock,
  conditionTokens,
  findManyMock,
  processLetterMock,
  tryTranscribeExtrasMock,
  processMetadataMock,
  runEntityExtractionOnlyMock,
  notifyMock,
  queuedTranscriptionConditionsMock,
  queuedExtraContentConditionsMock,
  queuedMetadataConditionsMock,
  queuedEntityExtractionConditionsMock,
  loggerDebugMock,
  loggerInfoMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  const tokens = {
    transcription: { stage: 'transcription' },
    extraContent: { stage: 'extraContent' },
    metadata: { stage: 'metadata' },
    entity: { stage: 'entity' },
  } as const;

  return {
    andMock: vi.fn((...conditions: unknown[]) => ({
      kind: 'and',
      conditions,
    })),
    conditionTokens: tokens,
    findManyMock: vi.fn(),
    processLetterMock: vi.fn(),
    tryTranscribeExtrasMock: vi.fn(),
    processMetadataMock: vi.fn(),
    runEntityExtractionOnlyMock: vi.fn(),
    notifyMock: vi.fn(),
    queuedTranscriptionConditionsMock: vi.fn(() => [tokens.transcription]),
    queuedExtraContentConditionsMock: vi.fn(() => [tokens.extraContent]),
    queuedMetadataConditionsMock: vi.fn(() => [tokens.metadata]),
    queuedEntityExtractionConditionsMock: vi.fn(() => [tokens.entity]),
    loggerDebugMock: vi.fn(),
    loggerInfoMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  and: andMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      letters: {
        findMany: findManyMock,
      },
    },
  },
}));

vi.mock('../../pipeline/processor.js', () => ({
  processLetter: processLetterMock,
  processMetadata: processMetadataMock,
}));

vi.mock('../../pipeline/metadataV2.js', () => ({
  runEntityExtractionOnly: runEntityExtractionOnlyMock,
}));

vi.mock('../letter/extra-content.js', () => ({
  tryTranscribeExtras: tryTranscribeExtrasMock,
}));

vi.mock('../notifications.js', () => ({
  notify: notifyMock,
}));

vi.mock('../processing-eligibility.js', () => ({
  queuedTranscriptionConditions: queuedTranscriptionConditionsMock,
  queuedExtraContentConditions: queuedExtraContentConditionsMock,
  queuedMetadataConditions: queuedMetadataConditionsMock,
  queuedEntityExtractionConditions: queuedEntityExtractionConditionsMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: loggerDebugMock,
    info: loggerInfoMock,
    error: loggerErrorMock,
  }),
}));

import {
  processWorkerCycle,
  WORKER_BATCH_SIZE,
  type WorkerCycleControl,
} from '../worker-processing-cycle.js';

const workerToken = 'worker-execution-token';
const queueOrder = [
  'transcription',
  'extraContent',
  'metadata',
  'entity',
] as const;

type QueueName = (typeof queueOrder)[number];

interface CycleLetter {
  id: string;
  collectionId: string;
  dateRaw: string | null;
}

interface FindManyQuery {
  where: {
    kind: 'and';
    conditions: unknown[];
  };
  columns: {
    id: boolean;
    collectionId: boolean;
    dateRaw: boolean;
  };
  limit: number;
  orderBy: (
    letter: { createdAt: unknown },
    operators: { asc: (value: unknown) => unknown },
  ) => unknown[];
}

function letter(id: string, dateRaw: string | null = '1944-06-06'): CycleLetter {
  return {
    id,
    collectionId: 'collection-1',
    dateRaw,
  };
}

function createControl(
  overrides: Partial<WorkerCycleControl> = {},
): WorkerCycleControl {
  return {
    executionToken: workerToken,
    canStartOperation: () => true,
    publishState: vi.fn(),
    ...overrides,
  };
}

function queueFromQuery(query: FindManyQuery): QueueName {
  const condition = query.where.conditions[0];
  const queue = queueOrder.find(
    candidate => conditionTokens[candidate] === condition,
  );
  if (!queue) throw new Error('Unexpected worker queue predicate');
  return queue;
}

function installBatches(
  overrides: Partial<Record<QueueName, CycleLetter[]>> = {},
  trace?: string[],
  onFind?: (queue: QueueName) => void,
): void {
  const batches: Record<QueueName, CycleLetter[]> = {
    transcription: [],
    extraContent: [],
    metadata: [],
    entity: [],
    ...overrides,
  };

  findManyMock.mockImplementation(async (query: FindManyQuery) => {
    const queue = queueFromQuery(query);
    trace?.push(`find:${queue}`);
    onFind?.(queue);
    return batches[queue];
  });
}

const producerMocks = [
  processLetterMock,
  tryTranscribeExtrasMock,
  processMetadataMock,
  runEntityExtractionOnlyMock,
];

beforeEach(() => {
  findManyMock.mockReset();
  processLetterMock.mockReset().mockResolvedValue(undefined);
  tryTranscribeExtrasMock.mockReset().mockResolvedValue({
    kind: 'completed',
    value: {
      transcribedCount: 1,
      extraContentStatus: 'AI_DRAFT',
      message: 'Transcribed',
    },
  });
  processMetadataMock.mockReset().mockResolvedValue(undefined);
  runEntityExtractionOnlyMock.mockReset().mockResolvedValue(undefined);
  notifyMock.mockReset().mockResolvedValue(null);
  installBatches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('worker processing cycle', () => {
  it('uses each production queue predicate with a bounded oldest-first projection', async () => {
    const publishState = vi.fn();

    await expect(
      processWorkerCycle(createControl({ publishState })),
    ).resolves.toBe(false);

    expect(WORKER_BATCH_SIZE).toBe(5);
    expect(findManyMock).toHaveBeenCalledTimes(4);
    expect(queuedTranscriptionConditionsMock).toHaveBeenCalledOnce();
    expect(queuedExtraContentConditionsMock).toHaveBeenCalledOnce();
    expect(queuedMetadataConditionsMock).toHaveBeenCalledOnce();
    expect(queuedEntityExtractionConditionsMock).toHaveBeenCalledOnce();

    for (const [index, queue] of queueOrder.entries()) {
      const query = findManyMock.mock.calls[index]?.[0] as FindManyQuery;
      expect(query).toMatchObject({
        where: {
          kind: 'and',
          conditions: [conditionTokens[queue]],
        },
        columns: {
          id: true,
          collectionId: true,
          dateRaw: true,
        },
        limit: WORKER_BATCH_SIZE,
      });

      const asc = vi.fn((value: unknown) => ({ ascending: value }));
      expect(query.orderBy(
        { createdAt: 'letters.createdAt' },
        { asc },
      )).toEqual([{ ascending: 'letters.createdAt' }]);
      expect(asc).toHaveBeenCalledWith('letters.createdAt');
    }

    expect(publishState).toHaveBeenCalledOnce();
    expect(publishState).toHaveBeenCalledWith({
      currentBatchSize: 0,
      lastError: null,
    });
  });

  it('snapshots then executes the four explicit stages with exact worker options', async () => {
    const trace: string[] = [];
    const transcription = letter('transcription-1');
    const extraContent = letter('extra-1');
    const metadata = letter('metadata-1');
    const entity = letter('entity-1');
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    installBatches({
      transcription: [transcription],
      extraContent: [extraContent],
      metadata: [metadata],
      entity: [entity],
    }, trace);
    processLetterMock.mockImplementation(async () => {
      trace.push('run:transcription');
    });
    tryTranscribeExtrasMock.mockImplementation(async () => {
      trace.push('run:extraContent');
      return { kind: 'completed' };
    });
    processMetadataMock.mockImplementation(async () => {
      trace.push('run:metadata');
    });
    runEntityExtractionOnlyMock.mockImplementation(async () => {
      trace.push('run:entity');
    });

    await expect(
      processWorkerCycle(createControl()),
    ).resolves.toBe(true);

    expect(trace).toEqual([
      'find:transcription',
      'find:extraContent',
      'find:metadata',
      'find:entity',
      'run:transcription',
      'run:extraContent',
      'run:metadata',
      'run:entity',
    ]);
    expect(processLetterMock).toHaveBeenCalledWith(transcription.id, {
      extraContent: 'skip',
      workerExecutionToken: workerToken,
    });
    expect(tryTranscribeExtrasMock).toHaveBeenCalledWith(extraContent.id, {
      expectedStatus: 'PENDING',
      claimKind: 'QUEUED',
      workerExecutionToken: workerToken,
    });
    expect(processMetadataMock).toHaveBeenCalledWith(metadata.id, {
      entityExtraction: 'deferred',
      workerExecutionToken: workerToken,
    });
    expect(runEntityExtractionOnlyMock).toHaveBeenCalledWith(entity.id, {
      workerExecutionToken: workerToken,
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcription_success',
        message: '1944-06-06 transcribed in 0.0s',
      }),
    );
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionCount: 1,
        extraContentCount: 1,
        metadataCount: 1,
        entityCount: 1,
        totalProcessed: 4,
      }),
      'Processing cycle completed',
    );
  });

  it('does not query durable work without execution ownership', async () => {
    const publishState = vi.fn();

    await expect(
      processWorkerCycle(createControl({
        canStartOperation: () => false,
        publishState,
      })),
    ).resolves.toBe(false);

    expect(findManyMock).not.toHaveBeenCalled();
    expect(publishState).not.toHaveBeenCalled();
  });

  it.each(queueOrder)(
    'stops after %s discovery when execution ownership is lost',
    async targetQueue => {
      let owned = true;
      installBatches(
        { [targetQueue]: [letter(`${targetQueue}-1`)] },
        undefined,
        queue => {
          if (queue === targetQueue) owned = false;
        },
      );

      await expect(
        processWorkerCycle(createControl({
          canStartOperation: () => owned,
        })),
      ).resolves.toBe(false);

      expect(findManyMock).toHaveBeenCalledTimes(
        queueOrder.indexOf(targetQueue) + 1,
      );
      for (const producer of producerMocks) {
        expect(producer).not.toHaveBeenCalled();
      }
    },
  );

  it.each(queueOrder)(
    'settles one %s job and suppresses later work after ownership loss',
    async targetQueue => {
      let owned = true;
      installBatches(Object.fromEntries(
        queueOrder.map(queue => [
          queue,
          [
            letter(`${queue}-1`),
            ...(queue === targetQueue ? [letter(`${queue}-2`)] : []),
          ],
        ]),
      ));

      const loseAtTarget = (queue: QueueName) => {
        if (queue === targetQueue) owned = false;
      };
      processLetterMock.mockImplementation(async () => {
        loseAtTarget('transcription');
      });
      tryTranscribeExtrasMock.mockImplementation(async () => {
        loseAtTarget('extraContent');
        return { kind: 'completed' };
      });
      processMetadataMock.mockImplementation(async () => {
        loseAtTarget('metadata');
      });
      runEntityExtractionOnlyMock.mockImplementation(async () => {
        loseAtTarget('entity');
      });

      await expect(
        processWorkerCycle(createControl({
          canStartOperation: () => owned,
        })),
      ).resolves.toBe(true);

      for (const [stageIndex, producer] of producerMocks.entries()) {
        expect(producer).toHaveBeenCalledTimes(
          stageIndex <= queueOrder.indexOf(targetQueue) ? 1 : 0,
        );
      }
    },
  );

  it('waits for an active producer to settle before suppressing later work', async () => {
    let owned = true;
    let resolveActive!: () => void;
    const activeJob = new Promise<void>(resolve => {
      resolveActive = resolve;
    });
    installBatches({
      transcription: [
        letter('transcription-1'),
        letter('transcription-2'),
      ],
      extraContent: [letter('extra-1')],
    });
    processLetterMock.mockReturnValueOnce(activeJob);

    const cycle = processWorkerCycle(createControl({
      canStartOperation: () => owned,
    }));
    await vi.waitFor(() => {
      expect(processLetterMock).toHaveBeenCalledOnce();
    });

    owned = false;
    let settled = false;
    void cycle.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveActive();
    await expect(cycle).resolves.toBe(true);
    expect(processLetterMock).toHaveBeenCalledOnce();
    expect(tryTranscribeExtrasMock).not.toHaveBeenCalled();
  });

  it('treats each stage-specific neutral outcome as discovered work', async () => {
    installBatches({
      transcription: [letter('transcription-1')],
      extraContent: [letter('extra-1')],
      metadata: [letter('metadata-1')],
      entity: [letter('entity-1')],
    });
    processLetterMock.mockResolvedValue({
      kind: 'skipped',
      reason: 'claim_lost',
    });
    tryTranscribeExtrasMock.mockResolvedValue({ kind: 'claim_lost' });
    processMetadataMock.mockResolvedValue({
      kind: 'skipped',
      reason: 'superseded',
    });

    await expect(
      processWorkerCycle(createControl()),
    ).resolves.toBe(true);

    for (const producer of producerMocks) {
      expect(producer).toHaveBeenCalledOnce();
    }
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('isolates failures, publishes the exact state sequence, and continues', async () => {
    const publishState = vi.fn();
    installBatches({
      transcription: [letter('transcription-1')],
      extraContent: [letter('extra-1')],
      metadata: [letter('metadata-1')],
      entity: [letter('entity-1')],
    });
    processLetterMock.mockRejectedValue(new Error('transcription failed'));
    tryTranscribeExtrasMock.mockRejectedValue(new Error('extra failed'));
    processMetadataMock.mockRejectedValue(new Error('metadata failed'));
    runEntityExtractionOnlyMock.mockRejectedValue('entity failed');

    await expect(
      processWorkerCycle(createControl({ publishState })),
    ).resolves.toBe(true);

    expect(publishState.mock.calls.map(([update]) => update)).toEqual([
      { currentBatchSize: 4, lastError: null },
      { currentBatchSize: 4, lastError: null },
      { currentBatchSize: 4, lastError: 'transcription failed' },
      { currentBatchSize: 4, lastError: null },
      { currentBatchSize: 4, lastError: 'extra failed' },
      { currentBatchSize: 4, lastError: null },
      { currentBatchSize: 4, lastError: 'metadata failed' },
      { currentBatchSize: 4, lastError: null },
      { currentBatchSize: 4, lastError: 'Unknown error' },
    ]);
    for (const producer of producerMocks) {
      expect(producer).toHaveBeenCalledOnce();
    }

    const expectedFailures = [
      ['transcription_failed', 'Transcription failed', 'transcription-1', 'transcription failed'],
      ['extra_content_failed', 'Extra-content transcription failed', 'extra-1', 'extra failed'],
      ['metadata_failed', 'Metadata extraction failed', 'metadata-1', 'metadata failed'],
      ['entity_failed', 'Entity extraction failed', 'entity-1', 'Unknown error'],
    ] as const;
    expect(notifyMock).toHaveBeenCalledTimes(expectedFailures.length);
    for (const [index, [type, title, id, message]] of expectedFailures.entries()) {
      expect(notifyMock).toHaveBeenNthCalledWith(index + 1, {
        type,
        title,
        message,
        link: `/admin/letters/${id}`,
        sourceType: 'letter',
        sourceId: id,
        metadata: {
          error: message,
          durationMs: expect.any(Number),
          dateRaw: '1944-06-06',
        },
        dedupeKey: `${type}:${id}`,
      });
    }
  });

  it('keeps the discovered size fixed before and after successful jobs', async () => {
    const publishState = vi.fn();
    installBatches({
      transcription: [letter('transcription-1')],
      extraContent: [letter('extra-1')],
    });

    await expect(
      processWorkerCycle(createControl({ publishState })),
    ).resolves.toBe(true);

    expect(publishState.mock.calls.map(([update]) => update)).toEqual([
      { currentBatchSize: 2, lastError: null },
      { currentBatchSize: 2, lastError: null },
      { currentBatchSize: 2, lastError: null },
      { currentBatchSize: 2, lastError: null },
      { currentBatchSize: 2, lastError: null },
    ]);
  });

  it('preserves the transcription notification fallback and cycle summary', async () => {
    const publishState = vi.fn();
    installBatches({
      transcription: [letter('fallback-letter', null)],
    });
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_350)
      .mockReturnValueOnce(1_400);

    await expect(
      processWorkerCycle(createControl({ publishState })),
    ).resolves.toBe(true);

    expect(notifyMock).toHaveBeenCalledWith({
      type: 'transcription_success',
      title: 'Letter transcribed',
      message: 'fallback transcribed in 0.3s',
      link: '/admin/letters/fallback-letter',
      sourceType: 'letter',
      sourceId: 'fallback-letter',
      metadata: {
        durationMs: 350,
        dateRaw: null,
      },
    });
    expect(loggerInfoMock).toHaveBeenCalledWith({
      transcriptionCount: 1,
      extraContentCount: 0,
      metadataCount: 0,
      entityCount: 0,
      totalProcessed: 1,
      cycleDuration: 1_300,
    }, 'Processing cycle completed');
  });

  it('propagates discovery failures without running later work or reporting state', async () => {
    const publishState = vi.fn();
    installBatches({}, undefined, queue => {
      if (queue === 'metadata') {
        throw new Error('metadata query failed');
      }
    });

    await expect(
      processWorkerCycle(createControl({ publishState })),
    ).rejects.toThrow('metadata query failed');

    expect(findManyMock).toHaveBeenCalledTimes(3);
    expect(queuedEntityExtractionConditionsMock).not.toHaveBeenCalled();
    for (const producer of producerMocks) {
      expect(producer).not.toHaveBeenCalled();
    }
    expect(publishState).not.toHaveBeenCalled();
  });
});
