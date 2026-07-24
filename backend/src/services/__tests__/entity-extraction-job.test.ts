import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomUUIDMock,
  dbUpdateMock,
  updateSetMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: randomUUIDMock }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  gt: vi.fn((field: unknown, value: unknown) => ({ kind: 'gt', field, value })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    text: Array.from(strings).join('?'),
    values,
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ warn: loggerWarnMock })),
}));

vi.mock('../../db/index.js', () => ({
  db: { update: dbUpdateMock },
  letters: {
    id: 'letters.id',
    primarySourceRevision: 'letters.primarySourceRevision',
    dateRaw: 'letters.dateRaw',
    type: 'letters.type',
    transcriptionStatus: 'letters.transcriptionStatus',
    metadataStatus: 'letters.metadataStatus',
    extraContentJobStatus: 'letters.extraContentJobStatus',
    entityExtractionStatus: 'letters.entityExtractionStatus',
    entityExtractionRevision: 'letters.entityExtractionRevision',
    entityExtractionRunId: 'letters.entityExtractionRunId',
    entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
    entityExtractionLeaseExpiresAt: 'letters.entityExtractionLeaseExpiresAt',
    entityExtractionLeaseRunId: 'letters.entityExtractionLeaseRunId',
    entityExtractionClaimKind: 'letters.entityExtractionClaimKind',
    entityExtractionError: 'letters.entityExtractionError',
    deadLetter: 'letters.deadLetter',
    updatedAt: 'letters.updatedAt',
  },
  workerState: {
    id: 'workerState.id',
    executionToken: 'workerState.executionToken',
    executionLeaseExpiresAt: 'workerState.executionLeaseExpiresAt',
  },
}));

import {
  cancelEntityExtractionAttempt,
  cancelLegacyEntityExtraction,
  claimQueuedEntityExtraction,
  claimRequestedEntityExtraction,
  clearedEntityExtractionOwnership,
  failEntityExtraction,
  observeEntityExtractionState,
  recoverExpiredEntityExtractionJobs,
  renewEntityExtractionLease,
  withEntityExtractionHeartbeat,
  type EntityExtractionClaim,
  type ObservedEntityExtractionState,
} from '../letter/entity-extraction-job.js';

type Status = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

interface EntityRow {
  id: string;
  primarySourceRevision: number;
  dateRaw: string;
  type: 'L' | 'P';
  transcriptionStatus: Status;
  metadataStatus: Status;
  extraContentJobStatus: Status;
  entityExtractionStatus: Status;
  entityExtractionRevision: number;
  entityExtractionRunId: string | null;
  entityExtractionRunRevision: number | null;
  entityExtractionLeaseExpiresAt: Date | null;
  entityExtractionLeaseRunId: string | null;
  entityExtractionClaimKind: 'QUEUED' | 'REQUESTED' | null;
  entityExtractionError: string | null;
  entityExtractionJson: unknown;
  deadLetter: boolean;
  updatedAt: Date;
}

let row: EntityRow;
let databaseTime: Date;
let workerTokenValid: boolean;

function observed(
  overrides: Partial<ObservedEntityExtractionState> = {},
): ObservedEntityExtractionState {
  return {
    ...observeEntityExtractionState(row),
    ...overrides,
  };
}

function sqlValue(value: unknown): unknown {
  const expression = value as {
    kind?: string;
    text?: string;
    values?: unknown[];
  };
  if (expression?.kind !== 'sql') return value;
  if (expression.text?.includes('clock_timestamp()')) return databaseTime;
  if (
    expression.text?.includes('+ 1')
    && expression.values?.[0] === 'letters.entityExtractionRevision'
  ) {
    return row.entityExtractionRevision + 1;
  }
  return value;
}

function matches(condition: unknown): boolean {
  const clause = condition as {
    kind: 'and' | 'eq' | 'gt' | 'isNotNull' | 'isNull' | 'lte' | 'ne' | 'sql';
    clauses?: unknown[];
    field?: string;
    value?: unknown;
    text?: string;
  };
  if (clause.kind === 'and') return clause.clauses?.every(matches) ?? false;
  if (clause.kind === 'sql') {
    return clause.text?.includes('EXISTS') ? workerTokenValid : false;
  }
  if (!clause.field?.startsWith('letters.')) return false;

  const key = clause.field.slice('letters.'.length) as keyof EntityRow;
  if (clause.kind === 'isNull') return row[key] === null;
  if (clause.kind === 'isNotNull') return row[key] !== null;
  if (clause.kind === 'eq') {
    if (
      typeof clause.value === 'string'
      && clause.value.startsWith('letters.')
    ) {
      const valueKey = clause.value.slice('letters.'.length) as keyof EntityRow;
      return row[key] === row[valueKey];
    }
    return row[key] === sqlValue(clause.value);
  }
  if (clause.kind === 'ne') return row[key] !== clause.value;

  const actual = row[key];
  const expected = sqlValue(clause.value);
  if (!(actual instanceof Date) || !(expected instanceof Date)) return false;
  if (clause.kind === 'gt') return actual > expected;
  return clause.kind === 'lte' && actual <= expected;
}

function evaluatedUpdates(updates: Partial<EntityRow>): Partial<EntityRow> {
  return Object.fromEntries(Object.entries(updates).map(([key, value]) => {
    const expression = value as {
      kind?: string;
      text?: string;
      values?: unknown[];
    };
    if (
      expression?.kind === 'sql'
      && expression.text?.includes("interval '5 minutes'")
    ) {
      return [key, new Date(databaseTime.getTime() + 5 * 60_000)];
    }
    if (
      key === 'entityExtractionRunRevision'
      && expression?.kind === 'sql'
      && expression.text?.includes('+ 1')
    ) {
      return [key, row.entityExtractionRevision + 1];
    }
    return [key, value];
  })) as Partial<EntityRow>;
}

function installStatefulDatabase() {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation((updates: Partial<EntityRow>) => ({
    where: (condition: unknown) => ({
      returning: async (projection?: Record<string, string>) => {
        if (!matches(condition)) return [];
        Object.assign(row, evaluatedUpdates(updates));
        if (!projection) return [{ id: row.id }];
        return [Object.fromEntries(
          Object.entries(projection).map(([alias, field]) => [
            alias,
            row[field.slice('letters.'.length) as keyof EntityRow],
          ]),
        )];
      },
    }),
  }));
}

function claim(): EntityExtractionClaim {
  return {
    runId: row.entityExtractionRunId!,
    revision: row.entityExtractionRunRevision!,
  };
}

describe('entity extraction job lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = {
      id: 'letter-1',
      primarySourceRevision: 7,
      dateRaw: '19440102',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      extraContentJobStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      entityExtractionRevision: 2,
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: null,
      entityExtractionJson: { people: [{ name: 'Previously committed' }] },
      deadLetter: false,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    databaseTime = new Date('2026-07-17T12:00:00.000Z');
    workerTokenValid = true;
    randomUUIDMock.mockReturnValue('run-a');
    installStatefulDatabase();
  });

  it('claims queued work with an exact run, reserved revision, lease, and intent', async () => {
    await expect(
      claimQueuedEntityExtraction(row.id, observed()),
    ).resolves.toEqual({ runId: 'run-a', revision: 3 });

    expect(row).toMatchObject({
      entityExtractionStatus: 'RUNNING',
      entityExtractionRevision: 2,
      entityExtractionRunId: 'run-a',
      entityExtractionRunRevision: 3,
      entityExtractionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      entityExtractionLeaseRunId: 'run-a',
      entityExtractionClaimKind: 'QUEUED',
      entityExtractionError: null,
      entityExtractionJson: { people: [{ name: 'Previously committed' }] },
    });
  });

  it('fences a worker claim with the live global execution token', async () => {
    workerTokenValid = false;

    await expect(
      claimQueuedEntityExtraction(row.id, observed(), 'execution-a'),
    ).resolves.toBeNull();
    expect(row.entityExtractionStatus).toBe('PENDING');

    workerTokenValid = true;
    await expect(
      claimQueuedEntityExtraction(row.id, observed(), 'execution-a'),
    ).resolves.toEqual({ runId: 'run-a', revision: 3 });
  });

  it('claims requested replacements directly without exposing them as PENDING', async () => {
    row.entityExtractionStatus = 'SUCCESS';
    row.deadLetter = true;

    await expect(
      claimRequestedEntityExtraction(row.id, observed(), row.primarySourceRevision),
    ).resolves.toEqual({ runId: 'run-a', revision: 3 });

    expect(row).toMatchObject({
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: 'run-a',
      entityExtractionRunRevision: 3,
      entityExtractionLeaseRunId: 'run-a',
      entityExtractionClaimKind: 'REQUESTED',
      deadLetter: false,
    });
  });

  it('overwrites paired terminal rollout residue on a new claim', async () => {
    row.entityExtractionLeaseExpiresAt =
      new Date('2026-07-17T11:00:00.000Z');
    row.entityExtractionLeaseRunId = 'retired-run';
    row.entityExtractionClaimKind = 'REQUESTED';

    await expect(
      claimQueuedEntityExtraction(row.id, observed()),
    ).resolves.toEqual({ runId: 'run-a', revision: 3 });

    expect(row).toMatchObject({
      entityExtractionLeaseRunId: 'run-a',
      entityExtractionClaimKind: 'QUEUED',
      entityExtractionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
    });
  });

  it('rejects stale, ineligible, dead-lettered, and partial ownership observations', async () => {
    const stale = observed();
    row.entityExtractionRevision = 3;
    await expect(
      claimQueuedEntityExtraction(row.id, stale),
    ).resolves.toBeNull();

    row.entityExtractionRevision = 2;
    row.type = 'P';
    await expect(
      claimQueuedEntityExtraction(row.id, observed()),
    ).resolves.toBeNull();

    row.type = 'L';
    row.metadataStatus = 'FAILED';
    await expect(
      claimRequestedEntityExtraction(row.id, observed(), row.primarySourceRevision),
    ).resolves.toBeNull();

    row.metadataStatus = 'SUCCESS';
    row.extraContentJobStatus = 'RUNNING';
    await expect(
      claimRequestedEntityExtraction(row.id, observed(), row.primarySourceRevision),
    ).resolves.toBeNull();

    row.extraContentJobStatus = 'PENDING';
    row.deadLetter = true;
    await expect(
      claimQueuedEntityExtraction(row.id, observed()),
    ).resolves.toBeNull();

    row.deadLetter = false;
    row.entityExtractionLeaseExpiresAt =
      new Date('2026-07-17T12:01:00.000Z');
    await expect(
      claimQueuedEntityExtraction(row.id, observed()),
    ).resolves.toBeNull();
  });

  it('renews and fails only the exact still-live bound attempt', async () => {
    await claimQueuedEntityExtraction(row.id, observed());
    const owned = claim();

    databaseTime = new Date('2026-07-17T12:04:00.000Z');
    await expect(
      renewEntityExtractionLease(row.id, owned),
    ).resolves.toBe(true);
    expect(row.entityExtractionLeaseExpiresAt).toEqual(
      new Date('2026-07-17T12:09:00.000Z'),
    );

    await expect(
      failEntityExtraction(row.id, owned, 'provider failed'),
    ).resolves.toBe(true);
    expect(row).toMatchObject({
      entityExtractionStatus: 'FAILED',
      entityExtractionRevision: 2,
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: 'provider failed',
      entityExtractionJson: { people: [{ name: 'Previously committed' }] },
    });
  });

  it('does not renew, fail, or revive an expired or mismatched attempt', async () => {
    await claimQueuedEntityExtraction(row.id, observed());
    const owned = claim();
    databaseTime = new Date('2026-07-17T12:06:00.000Z');

    await expect(
      renewEntityExtractionLease(row.id, owned),
    ).resolves.toBe(false);
    await expect(
      failEntityExtraction(row.id, owned, 'late failure'),
    ).resolves.toBe(false);

    databaseTime = new Date('2026-07-17T12:01:00.000Z');
    row.entityExtractionLeaseRunId = 'other-run';
    await expect(
      renewEntityExtractionLease(row.id, owned),
    ).resolves.toBe(false);
  });

  it('allows exact administrative cancellation after expiry and for pre-lease runs', async () => {
    await claimRequestedEntityExtraction(
      row.id,
      observed(),
      row.primarySourceRevision,
    );
    const owned = claim();
    databaseTime = new Date('2026-07-17T12:06:00.000Z');

    await expect(
      cancelEntityExtractionAttempt(row.id, owned),
    ).resolves.toBe(true);
    expect(row.entityExtractionStatus).toBe('FAILED');
    expect(row.entityExtractionLeaseExpiresAt).toBeNull();

    row.entityExtractionStatus = 'RUNNING';
    row.entityExtractionRunId = 'pre-lease-run';
    row.entityExtractionRunRevision = 3;
    row.entityExtractionLeaseExpiresAt = null;
    row.entityExtractionLeaseRunId = null;
    row.entityExtractionClaimKind = null;

    await expect(
      cancelEntityExtractionAttempt(
        row.id,
        { runId: 'pre-lease-run', revision: 3 },
      ),
    ).resolves.toBe(true);
  });

  it('cancels only the exact fully tokenless legacy shape', async () => {
    row.entityExtractionStatus = 'RUNNING';

    await expect(
      cancelLegacyEntityExtraction(row.id, 'Legacy cancelled'),
    ).resolves.toBe(true);
    expect(row).toMatchObject({
      entityExtractionStatus: 'FAILED',
      entityExtractionError: 'Legacy cancelled',
    });

    row.entityExtractionStatus = 'RUNNING';
    row.entityExtractionLeaseExpiresAt =
      new Date('2026-07-17T12:05:00.000Z');
    row.entityExtractionLeaseRunId = 'residue';
    row.entityExtractionClaimKind = 'QUEUED';
    await expect(
      cancelLegacyEntityExtraction(row.id, 'Do not infer'),
    ).resolves.toBe(false);
  });

  it('requeues expired queued intent and fails expired requested intent', async () => {
    await claimQueuedEntityExtraction(row.id, observed());
    databaseTime = new Date('2026-07-17T12:06:00.000Z');

    await expect(recoverExpiredEntityExtractionJobs()).resolves.toEqual({
      requeued: [{ id: 'letter-1', dateRaw: '19440102' }],
      failed: [],
    });
    expect(row).toMatchObject({
      entityExtractionStatus: 'PENDING',
      entityExtractionRevision: 2,
      entityExtractionRunId: null,
      entityExtractionError: null,
      entityExtractionJson: { people: [{ name: 'Previously committed' }] },
    });

    row.entityExtractionStatus = 'SUCCESS';
    randomUUIDMock.mockReturnValue('run-b');
    databaseTime = new Date('2026-07-17T12:07:00.000Z');
    await claimRequestedEntityExtraction(
      row.id,
      observed(),
      row.primarySourceRevision,
    );
    databaseTime = new Date('2026-07-17T12:13:00.000Z');

    await expect(recoverExpiredEntityExtractionJobs()).resolves.toEqual({
      requeued: [],
      failed: [{ id: 'letter-1', dateRaw: '19440102' }],
    });
    expect(row).toMatchObject({
      entityExtractionStatus: 'FAILED',
      entityExtractionRevision: 2,
      entityExtractionRunId: null,
      entityExtractionError:
        'Entity extraction lease expired before the attempt completed',
      entityExtractionJson: { people: [{ name: 'Previously committed' }] },
    });
  });

  it('ignores unleased and mismatched attempts and reports one recovery winner', async () => {
    row.entityExtractionStatus = 'RUNNING';
    row.entityExtractionRunId = 'pre-lease-run';
    row.entityExtractionRunRevision = 3;

    await expect(recoverExpiredEntityExtractionJobs()).resolves.toEqual({
      requeued: [],
      failed: [],
    });

    row.entityExtractionStatus = 'PENDING';
    row.entityExtractionRunId = null;
    row.entityExtractionRunRevision = null;
    await claimQueuedEntityExtraction(row.id, observed());
    row.entityExtractionLeaseRunId = 'mismatched-run';
    databaseTime = new Date('2026-07-17T12:06:00.000Z');
    await expect(recoverExpiredEntityExtractionJobs()).resolves.toEqual({
      requeued: [],
      failed: [],
    });

    row.entityExtractionLeaseRunId = row.entityExtractionRunId;
    const [first, second] = await Promise.all([
      recoverExpiredEntityExtractionJobs(),
      recoverExpiredEntityExtractionJobs(),
    ]);
    expect([first, second]).toContainEqual({
      requeued: [{ id: 'letter-1', dateRaw: '19440102' }],
      failed: [],
    });
    expect([first, second]).toContainEqual({ requeued: [], failed: [] });
  });

  it('requires a live worker token for worker-owned recovery', async () => {
    await claimQueuedEntityExtraction(row.id, observed());
    databaseTime = new Date('2026-07-17T12:06:00.000Z');
    workerTokenValid = false;

    await expect(
      recoverExpiredEntityExtractionJobs('execution-a'),
    ).resolves.toEqual({ requeued: [], failed: [] });

    workerTokenValid = true;
    await expect(
      recoverExpiredEntityExtractionJobs('execution-a'),
    ).resolves.toEqual({
      requeued: [{ id: 'letter-1', dateRaw: '19440102' }],
      failed: [],
    });
  });

  it('uses the shared immediate heartbeat without widening the stage API', async () => {
    await claimQueuedEntityExtraction(row.id, observed());
    const owned = claim();
    const operation = vi.fn(async heartbeat => heartbeat.hasOwnership());

    await expect(
      withEntityExtractionHeartbeat(row.id, owned, operation),
    ).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(row.entityExtractionLeaseExpiresAt).toEqual(
      new Date('2026-07-17T12:05:00.000Z'),
    );
  });

  it('defines one complete omission-proof clear patch', () => {
    expect(clearedEntityExtractionOwnership()).toEqual({
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
    });
  });
});
