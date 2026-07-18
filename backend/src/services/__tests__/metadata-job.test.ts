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
  gt: vi.fn((field: unknown, value: unknown) => ({ kind: 'gt', field, value })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => ({
  db: { update: dbUpdateMock },
  letters: {
    id: 'letters.id',
    dateRaw: 'letters.dateRaw',
    type: 'letters.type',
    workflow: 'letters.workflow',
    transcriptionStatus: 'letters.transcriptionStatus',
    transcriptionText: 'letters.transcriptionText',
    transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
    extraContentTranscript: 'letters.extraContentTranscript',
    extraContentJobStatus: 'letters.extraContentJobStatus',
    extraContentJobRunId: 'letters.extraContentJobRunId',
    metadataStatus: 'letters.metadataStatus',
    metadataRevision: 'letters.metadataRevision',
    metadataRunId: 'letters.metadataRunId',
    metadataRunRevision: 'letters.metadataRunRevision',
    metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
    metadataLeaseRunId: 'letters.metadataLeaseRunId',
    metadataClaimKind: 'letters.metadataClaimKind',
    metadataError: 'letters.metadataError',
    metadataContentStatus: 'letters.metadataContentStatus',
    metadataVerifiedAt: 'letters.metadataVerifiedAt',
    metadataVerifiedBy: 'letters.metadataVerifiedBy',
    entityExtractionStatus: 'letters.entityExtractionStatus',
    entityExtractionError: 'letters.entityExtractionError',
    deadLetter: 'letters.deadLetter',
    updatedAt: 'letters.updatedAt',
  },
}));

import {
  buildHumanMetadataJobPatch,
  buildHumanMetadataNotesPatch,
  cancelMetadataAttempt,
  claimMetadataAfterTranscriptConfirmation,
  claimQueuedMetadata,
  claimRequestedMetadata,
  completeMetadata,
  failMetadata,
  observeMetadataState,
  recoverExpiredMetadataJobs,
  renewMetadataLease,
} from '../letter/metadata-job.js';

type Status = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

interface MetadataRow {
  id: string;
  dateRaw: string;
  type: 'L' | 'P';
  workflow: 'UPLOADED' | 'TRANSCRIBED' | 'METADATA_EXTRACTING' | 'METADATA_DRAFTED' | 'REVIEWED';
  transcriptionStatus: Status;
  transcriptionText: string | null;
  transcriptConfirmedAt: Date | null;
  transcriptConfirmedBy: string | null;
  extraContentTranscript: string | null;
  extraContentJobStatus: Status;
  extraContentJobRunId: string | null;
  metadataStatus: Status;
  metadataRevision: number;
  metadataRunId: string | null;
  metadataRunRevision: number | null;
  metadataLeaseExpiresAt: Date | null;
  metadataLeaseRunId: string | null;
  metadataClaimKind: 'QUEUED' | 'REQUESTED' | null;
  metadataError: string | null;
  metadataAttemptCount: number;
  metadataContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  metadataVerifiedAt: Date | null;
  metadataVerifiedBy: string | null;
  entityExtractionStatus: Status;
  entityExtractionError: string | null;
  entityExtractionJson: unknown;
  deadLetter: boolean;
  metadataPublished: boolean;
  sender: string | null;
  recipient: string | null;
  locationWritten: string | null;
  hook: string | null;
  summary: string | null;
  extractedDate: string | null;
  tags: string[] | null;
  emotionalTone: string | null;
  senderRecipientRelationship: string | null;
  primaryTopics: string[] | null;
  aiNotes: unknown;
  metadataJson: unknown;
  metadataV2Json: unknown;
  updatedAt: Date;
}

let row: MetadataRow;
let databaseTime: Date;

function equalValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function matches(condition: unknown): boolean {
  const clause = condition as {
    kind: 'and' | 'eq' | 'gt' | 'isNotNull' | 'isNull' | 'lte' | 'sql';
    clauses?: unknown[];
    field?: string;
    value?: unknown;
    strings?: string[];
    values?: unknown[];
  };
  if (clause.kind === 'and') return clause.clauses?.every(matches) ?? false;
  if (!clause.field) return false;
  const key = clause.field.slice('letters.'.length) as keyof MetadataRow;
  if (clause.kind === 'isNull') return row[key] === null;
  if (clause.kind === 'isNotNull') return row[key] !== null;
  if (clause.kind === 'gt' || clause.kind === 'lte') {
    const actual = row[key];
    if (!(actual instanceof Date)) return false;
    const expected = clause.value as { kind?: string; strings?: string[] };
    if (expected?.kind !== 'sql') return false;
    return clause.kind === 'gt'
      ? actual.getTime() > databaseTime.getTime()
      : actual.getTime() <= databaseTime.getTime();
  }
  const expected = typeof clause.value === 'string' && clause.value.startsWith('letters.')
    ? row[clause.value.slice('letters.'.length) as keyof MetadataRow]
    : clause.value;
  return equalValue(row[key], expected);
}

function installStatefulDatabase() {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation((updates: Partial<MetadataRow>) => ({
    where: (condition: unknown) => ({
      returning: async (projection?: Record<string, string>) => {
        if (!matches(condition)) return [];
        const statementTime = new Date(databaseTime);
        for (const [key, value] of Object.entries(updates)) {
          if (
            key === 'metadataRevision'
            && typeof value === 'object'
            && value !== null
            && 'kind' in value
            && value.kind === 'sql'
          ) {
            row.metadataRevision += 1;
          } else if (
            key === 'metadataLeaseExpiresAt'
            && typeof value === 'object'
            && value !== null
            && 'kind' in value
            && value.kind === 'sql'
          ) {
            row.metadataLeaseExpiresAt = new Date(statementTime.getTime() + 5 * 60_000);
          } else if (
            key === 'workflow'
            && typeof value === 'object'
            && value !== null
            && 'kind' in value
            && value.kind === 'sql'
          ) {
            row.workflow = row.metadataContentStatus === 'VERIFIED'
              ? 'REVIEWED'
              : row.metadataContentStatus === 'EMPTY'
                ? 'TRANSCRIBED'
                : 'METADATA_DRAFTED';
          } else {
            Object.assign(row, { [key]: value });
          }
        }
        if (!projection) return [{ id: row.id }];
        return [Object.fromEntries(
          Object.entries(projection).map(([alias, field]) => [
            alias,
            row[field.slice('letters.'.length) as keyof MetadataRow],
          ]),
        )];
      },
    }),
  }));
}

const metadata = {
  sender: 'Alice',
  recipient: 'Bob',
  location_written: 'Boston',
  hook: 'A «SENDER:private» hook',
  summary: 'A concise summary',
  extracted_date: '1944-01-02',
  emotional_tone: 'hopeful',
  sender_recipient_relationship: 'friends',
  primary_topics: ['family'],
  notable_quotes: [],
  ai_notes: [],
} as never;

describe('metadata job lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = {
      id: 'letter-1',
      dateRaw: '19440102',
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Dear Bob',
      transcriptConfirmedAt: new Date('2026-07-17T12:00:00.000Z'),
      transcriptConfirmedBy: 'admin',
      extraContentTranscript: null,
      extraContentJobStatus: 'SUCCESS',
      extraContentJobRunId: null,
      metadataStatus: 'PENDING',
      metadataRevision: 0,
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataError: null,
      metadataAttemptCount: 0,
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      entityExtractionJson: null,
      deadLetter: false,
      metadataPublished: false,
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      tags: null,
      emotionalTone: null,
      senderRecipientRelationship: null,
      primaryTopics: null,
      aiNotes: null,
      metadataJson: null,
      metadataV2Json: null,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    databaseTime = new Date('2026-07-17T12:00:00.000Z');
    randomUUIDMock.mockReturnValue('run-a');
    installStatefulDatabase();
  });

  it('claims queued and requested work from the exact eligible source revision', async () => {
    row.entityExtractionStatus = 'FAILED';
    row.entityExtractionError = 'Older entities are stale';
    const observed = observeMetadataState(row);

    await expect(claimQueuedMetadata(row.id, observed)).resolves.toEqual({
      runId: 'run-a',
      revision: 0,
    });
    expect(row).toMatchObject({
      workflow: 'METADATA_EXTRACTING',
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-a',
      metadataRunRevision: 0,
      metadataLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      metadataLeaseRunId: 'run-a',
      metadataClaimKind: 'QUEUED',
      transcriptionText: 'Dear Bob',
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
    });

    row.metadataStatus = 'SUCCESS';
    row.metadataRunId = null;
    row.metadataRunRevision = null;
    row.metadataLeaseExpiresAt = null;
    row.metadataLeaseRunId = null;
    row.metadataClaimKind = null;
    row.workflow = 'METADATA_DRAFTED';
    row.sender = 'Existing sender';
    row.metadataContentStatus = 'VERIFIED';
    randomUUIDMock.mockReturnValue('run-b');

    await expect(
      claimRequestedMetadata(row.id, observeMetadataState(row)),
    ).resolves.toEqual({ runId: 'run-b', revision: 0 });
    expect(row).toMatchObject({
      workflow: 'METADATA_EXTRACTING',
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-b',
      metadataLeaseRunId: 'run-b',
      metadataClaimKind: 'REQUESTED',
      sender: 'Existing sender',
      metadataContentStatus: 'VERIFIED',
      entityExtractionStatus: 'PENDING',
    });
  });

  it('refuses stale, invalid-type, missing-input, and cross-stage claims', async () => {
    const stale = observeMetadataState(row);
    row.transcriptionText = 'A newer transcript';
    await expect(claimQueuedMetadata(row.id, stale)).resolves.toBeNull();

    row.type = 'P';
    await expect(claimRequestedMetadata(row.id, observeMetadataState(row))).resolves.toBeNull();
    row.type = 'L';
    row.transcriptionText = null;
    await expect(claimRequestedMetadata(row.id, observeMetadataState(row))).resolves.toBeNull();
    row.transcriptionText = 'Dear Bob';
    row.entityExtractionStatus = 'RUNNING';
    await expect(claimQueuedMetadata(row.id, observeMetadataState(row))).resolves.toBeNull();

    expect(row.metadataStatus).toBe('PENDING');
    expect(row.metadataRunId).toBeNull();
  });

  it('confirms the exact transcript revision in the same write that claims metadata', async () => {
    row.transcriptConfirmedAt = null;
    row.transcriptConfirmedBy = null;

    await expect(
      claimMetadataAfterTranscriptConfirmation(
        row.id,
        observeMetadataState(row),
        'reviewer-1',
      ),
    ).resolves.toEqual({ runId: 'run-a', revision: 0 });

    expect(row).toMatchObject({
      transcriptConfirmedAt: expect.any(Date),
      transcriptConfirmedBy: 'reviewer-1',
      workflow: 'METADATA_EXTRACTING',
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-a',
      metadataClaimKind: 'QUEUED',
    });
  });

  it('publishes one exact run atomically and cannot overwrite its replacement', async () => {
    await claimQueuedMetadata(row.id, observeMetadataState(row));

    await expect(
      completeMetadata(row.id, { runId: 'run-a', revision: 0 }, metadata),
    ).resolves.toBe(true);
    expect(row).toMatchObject({
      workflow: 'METADATA_DRAFTED',
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataError: null,
      metadataContentStatus: 'AI_DRAFT',
      sender: 'Alice',
      recipient: 'Bob',
      locationWritten: 'Boston',
      hook: 'A private hook',
      summary: 'A concise summary',
      tags: ['family'],
      metadataV2Json: metadata,
    });

    row.metadataStatus = 'RUNNING';
    row.metadataRunId = 'run-b';
    row.metadataRunRevision = 1;
    row.metadataLeaseRunId = 'run-b';
    row.metadataLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
    row.metadataClaimKind = 'QUEUED';
    row.sender = 'Newer result';
    await expect(
      completeMetadata(row.id, { runId: 'run-a', revision: 0 }, metadata),
    ).resolves.toBe(false);
    expect(row).toMatchObject({
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-b',
      sender: 'Newer result',
    });
  });

  it('records failure and cancellation only for the exact active run', async () => {
    await claimQueuedMetadata(row.id, observeMetadataState(row));
    row.sender = 'Committed content';

    await expect(
      failMetadata(row.id, { runId: 'wrong-run', revision: 0 }, 'late failure'),
    ).resolves.toBe(false);
    expect(row.metadataStatus).toBe('RUNNING');

    await expect(
      failMetadata(row.id, { runId: 'run-a', revision: 0 }, 'provider failed'),
    ).resolves.toBe(true);
    expect(row).toMatchObject({
      metadataStatus: 'FAILED',
      metadataRevision: 1,
      metadataRunId: null,
      metadataError: 'provider failed',
      sender: 'Committed content',
      workflow: 'TRANSCRIBED',
    });

    row.metadataStatus = 'SUCCESS';
    row.metadataContentStatus = 'VERIFIED';
    row.workflow = 'REVIEWED';
    randomUUIDMock.mockReturnValue('run-b');
    await claimRequestedMetadata(row.id, observeMetadataState(row));
    await expect(cancelMetadataAttempt(row.id, 'run-a')).resolves.toBe(false);
    expect(row.metadataRunId).toBe('run-b');
    await expect(cancelMetadataAttempt(row.id, 'run-b')).resolves.toBe(true);
    expect(row).toMatchObject({
      workflow: 'REVIEWED',
      metadataStatus: 'FAILED',
      metadataRevision: 2,
      metadataRunId: null,
      metadataError: 'Cancelled by admin',
    });
  });

  it('keeps a partial human edit pending when it revokes an active replacement', async () => {
    row.metadataContentStatus = 'AI_DRAFT';
    await claimQueuedMetadata(row.id, observeMetadataState(row));
    const humanPatch = buildHumanMetadataJobPatch();
    expect(humanPatch).toMatchObject({
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
    });
    expect(
      (humanPatch.metadataStatus as unknown as { strings: string[] }).strings.join(''),
    ).not.toContain("THEN 'SUCCESS'::job_status");
    Object.assign(row, {
      sender: 'Human correction',
      metadataStatus: 'PENDING',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataError: null,
      metadataRevision: row.metadataRevision + 1,
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      workflow: 'TRANSCRIBED',
    });

    expect(row).toMatchObject({
      metadataStatus: 'PENDING',
      metadataRunId: null,
      metadataError: null,
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      workflow: 'TRANSCRIBED',
      sender: 'Human correction',
    });
    await expect(
      completeMetadata(row.id, { runId: 'run-a', revision: 0 }, metadata),
    ).resolves.toBe(false);
    expect(row.sender).toBe('Human correction');
  });

  it('keeps note-only edits separate from primary metadata review and entities', () => {
    const notesPatch = buildHumanMetadataNotesPatch();

    expect(notesPatch).toMatchObject({
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
    });
    expect(notesPatch).not.toHaveProperty('metadataContentStatus');
    expect(notesPatch).not.toHaveProperty('metadataVerifiedAt');
    expect(notesPatch).not.toHaveProperty('metadataPublished');
    expect(notesPatch).not.toHaveProperty('entityExtractionStatus');
    expect(notesPatch).not.toHaveProperty('entityExtractionJson');
  });

  it('does not let unrelated updated-at changes interfere with an exact source claim', async () => {
    const observed = observeMetadataState(row);
    row.updatedAt = new Date('2026-07-17T12:01:00.000Z');

    await expect(claimQueuedMetadata(row.id, observed)).resolves.toEqual({
      runId: 'run-a',
      revision: 0,
    });
  });

  it('requires a live exact lease for renewal, completion, and failure', async () => {
    const claim = await claimQueuedMetadata(row.id, observeMetadataState(row));
    expect(claim).toEqual({ runId: 'run-a', revision: 0 });

    databaseTime = new Date('2026-07-17T12:06:00.000Z');
    await expect(renewMetadataLease(row.id, claim!)).resolves.toBe(false);
    await expect(completeMetadata(row.id, claim!, metadata)).resolves.toBe(false);
    await expect(failMetadata(row.id, claim!, 'too late')).resolves.toBe(false);
    expect(row).toMatchObject({
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-a',
      sender: null,
    });

    row.metadataRunId = null;
    row.metadataRunRevision = null;
    row.metadataLeaseExpiresAt = null;
    row.metadataLeaseRunId = null;
    row.metadataClaimKind = null;
    row.metadataStatus = 'PENDING';
    await expect(renewMetadataLease(row.id, claim!)).resolves.toBe(false);
    expect(row.metadataRunId).toBeNull();
  });

  it('lets an administrator revoke an expired exact owner', async () => {
    await claimQueuedMetadata(row.id, observeMetadataState(row));
    databaseTime = new Date('2026-07-17T12:06:00.000Z');

    await expect(cancelMetadataAttempt(row.id, 'run-a')).resolves.toBe(true);
    expect(row).toMatchObject({
      metadataStatus: 'FAILED',
      metadataRevision: 1,
      metadataRunId: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
    });
  });

  it('requeues expired queued intent and fails expired requested intent', async () => {
    await claimQueuedMetadata(row.id, observeMetadataState(row));
    databaseTime = new Date('2026-07-17T12:06:00.000Z');

    await expect(recoverExpiredMetadataJobs()).resolves.toEqual({
      requeued: [{ id: 'letter-1', dateRaw: '19440102' }],
      failed: [],
    });
    expect(row).toMatchObject({
      metadataStatus: 'PENDING',
      metadataRevision: 1,
      workflow: 'TRANSCRIBED',
      metadataRunId: null,
    });

    row.metadataStatus = 'SUCCESS';
    row.workflow = 'REVIEWED';
    row.metadataContentStatus = 'VERIFIED';
    row.sender = 'Committed sender';
    randomUUIDMock.mockReturnValue('run-b');
    const requested = await claimRequestedMetadata(row.id, observeMetadataState(row));
    expect(requested).toEqual({ runId: 'run-b', revision: 1 });
    databaseTime = new Date('2026-07-17T12:12:00.000Z');

    await expect(recoverExpiredMetadataJobs()).resolves.toEqual({
      requeued: [],
      failed: [{ id: 'letter-1', dateRaw: '19440102' }],
    });
    expect(row).toMatchObject({
      metadataStatus: 'FAILED',
      metadataRevision: 2,
      workflow: 'REVIEWED',
      sender: 'Committed sender',
      metadataError: 'Metadata lease expired before the attempt completed',
    });
  });

  it('ignores legacy tokenless RUNNING rows and reports only one concurrent recovery winner', async () => {
    row.metadataStatus = 'RUNNING';
    row.workflow = 'METADATA_EXTRACTING';

    await expect(recoverExpiredMetadataJobs()).resolves.toEqual({
      requeued: [],
      failed: [],
    });

    row.metadataStatus = 'PENDING';
    row.workflow = 'TRANSCRIBED';
    await claimQueuedMetadata(row.id, observeMetadataState(row));
    databaseTime = new Date('2026-07-17T12:06:00.000Z');

    const [first, second] = await Promise.all([
      recoverExpiredMetadataJobs(),
      recoverExpiredMetadataJobs(),
    ]);
    expect([first, second]).toContainEqual({
      requeued: [{ id: 'letter-1', dateRaw: '19440102' }],
      failed: [],
    });
    expect([first, second]).toContainEqual({ requeued: [], failed: [] });
  });
});
