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
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    text: Array.from(strings).join('?'),
    values,
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: loggerWarnMock,
    error: vi.fn(),
  })),
}));

vi.mock('../../db/index.js', () => ({
  db: { update: dbUpdateMock },
  letters: {
    id: 'letters.id',
    primarySourceRevision: 'letters.primarySourceRevision',
    entityExtractionStatus: 'letters.entityExtractionStatus',
    extraContentJobStatus: 'letters.extraContentJobStatus',
    extraContentJobRunId: 'letters.extraContentJobRunId',
    extraContentJobDirty: 'letters.extraContentJobDirty',
    extraContentJobLeaseExpiresAt: 'letters.extraContentJobLeaseExpiresAt',
    extraContentJobLeaseRunId: 'letters.extraContentJobLeaseRunId',
    extraContentJobClaimKind: 'letters.extraContentJobClaimKind',
    updatedAt: 'letters.updatedAt',
    dateRaw: 'letters.dateRaw',
  },
}));

import {
  buildHumanExtraContentJobPatch,
  cancelExtraContentAttempt,
  recoverExpiredExtraContentJobs,
  renewExtraContentLease,
  runExtraContentJob,
  withExtraContentHeartbeat,
  type ExtraContentPatch,
} from '../letter/extra-content-job.js';

interface JobRow {
  id: string;
  primarySourceRevision: number;
  entityExtractionStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  extraContentJobStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  extraContentJobError: string | null;
  extraContentJobRunId: string | null;
  extraContentJobDirty: boolean;
  extraContentJobLeaseExpiresAt: Date | null;
  extraContentJobLeaseRunId: string | null;
  extraContentJobClaimKind: 'QUEUED' | 'REQUESTED' | null;
  extraContentTranscript: string | null;
  extraContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  updatedAt: Date;
  dateRaw: string;
}

let row: JobRow;
let databaseNow: Date;
let returningError: Error | null;
let returningBarrier: Promise<void> | null;

function sqlValue(value: unknown): Date | unknown {
  const expression = value as { kind?: string; text?: string };
  if (expression?.kind === 'sql' && expression.text?.includes('clock_timestamp()')) {
    return databaseNow;
  }
  return value;
}

function matches(condition: unknown): boolean {
  const clause = condition as {
    kind: 'and' | 'eq' | 'gt' | 'isNotNull' | 'lte' | 'ne' | 'sql';
    clauses?: unknown[];
    field?: string;
    value?: unknown;
    text?: string;
    values?: unknown[];
  };
  if (clause.kind === 'and') return clause.clauses?.every(matches) ?? false;
  if (clause.kind === 'sql' && clause.text?.includes("date_trunc('milliseconds'")) {
    const field = clause.values?.[0];
    const expected = clause.values?.[1];
    if (typeof field !== 'string' || typeof expected !== 'string') return false;
    const actual = row[field.slice('letters.'.length) as keyof JobRow];
    return actual instanceof Date && actual.getTime() === new Date(expected).getTime();
  }
  if (!clause.field) return false;
  const key = clause.field.slice('letters.'.length) as keyof JobRow;
  if (clause.kind === 'isNotNull') return row[key] !== null;
  if (clause.kind === 'eq') {
    const expected = typeof clause.value === 'string' && clause.value.startsWith('letters.')
      ? row[clause.value.slice('letters.'.length) as keyof JobRow]
      : clause.value;
    return row[key] === expected;
  }
  if (clause.kind === 'ne') return row[key] !== clause.value;
  const actual = row[key];
  const expected = sqlValue(clause.value);
  if (!(actual instanceof Date) || !(expected instanceof Date)) return false;
  if (clause.kind === 'gt') return actual > expected;
  return clause.kind === 'lte' && actual <= expected;
}

function evaluatedUpdates(updates: Partial<JobRow>): Partial<JobRow> {
  return Object.fromEntries(Object.entries(updates).map(([key, value]) => {
    const expression = value as { kind?: string; text?: string };
    if (expression?.kind === 'sql' && expression.text?.includes("interval '5 minutes'")) {
      return [key, new Date(databaseNow.getTime() + 5 * 60_000)];
    }
    if (expression?.kind === 'sql' && expression.text?.includes('CASE')) {
      if (key === 'extraContentJobStatus') {
        return [key, row.extraContentJobDirty ? 'PENDING' : 'FAILED'];
      }
      if (key === 'extraContentJobError') {
        return [key, row.extraContentJobDirty ? null : 'Cancelled by admin'];
      }
    }
    return [key, value];
  })) as Partial<JobRow>;
}

function installStatefulDatabase() {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation((updates: Partial<JobRow>) => ({
    where: (condition: unknown) => ({
      returning: async () => {
        if (returningBarrier) await returningBarrier;
        if (returningError) {
          const error = returningError;
          returningError = null;
          throw error;
        }
        if (!matches(condition)) return [];
        Object.assign(row, evaluatedUpdates(updates));
        return [{ id: row.id, dateRaw: row.dateRaw }];
      },
    }),
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

const patch = (text: string): ExtraContentPatch => ({
  extraContentTranscript: text,
  extraContentStatus: 'AI_DRAFT',
  extraContentVerifiedAt: null,
  extraContentVerifiedBy: null,
});

describe('extra-content job lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = {
      id: 'letter-1',
      primarySourceRevision: 4,
      entityExtractionStatus: 'PENDING',
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      dateRaw: '1944-01-01',
    };
    databaseNow = new Date('2026-07-17T12:00:00.000Z');
    returningError = null;
    returningBarrier = null;
    randomUUIDMock.mockReturnValue('run-a');
    installStatefulDatabase();
  });

  it('does not call the producer when the compare-and-swap claim loses', async () => {
    row.extraContentJobStatus = 'RUNNING';
    const produce = vi.fn();

    const result = await runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce,
    });

    expect(result).toEqual({ kind: 'claim_lost' });
    expect(produce).not.toHaveBeenCalled();
  });

  it('does not claim after the observed letter revision changes', async () => {
    const observedUpdatedAt = row.updatedAt;
    row.updatedAt = new Date('2026-07-17T12:00:01.000Z');
    const produce = vi.fn();

    const result = await runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: observedUpdatedAt,
      claimKind: 'QUEUED',
      produce,
    });

    expect(result).toEqual({ kind: 'claim_lost' });
    expect(produce).not.toHaveBeenCalled();
  });

  it('does not overlap entity extraction while claiming extra content', async () => {
    row.entityExtractionStatus = 'RUNNING';
    const produce = vi.fn();

    await expect(runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'REQUESTED',
      produce,
    })).resolves.toEqual({ kind: 'claim_lost' });

    expect(produce).not.toHaveBeenCalled();
    expect(row.extraContentJobStatus).toBe('PENDING');
  });

  it('publishes content and SUCCESS atomically for the owning run ID', async () => {
    const result = await runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: async () => ({ value: 2, patch: patch('Fresh content') }),
    });

    expect(result).toEqual({ kind: 'completed', value: 2 });
    expect(row).toMatchObject({
      extraContentJobStatus: 'SUCCESS',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentTranscript: 'Fresh content',
      extraContentStatus: 'AI_DRAFT',
    });
    expect(updateSetMock).toHaveBeenLastCalledWith(expect.objectContaining({
      extraContentTranscript: 'Fresh content',
      extraContentJobStatus: 'SUCCESS',
    }));
  });

  it('records a producer failure and rethrows the original error', async () => {
    const failure = new Error('vision unavailable');

    await expect(runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: async () => { throw failure; },
    })).rejects.toBe(failure);

    expect(row).toMatchObject({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: 'vision unavailable',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentTranscript: null,
    });
  });

  it('discards a result and requeues when source content changed during the run', async () => {
    const work = deferred<{ value: number; patch: ExtraContentPatch }>();
    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: () => work.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobStatus).toBe('RUNNING'));
    row.extraContentJobDirty = true;

    work.resolve({ value: 1, patch: patch('Now stale') });
    await expect(attempt).resolves.toEqual({ kind: 'superseded' });

    expect(row).toMatchObject({
      extraContentJobStatus: 'PENDING',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      extraContentTranscript: null,
    });
  });

  it('discards and requeues a result when the primary source revision changes', async () => {
    const work = deferred<{ value: number; patch: ExtraContentPatch }>();
    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'REQUESTED',
      produce: () => work.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobStatus).toBe('RUNNING'));
    row.primarySourceRevision = 5;

    work.resolve({ value: 1, patch: patch('Now stale') });
    await expect(attempt).resolves.toEqual({ kind: 'superseded' });

    expect(row).toMatchObject({
      primarySourceRevision: 5,
      extraContentJobStatus: 'PENDING',
      extraContentJobRunId: null,
      extraContentTranscript: null,
    });
  });

  it('cannot publish a late AI result after a human edit revokes its run ID', async () => {
    const work = deferred<{ value: number; patch: ExtraContentPatch }>();
    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: () => work.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobStatus).toBe('RUNNING'));

    Object.assign(row, {
      extraContentTranscript: 'Human-authored content',
      extraContentStatus: 'EDITED',
      ...buildHumanExtraContentJobPatch(),
    });

    work.resolve({ value: 1, patch: patch('Stale AI content') });
    await expect(attempt).resolves.toEqual({ kind: 'superseded' });

    expect(row).toMatchObject({
      extraContentTranscript: 'Human-authored content',
      extraContentStatus: 'EDITED',
      extraContentJobStatus: 'SUCCESS',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
    });
  });

  it('prevents an old cancelled attempt from publishing into a retried run', async () => {
    const firstWork = deferred<{ value: string; patch: ExtraContentPatch }>();
    const secondWork = deferred<{ value: string; patch: ExtraContentPatch }>();
    randomUUIDMock.mockReturnValueOnce('run-a').mockReturnValueOnce('run-b');

    const firstAttempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: () => firstWork.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobRunId).toBe('run-a'));

    row.extraContentJobStatus = 'FAILED';
    row.extraContentJobRunId = null;
    row.extraContentJobStatus = 'PENDING';

    const secondAttempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: () => secondWork.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobRunId).toBe('run-b'));

    firstWork.resolve({ value: 'old', patch: patch('Old content') });
    await expect(firstAttempt).resolves.toEqual({ kind: 'superseded' });
    expect(row).toMatchObject({
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'run-b',
      extraContentTranscript: null,
    });

    secondWork.resolve({ value: 'new', patch: patch('New content') });
    await expect(secondAttempt).resolves.toEqual({ kind: 'completed', value: 'new' });
    expect(row).toMatchObject({
      extraContentJobStatus: 'SUCCESS',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentTranscript: 'New content',
    });
  });

  it('claims with a database-clock lease, explicit kind, and no visible heartbeat timestamp', async () => {
    const visibleUpdatedAt = row.updatedAt;
    let release!: () => void;
    const work = new Promise<{ value: number; patch: ExtraContentPatch }>((resolve) => {
      release = () => resolve({ value: 1, patch: patch('Leased content') });
    });

    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'REQUESTED',
      produce: () => work,
    });

    await vi.waitFor(() => expect(row.extraContentJobRunId).toBe('run-a'));
    expect(row).toMatchObject({
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'run-a',
      extraContentJobLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      extraContentJobLeaseRunId: 'run-a',
      extraContentJobClaimKind: 'REQUESTED',
    });
    expect(row.updatedAt).not.toBe(visibleUpdatedAt);
    const claimedUpdatedAt = row.updatedAt;

    databaseNow = new Date('2026-07-17T12:00:30.000Z');
    await expect(renewExtraContentLease(row.id, 'run-a')).resolves.toBe(true);
    expect(row.extraContentJobLeaseExpiresAt).toEqual(
      new Date('2026-07-17T12:05:30.000Z'),
    );
    expect(row.updatedAt).toBe(claimedUpdatedAt);

    release();
    await expect(attempt).resolves.toEqual({ kind: 'completed', value: 1 });
  });

  it('overwrites bound stale lease metadata on a new claim', async () => {
    row.extraContentJobStatus = 'SUCCESS';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T11:00:00.000Z');
    row.extraContentJobLeaseRunId = 'stale-run';
    row.extraContentJobClaimKind = 'REQUESTED';

    await expect(runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'SUCCESS',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: async () => ({ value: 1, patch: patch('Replacement') }),
    })).resolves.toEqual({ kind: 'completed', value: 1 });

    expect(row).toMatchObject({
      extraContentJobStatus: 'SUCCESS',
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentTranscript: 'Replacement',
    });
  });

  it('ignores stale lease metadata inherited by an old-style replacement run', async () => {
    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'replacement-run';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T12:00:00.000Z');
    row.extraContentJobLeaseRunId = 'previous-run';
    row.extraContentJobClaimKind = 'REQUESTED';

    await expect(recoverExpiredExtraContentJobs()).resolves.toEqual({
      requeued: [],
      failed: [],
    });
    expect(row).toMatchObject({
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'replacement-run',
      extraContentJobLeaseRunId: 'previous-run',
    });

    await expect(cancelExtraContentAttempt(row.id, 'replacement-run')).resolves.toBe(true);
    expect(row.extraContentJobStatus).toBe('FAILED');
  });

  it('requires a live clean lease for publication but permits exact-run cancellation', async () => {
    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'run-a';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T11:59:59.000Z');
    row.extraContentJobLeaseRunId = 'run-a';
    row.extraContentJobClaimKind = 'REQUESTED';

    await expect(renewExtraContentLease(row.id, 'run-a')).resolves.toBe(false);
    await expect(cancelExtraContentAttempt(row.id, 'run-a')).resolves.toBe(true);

    expect(row).toMatchObject({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: 'Cancelled by admin',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
    });
  });

  it('requeues an exact dirty cancellation even after lease expiry', async () => {
    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'run-a';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T11:59:59.000Z');
    row.extraContentJobLeaseRunId = 'run-a';
    row.extraContentJobClaimKind = 'REQUESTED';
    row.extraContentJobDirty = true;

    await expect(cancelExtraContentAttempt(row.id, 'run-a')).resolves.toBe(true);

    expect(row).toMatchObject({
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
    });
  });

  it('ignores legacy unleased attempts during recovery but keeps them cancellable', async () => {
    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'legacy-run';

    await expect(recoverExpiredExtraContentJobs()).resolves.toEqual({
      requeued: [],
      failed: [],
    });
    expect(row.extraContentJobStatus).toBe('RUNNING');

    await expect(cancelExtraContentAttempt(row.id, 'legacy-run')).resolves.toBe(true);
    expect(row.extraContentJobStatus).toBe('FAILED');
  });

  it('recovers dirty and queued expiry to PENDING, but fails clean requested expiry', async () => {
    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'run-a';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T12:00:00.000Z');
    row.extraContentJobLeaseRunId = 'run-a';
    row.extraContentJobClaimKind = 'QUEUED';
    row.extraContentTranscript = 'Existing content';

    await expect(recoverExpiredExtraContentJobs()).resolves.toEqual({
      requeued: [{ id: row.id, dateRaw: row.dateRaw }],
      failed: [],
    });
    expect(row).toMatchObject({
      extraContentJobStatus: 'PENDING',
      extraContentTranscript: 'Existing content',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
    });

    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'run-b';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T12:00:00.000Z');
    row.extraContentJobLeaseRunId = 'run-b';
    row.extraContentJobClaimKind = 'REQUESTED';
    row.extraContentJobDirty = false;

    await expect(recoverExpiredExtraContentJobs()).resolves.toEqual({
      requeued: [],
      failed: [{ id: row.id, dateRaw: row.dateRaw }],
    });
    expect(row).toMatchObject({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: 'Extra-content lease expired before the attempt completed',
      extraContentTranscript: 'Existing content',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
    });

    row.extraContentJobStatus = 'RUNNING';
    row.extraContentJobRunId = 'run-c';
    row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T12:00:00.000Z');
    row.extraContentJobLeaseRunId = 'run-c';
    row.extraContentJobClaimKind = 'REQUESTED';
    row.extraContentJobDirty = true;

    await expect(recoverExpiredExtraContentJobs()).resolves.toEqual({
      requeued: [{ id: row.id, dateRaw: row.dateRaw }],
      failed: [],
    });
    expect(row.extraContentJobStatus).toBe('PENDING');
  });

  it('heartbeats immediately, serializes slow renewal, and stops on ownership loss', async () => {
    vi.useFakeTimers();
    try {
      row.extraContentJobStatus = 'RUNNING';
      row.extraContentJobRunId = 'run-a';
      row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
      row.extraContentJobLeaseRunId = 'run-a';
      row.extraContentJobClaimKind = 'QUEUED';

      let releaseRenewal!: () => void;
      returningBarrier = new Promise<void>((resolve) => {
        releaseRenewal = resolve;
      });
      let finishOperation!: () => void;
      const operationDone = new Promise<void>((resolve) => {
        finishOperation = resolve;
      });
      let heartbeat: { hasOwnership(): boolean } | undefined;

      const running = withExtraContentHeartbeat(row.id, 'run-a', async (activeHeartbeat) => {
        heartbeat = activeHeartbeat;
        await operationDone;
      });

      await vi.advanceTimersByTimeAsync(90_000);
      expect(dbUpdateMock).toHaveBeenCalledTimes(1);

      releaseRenewal();
      await vi.advanceTimersByTimeAsync(0);
      row.extraContentJobRunId = 'replacement-run';
      await vi.advanceTimersByTimeAsync(30_000);
      expect(heartbeat?.hasOwnership()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      finishOperation();
      await running;
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries heartbeat database errors without manufacturing ownership loss', async () => {
    vi.useFakeTimers();
    try {
      row.extraContentJobStatus = 'RUNNING';
      row.extraContentJobRunId = 'run-a';
      row.extraContentJobLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
      row.extraContentJobLeaseRunId = 'run-a';
      row.extraContentJobClaimKind = 'QUEUED';
      returningError = new Error('database unavailable');

      let finishOperation!: () => void;
      const operationDone = new Promise<void>((resolve) => {
        finishOperation = resolve;
      });
      let heartbeat: { hasOwnership(): boolean } | undefined;
      const running = withExtraContentHeartbeat(row.id, 'run-a', async (activeHeartbeat) => {
        heartbeat = activeHeartbeat;
        await operationDone;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({ letterId: row.id, runId: 'run-a' }),
        'Failed to renew extra-content lease; will retry',
      );
      expect(heartbeat?.hasOwnership()).toBe(true);

      finishOperation();
      await running;
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops stale production and requeues when a heartbeat observes dirty source', async () => {
    vi.useFakeTimers();
    try {
      const work = deferred<{ value: number; patch: ExtraContentPatch }>();
      const attempt = runExtraContentJob({
        letterId: row.id,
        expectedPrimarySourceRevision: row.primarySourceRevision,
        expectedStatus: 'PENDING',
        expectedUpdatedAt: row.updatedAt,
        claimKind: 'QUEUED',
        produce: () => work.promise,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(row.extraContentJobStatus).toBe('RUNNING');
      row.extraContentJobDirty = true;
      await vi.advanceTimersByTimeAsync(30_000);

      work.resolve({ value: 1, patch: patch('Stale content') });
      await expect(attempt).resolves.toEqual({ kind: 'superseded' });
      expect(row).toMatchObject({
        extraContentJobStatus: 'PENDING',
        extraContentJobRunId: null,
        extraContentJobLeaseExpiresAt: null,
        extraContentJobLeaseRunId: null,
        extraContentJobClaimKind: null,
        extraContentJobDirty: false,
        extraContentTranscript: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets only one reconciler recover an expired run and fences its late producer', async () => {
    const work = deferred<{ value: number; patch: ExtraContentPatch }>();
    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedPrimarySourceRevision: row.primarySourceRevision,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      claimKind: 'QUEUED',
      produce: () => work.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobStatus).toBe('RUNNING'));

    databaseNow = new Date('2026-07-17T12:05:00.000Z');
    const recovered = await Promise.all([
      recoverExpiredExtraContentJobs(),
      recoverExpiredExtraContentJobs(),
    ]);
    expect(recovered.flatMap(result => result.requeued)).toEqual([
      { id: row.id, dateRaw: row.dateRaw },
    ]);

    work.resolve({ value: 1, patch: patch('Late content') });
    await expect(attempt).resolves.toEqual({ kind: 'superseded' });
    expect(row).toMatchObject({
      extraContentJobStatus: 'PENDING',
      extraContentTranscript: null,
    });
  });
});
