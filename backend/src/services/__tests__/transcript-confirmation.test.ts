import { beforeEach, describe, expect, it, vi } from 'vitest';

const { randomUUIDMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: randomUUIDMock };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({
    kind: 'eq',
    field,
    value,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  const fields = (prefix: string, names: string[]) =>
    Object.fromEntries(names.map(name => [name, `${prefix}.${name}`]));

  return {
    db: { transaction: vi.fn() },
    collections: fields('collections', ['id', 'collectionCode']),
    letters: fields('letters', [
      'id',
      'collectionId',
      'type',
      'dateRaw',
      'letterDate',
      'workflow',
      'primarySourceRevision',
      'transcriptionStatus',
      'transcriptionText',
      'transcriptConfirmedAt',
      'transcriptConfirmedBy',
      'transcriptConfirmationId',
      'transcriptConfirmationIntentHash',
      'transcriptConfirmationSourceRevision',
      'transcriptConfirmationTranscriptDigest',
      'extraContentTranscript',
      'extraContentStatus',
      'extraContentJobStatus',
      'metadataStatus',
      'metadataRevision',
      'entityExtractionStatus',
    ]),
  };
});

import {
  confirmationIntentIdentity,
  metadataInputIdentity,
  transcriptDigest,
} from '../letter/metadata-input-identity.js';
import {
  confirmTranscriptIntent,
  LEGACY_TRANSCRIPT_CONFIRMATION_ERROR_CODE,
  TRANSCRIPT_CONFIRMATION_INTENT_CHANGED_ERROR_CODE,
  TRANSCRIPT_DIGEST_CHANGED_ERROR_CODE,
} from '../letter/transcript-confirmation.js';

type Status = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

interface ConfirmationRow {
  id: string;
  type: 'L' | 'T';
  collectionCode: string;
  dateRaw: string;
  letterDate: string | null;
  workflow: 'TRANSCRIBED' | 'METADATA_EXTRACTING' | 'METADATA_DRAFTED';
  primarySourceRevision: number;
  transcriptionStatus: Status;
  transcriptionText: string | null;
  transcriptConfirmedAt: Date | null;
  transcriptConfirmedBy: string | null;
  transcriptConfirmationId: string | null;
  transcriptConfirmationIntentHash: string | null;
  transcriptConfirmationSourceRevision: number | null;
  transcriptConfirmationTranscriptDigest: string | null;
  extraContentTranscript: string | null;
  extraContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  extraContentJobStatus: Status;
  metadataStatus: Status;
  entityExtractionStatus: Status;
  [key: string]: unknown;
}

const confirmationId = 'e9db47b6-6bd5-47f2-b573-57e57aeb98f6';
let row: ConfirmationRow;
let updatePatches: Array<Record<string, unknown>>;
let transactionCount: number;

function fakeDatabase() {
  const tx = {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            for: async () => [row],
          }),
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        updatePatches.push(patch);
        return {
          where: async () => {
            Object.assign(row, patch);
            return [];
          },
        };
      },
    })),
  };

  return {
    transaction: async <T>(operation: (database: typeof tx) => Promise<T>) => {
      transactionCount += 1;
      return operation(tx);
    },
  };
}

function confirmationInput(
  guidance: { confirmedSender?: string; confirmedRecipient?: string } = {},
) {
  return {
    letterId: row.id,
    expectedPrimarySourceRevision: row.primarySourceRevision,
    expectedTranscriptDigest: transcriptDigest(row.transcriptionText ?? ''),
    confirmedBy: 'reviewer@example.test',
    guidance,
  };
}

describe('transcript confirmation persistence boundary', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset();
    randomUUIDMock.mockReturnValue(confirmationId);
    updatePatches = [];
    transactionCount = 0;
    row = {
      id: 'letter-1',
      type: 'L',
      collectionCode: '009',
      dateRaw: '19470810',
      letterDate: '1947-08-10',
      workflow: 'TRANSCRIBED',
      primarySourceRevision: 7,
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Dear Bob,\nHello.',
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptConfirmationId: null,
      transcriptConfirmationIntentHash: null,
      transcriptConfirmationSourceRevision: null,
      transcriptConfirmationTranscriptDigest: null,
      extraContentTranscript: 'Envelope addressed to Bob.',
      extraContentStatus: 'AI_DRAFT',
      extraContentJobStatus: 'SUCCESS',
      metadataStatus: 'FAILED',
      entityExtractionStatus: 'FAILED',
    };
  });

  it('atomically confirms and queues the exact source with one durable receipt', async () => {
    const input = confirmationInput({
      confirmedSender: ' Alice ',
      confirmedRecipient: 'Bob',
    });
    const result = await confirmTranscriptIntent(
      input,
      fakeDatabase() as never,
    );

    expect(transactionCount).toBe(1);
    expect(updatePatches).toHaveLength(1);
    expect(updatePatches[0]).toMatchObject({
      transcriptConfirmedAt: expect.any(Date),
      transcriptConfirmedBy: 'reviewer@example.test',
      transcriptConfirmationId: confirmationId,
      transcriptConfirmationSourceRevision: 7,
      transcriptConfirmationTranscriptDigest: input.expectedTranscriptDigest,
      metadataConfirmationGuidance: {
        version: 1,
        confirmationId,
        metadataInputIdentity: expect.stringMatching(/^v1\.[0-9a-f]{64}$/),
        confirmedSender: 'Alice',
        confirmedRecipient: 'Bob',
      },
      metadataGuidanceRunId: null,
      metadataStatus: 'PENDING',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataError: null,
      metadataAttemptCount: 0,
      deadLetter: false,
      entityExtractionStatus: 'PENDING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: null,
      workflow: 'TRANSCRIBED',
    });
    expect(result).toMatchObject({
      newlyQueued: true,
      receipt: {
        confirmationId,
        confirmedBy: 'reviewer@example.test',
        transcriptSource: {
          primarySourceRevision: 7,
          transcriptDigest: input.expectedTranscriptDigest,
        },
        metadataInputIdentity:
          updatePatches[0]?.metadataConfirmationGuidance
            && (
              updatePatches[0].metadataConfirmationGuidance as {
                metadataInputIdentity: string;
              }
            ).metadataInputIdentity,
        intentIdentity: updatePatches[0]?.transcriptConfirmationIntentHash,
        metadataDisposition: 'queued',
      },
    });
  });

  it.each([
    ['source revision', { expectedPrimarySourceRevision: 6 }, 'SOURCE_REVISION_CHANGED'],
    ['transcript digest', { expectedTranscriptDigest: '0'.repeat(64) }, TRANSCRIPT_DIGEST_CHANGED_ERROR_CODE],
  ])('rejects a stale %s without updating', async (_label, override, code) => {
    const promise = confirmTranscriptIntent(
      { ...confirmationInput(), ...override },
      fakeDatabase() as never,
    );

    await expect(promise).rejects.toMatchObject({ statusCode: 409, code });
    expect(updatePatches).toHaveLength(0);
  });

  it.each([
    ['PENDING', 'queued'],
    ['RUNNING', 'already_running'],
    ['SUCCESS', 'already_available'],
    ['FAILED', 'failed'],
  ] as const)(
    'replays %s metadata with the same ID and %s disposition without resetting work',
    async (metadataStatus, metadataDisposition) => {
      const database = fakeDatabase();
      const input = confirmationInput({ confirmedSender: 'Alice' });
      const first = await confirmTranscriptIntent(input, database as never);
      row.metadataStatus = metadataStatus;
      row.workflow = metadataStatus === 'RUNNING'
        ? 'METADATA_EXTRACTING'
        : 'TRANSCRIBED';
      const second = await confirmTranscriptIntent(input, database as never);

      expect(first.receipt.confirmationId).toBe(confirmationId);
      expect(second).toEqual({
        newlyQueued: false,
        receipt: {
          ...first.receipt,
          metadataDisposition,
        },
      });
      expect(updatePatches).toHaveLength(1);
      expect(row.metadataStatus).toBe(metadataStatus);
    },
  );

  it('conflicts on different guidance without replacing the accepted intent', async () => {
    const database = fakeDatabase();
    await confirmTranscriptIntent(
      confirmationInput({ confirmedSender: 'Alice' }),
      database as never,
    );
    const acceptedHash = row.transcriptConfirmationIntentHash;
    const acceptedGuidance = row.metadataConfirmationGuidance;

    await expect(confirmTranscriptIntent(
      confirmationInput({ confirmedSender: 'Carol' }),
      database as never,
    )).rejects.toMatchObject({
      statusCode: 409,
      code: TRANSCRIPT_CONFIRMATION_INTENT_CHANGED_ERROR_CODE,
    });
    expect(updatePatches).toHaveLength(1);
    expect(row.transcriptConfirmationIntentHash).toBe(acceptedHash);
    expect(row.metadataConfirmationGuidance).toBe(acceptedGuidance);
  });

  it('replays current input identity and disposition after context invalidation', async () => {
    const database = fakeDatabase();
    const input = confirmationInput({ confirmedSender: 'Alice' });
    const first = await confirmTranscriptIntent(input, database as never);

    row.extraContentTranscript = 'A newly corrected envelope.';
    row.extraContentStatus = 'EDITED';
    row.metadataStatus = 'PENDING';
    row.workflow = 'TRANSCRIBED';
    const second = await confirmTranscriptIntent(input, database as never);

    expect(second.newlyQueued).toBe(false);
    expect(second.receipt).toMatchObject({
      confirmationId,
      metadataDisposition: 'queued',
    });
    expect(second.receipt.metadataInputIdentity).not.toBe(
      first.receipt.metadataInputIdentity,
    );
    expect(second.receipt.metadataInputIdentity).toBe(metadataInputIdentity({
      letterId: row.id,
      transcriptionText: row.transcriptionText ?? '',
      collectionCode: row.collectionCode,
      dateRaw: row.dateRaw,
      letterDate: row.letterDate,
      extraContentTranscript: row.extraContentTranscript,
      extraContentStatus: row.extraContentStatus,
      extraContentJobStatus: row.extraContentJobStatus,
    }));
    expect(updatePatches).toHaveLength(1);
  });

  it('confirms non-letter content without creating metadata work', async () => {
    row.type = 'T';

    const result = await confirmTranscriptIntent(
      confirmationInput({ confirmedSender: 'Alice' }),
      fakeDatabase() as never,
    );

    expect(result).toMatchObject({
      newlyQueued: false,
      receipt: {
        confirmationId,
        metadataInputIdentity: null,
        metadataDisposition: 'not_applicable',
      },
    });
    expect(updatePatches[0]).toMatchObject({
      transcriptConfirmationId: confirmationId,
      metadataConfirmationGuidance: null,
      metadataGuidanceRunId: null,
    });
    expect(updatePatches[0]).not.toHaveProperty('metadataStatus');
  });

  it('rejects an unidentifiable legacy confirmation without updating', async () => {
    row.transcriptConfirmedAt = new Date('2026-07-25T12:00:00.000Z');
    row.transcriptConfirmedBy = 'legacy-reviewer';

    await expect(confirmTranscriptIntent(
      confirmationInput(),
      fakeDatabase() as never,
    )).rejects.toMatchObject({
      statusCode: 409,
      code: LEGACY_TRANSCRIPT_CONFIRMATION_ERROR_CODE,
    });
    expect(updatePatches).toHaveLength(0);
  });

  it('uses the canonical intent identity stored in the receipt', async () => {
    const input = confirmationInput({ confirmedRecipient: 'Bob' });
    const result = await confirmTranscriptIntent(
      input,
      fakeDatabase() as never,
    );

    expect(result.receipt.intentIdentity).toBe(confirmationIntentIdentity({
      letterId: row.id,
      primarySourceRevision: 7,
      transcriptDigest: input.expectedTranscriptDigest,
      guidance: { confirmedRecipient: 'Bob' },
    }));
  });
});
