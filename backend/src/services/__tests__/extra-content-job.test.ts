import { beforeEach, describe, expect, it, vi } from 'vitest';

const { randomUUIDMock, dbUpdateMock, updateSetMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: randomUUIDMock }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../db/index.js', () => ({
  db: { update: dbUpdateMock },
  letters: {
    id: 'letters.id',
    extraContentJobStatus: 'letters.extraContentJobStatus',
    extraContentJobRunId: 'letters.extraContentJobRunId',
    extraContentJobDirty: 'letters.extraContentJobDirty',
    updatedAt: 'letters.updatedAt',
  },
}));

import {
  buildHumanExtraContentJobPatch,
  runExtraContentJob,
  type ExtraContentPatch,
} from '../letter/extra-content-job.js';

interface JobRow {
  id: string;
  extraContentJobStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  extraContentJobError: string | null;
  extraContentJobRunId: string | null;
  extraContentJobDirty: boolean;
  extraContentTranscript: string | null;
  extraContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  updatedAt: Date;
}

let row: JobRow;

function matches(condition: unknown): boolean {
  const clause = condition as {
    kind: 'and' | 'eq';
    clauses?: unknown[];
    field?: string;
    value?: unknown;
  };
  if (clause.kind === 'and') return clause.clauses?.every(matches) ?? false;
  if (clause.kind !== 'eq' || !clause.field) return false;
  const key = clause.field.slice('letters.'.length) as keyof JobRow;
  return row[key] === clause.value;
}

function installStatefulDatabase() {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation((updates: Partial<JobRow>) => ({
    where: (condition: unknown) => ({
      returning: async () => {
        if (!matches(condition)) return [];
        Object.assign(row, updates);
        return [{ id: row.id }];
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
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    randomUUIDMock.mockReturnValue('run-a');
    installStatefulDatabase();
  });

  it('does not call the producer when the compare-and-swap claim loses', async () => {
    row.extraContentJobStatus = 'RUNNING';
    const produce = vi.fn();

    const result = await runExtraContentJob({
      letterId: row.id,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
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
      expectedStatus: 'PENDING',
      expectedUpdatedAt: observedUpdatedAt,
      produce,
    });

    expect(result).toEqual({ kind: 'claim_lost' });
    expect(produce).not.toHaveBeenCalled();
  });

  it('publishes content and SUCCESS atomically for the owning run ID', async () => {
    const result = await runExtraContentJob({
      letterId: row.id,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      produce: async () => ({ value: 2, patch: patch('Fresh content') }),
    });

    expect(result).toEqual({ kind: 'completed', value: 2 });
    expect(row).toMatchObject({
      extraContentJobStatus: 'SUCCESS',
      extraContentJobRunId: null,
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
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      produce: async () => { throw failure; },
    })).rejects.toBe(failure);

    expect(row).toMatchObject({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: 'vision unavailable',
      extraContentJobRunId: null,
      extraContentTranscript: null,
    });
  });

  it('discards a result and requeues when source content changed during the run', async () => {
    const work = deferred<{ value: number; patch: ExtraContentPatch }>();
    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      produce: () => work.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobStatus).toBe('RUNNING'));
    row.extraContentJobDirty = true;

    work.resolve({ value: 1, patch: patch('Now stale') });
    await expect(attempt).resolves.toEqual({ kind: 'superseded' });

    expect(row).toMatchObject({
      extraContentJobStatus: 'PENDING',
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      extraContentTranscript: null,
    });
  });

  it('cannot publish a late AI result after a human edit revokes its run ID', async () => {
    const work = deferred<{ value: number; patch: ExtraContentPatch }>();
    const attempt = runExtraContentJob({
      letterId: row.id,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
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
      extraContentJobDirty: false,
    });
  });

  it('prevents an old cancelled attempt from publishing into a retried run', async () => {
    const firstWork = deferred<{ value: string; patch: ExtraContentPatch }>();
    const secondWork = deferred<{ value: string; patch: ExtraContentPatch }>();
    randomUUIDMock.mockReturnValueOnce('run-a').mockReturnValueOnce('run-b');

    const firstAttempt = runExtraContentJob({
      letterId: row.id,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
      produce: () => firstWork.promise,
    });
    await vi.waitFor(() => expect(row.extraContentJobRunId).toBe('run-a'));

    row.extraContentJobStatus = 'FAILED';
    row.extraContentJobRunId = null;
    row.extraContentJobStatus = 'PENDING';

    const secondAttempt = runExtraContentJob({
      letterId: row.id,
      expectedStatus: 'PENDING',
      expectedUpdatedAt: row.updatedAt,
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
      extraContentTranscript: 'New content',
    });
  });
});
