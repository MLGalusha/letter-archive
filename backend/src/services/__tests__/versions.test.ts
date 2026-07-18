import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  getLetterByIdMock,
  syncLetterParticipantsFromMetadataMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
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
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));

  return {
    db: {
      query: {
        letterVersions: {
          findFirst: findFirstMock,
        },
      },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      metadataRevision: 'letters.metadataRevision',
      updatedAt: 'letters.updatedAt',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      workflow: 'letters.workflow',
      transcriptionText: 'letters.transcriptionText',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
    },
    letterVersions: {
      letterId: 'letterVersions.letterId',
      fieldType: 'letterVersions.fieldType',
      versionNumber: 'letterVersions.versionNumber',
      createdAt: 'letterVersions.createdAt',
    },
  };
});

vi.mock('../letters.js', () => ({ getLetterById: getLetterByIdMock }));

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

import { restoreVersion } from '../letter/versions.js';

describe('transcript version restore ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'old-run',
      transcriptStatus: 'VERIFIED',
      transcriptConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
      transcriptConfirmedBy: 'reviewer-1',
      workflow: 'TRANSCRIBING',
      metadataRevision: 3,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
  });

  it('restores transcript content and revokes confirmation and the active AI attempt atomically', async () => {
    findFirstMock.mockResolvedValue({ content: { text: 'Restored by an admin' } });

    await expect(restoreVersion('letter-1', 3, 'transcript')).resolves.toBe(true);

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
      ]),
    }));
  });

  it('restores blank transcript content as empty and clears verification', async () => {
    findFirstMock.mockResolvedValue({ content: { text: '   ' } });

    await expect(restoreVersion('letter-1', 4, 'transcript')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: '   ',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      workflow: 'UPLOADED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
  });

  it('restores metadata into a legacy document without promoting it to V2', async () => {
    getLetterByIdMock.mockResolvedValueOnce({
      id: 'letter-legacy',
      metadataStatus: 'SUCCESS',
      metadataRevision: 3,
      metadataV2Json: null,
      metadataJson: {
        sender: 'Old sender',
        recipient: 'Old recipient',
        locationWritten: 'Boston',
      },
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    findFirstMock.mockResolvedValueOnce({
      content: {
        sender: 'Restored sender',
        recipient: 'Restored recipient',
        locationWritten: 'Cambridge',
        hook: 'Restored hook',
        summary: 'Restored summary',
      },
    });

    await expect(restoreVersion('letter-legacy', 2, 'metadata')).resolves.toBe(true);

    const updates = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updates).not.toHaveProperty('metadataV2Json');
    expect(updates.metadataJson).toEqual(expect.objectContaining({
      sender: 'Restored sender',
      recipient: 'Restored recipient',
      locationWritten: 'Cambridge',
      hook: 'Restored hook',
      summary: 'Restored summary',
    }));
  });
});
