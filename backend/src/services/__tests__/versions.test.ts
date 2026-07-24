import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  selectForUpdateMock,
  letterFindFirstMock,
  versionFindFirstMock,
  versionFindManyMock,
  insertReturningMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  deleteWhereMock,
  syncLetterParticipantsFromMetadataMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  selectForUpdateMock: vi.fn(),
  letterFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  versionFindManyMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  const transactionExecutor = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: selectForUpdateMock })),
      })),
    })),
    query: {
      letters: {
        findFirst: letterFindFirstMock,
      },
      letterVersions: {
        findFirst: versionFindFirstMock,
        findMany: versionFindManyMock,
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: insertReturningMock })),
    })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    update: vi.fn(() => ({ set: updateSetMock })),
  };
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  transactionMock.mockImplementation(
    (callback: (tx: typeof transactionExecutor) => unknown) =>
      callback(transactionExecutor),
  );

  return {
    db: {
      transaction: transactionMock,
      query: {
        letterVersions: {
          findMany: versionFindManyMock,
        },
      },
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
      metadataRevision: 'letters.metadataRevision',
      updatedAt: 'letters.updatedAt',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      workflow: 'letters.workflow',
      transcriptionText: 'letters.transcriptionText',
      sender: 'letters.sender',
      recipient: 'letters.recipient',
      locationWritten: 'letters.locationWritten',
      hook: 'letters.hook',
      summary: 'letters.summary',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
    },
    letterVersions: {
      letterId: 'letterVersions.letterId',
      fieldType: 'letterVersions.fieldType',
      versionNumber: 'letterVersions.versionNumber',
      primarySourceRevision: 'letterVersions.primarySourceRevision',
      createdAt: 'letterVersions.createdAt',
    },
  };
});

vi.mock('../letters.js', () => ({
  getLetterById: vi.fn(),
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { createVersion, getVersions, restoreVersion } from '../letter/versions.js';

const currentLetter = {
  id: 'letter-1',
  primarySourceRevision: 7,
  transcriptionText: 'Saved transcript',
  sender: 'Current sender',
  recipient: 'Current recipient',
  locationWritten: 'Current location',
  hook: 'Current hook',
  summary: 'Current summary',
  transcriptionStatus: 'RUNNING',
  transcriptionRunId: 'old-run',
  transcriptStatus: 'VERIFIED',
  transcriptConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
  transcriptConfirmedBy: 'reviewer-1',
  workflow: 'TRANSCRIBING',
  metadataRevision: 3,
  metadataV2Json: null,
  metadataJson: null,
  updatedAt: new Date('2026-07-17T12:00:00.000Z'),
};

describe('source-bound letter versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectForUpdateMock.mockResolvedValue([currentLetter]);
    letterFindFirstMock.mockResolvedValue({
      primarySourceRevision: currentLetter.primarySourceRevision,
    });
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    deleteWhereMock.mockResolvedValue(undefined);
    syncLetterParticipantsFromMetadataMock.mockResolvedValue(undefined);
  });

  it('reads the source epoch and its visible versions from one repeatable-read snapshot', async () => {
    versionFindManyMock.mockResolvedValue([{
      versionNumber: 3,
      content: { text: 'Current transcript' },
      source: 'human',
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(getVersions('letter-1', 'transcript')).resolves.toEqual([{
      versionNumber: 3,
      content: { text: 'Current transcript' },
      source: 'human',
      createdAt: '2026-07-18T12:00:00.000Z',
    }]);
    expect(transactionMock).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      },
    );
    expect(versionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          {
            kind: 'eq',
            field: 'letterVersions.primarySourceRevision',
            value: 7,
          },
        ]),
      },
    }));
  });

  it('creates a version only while the locked letter still owns the expected source', async () => {
    versionFindManyMock.mockResolvedValue([{ versionNumber: 2 }]);
    insertReturningMock.mockResolvedValue([{
      versionNumber: 3,
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'transcript',
      content: 'Saved transcript',
      source: 'human',
    })).resolves.toEqual({
      kind: 'created',
      version: {
        versionNumber: 3,
        createdAt: '2026-07-18T12:00:00.000Z',
      },
    });
    expect(insertReturningMock).toHaveBeenCalledOnce();
  });

  it('does not create a version after the page source changed', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      primarySourceRevision: 8,
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'transcript',
      content: 'Stale transcript',
      source: 'human',
    })).resolves.toEqual({ kind: 'source_changed' });
    expect(versionFindManyMock).not.toHaveBeenCalled();
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('does not record a delayed same-source snapshot after authoritative content changed', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      transcriptionText: 'A newer save won',
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'transcript',
      content: 'Delayed older save',
      source: 'human',
    })).resolves.toEqual({ kind: 'content_changed' });
    expect(versionFindManyMock).not.toHaveBeenCalled();
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('matches metadata snapshots against the locked authoritative fields', async () => {
    versionFindManyMock.mockResolvedValue([{ versionNumber: 3 }]);
    insertReturningMock.mockResolvedValue([{
      versionNumber: 4,
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'metadata',
      content: {
        sender: 'Current sender',
        recipient: 'Current recipient',
        locationWritten: 'Current location',
        hook: 'Stale hook',
        summary: 'Current summary',
      },
      source: 'human',
    })).resolves.toEqual({ kind: 'content_changed' });
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('restores transcript content and revokes confirmation under the same source lock', async () => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: { text: 'Restored by an admin' },
    });

    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'restored' });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: 'Restored by an admin',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      workflow: 'TRANSCRIBED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.metadataRevision', value: 3 },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
      ]),
    }));
  });

  it('rejects both a stale request epoch and a version from an older source epoch', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      primarySourceRevision: 8,
    }]);
    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'source_changed' });
    expect(versionFindFirstMock).not.toHaveBeenCalled();

    selectForUpdateMock.mockResolvedValueOnce([currentLetter]);
    versionFindFirstMock.mockResolvedValueOnce({
      primarySourceRevision: 6,
      content: { text: 'Old scan transcript' },
    });
    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'source_changed' });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('restores metadata and its participant projection in one transaction', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      metadataJson: {
        sender: 'Previous sender',
        recipient: 'Previous recipient',
        locationWritten: 'London',
        hook: 'Previous hook',
        summary: 'Previous summary',
        preservedField: 'preserved',
      },
    }]);
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: {
        sender: 'Restored sender',
        recipient: 'Restored recipient',
        locationWritten: 'Cambridge',
        hook: 'Restored hook',
        summary: 'Restored summary',
      },
    });

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).resolves.toEqual({ kind: 'restored' });

    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      sender: 'Restored sender',
      recipient: 'Restored recipient',
      database: expect.objectContaining({
        update: expect.any(Function),
      }),
    });
    const updates = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updates).not.toHaveProperty('metadataV2Json');
    expect(updates.metadataJson).toEqual(expect.objectContaining({
      sender: 'Restored sender',
      recipient: 'Restored recipient',
      locationWritten: 'Cambridge',
      hook: 'Restored hook',
      summary: 'Restored summary',
      preservedField: 'preserved',
    }));
  });

  it('does not report a metadata restore when participant projection aborts its transaction', async () => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: {
        sender: 'Restored sender',
        recipient: 'Restored recipient',
      },
    });
    syncLetterParticipantsFromMetadataMock.mockRejectedValueOnce(
      new Error('participant projection failed'),
    );

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).rejects.toThrow('participant projection failed');
    expect(transactionMock).toHaveBeenCalledOnce();
  });
});
