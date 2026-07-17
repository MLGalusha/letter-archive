import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  getLetterByIdMock,
  syncLetterParticipantsFromMetadataMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
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
    updateWhereMock.mockResolvedValue(undefined);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'old-run',
      transcriptStatus: 'VERIFIED',
      workflow: 'TRANSCRIBING',
    });
  });

  it('restores transcript content and revokes the active AI attempt atomically', async () => {
    findFirstMock.mockResolvedValue({ content: { text: 'Restored by an admin' } });

    await expect(restoreVersion('letter-1', 3, 'transcript')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionText: 'Restored by an admin',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      workflow: 'TRANSCRIBED',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'eq',
      field: 'letters.id',
      value: 'letter-1',
    });
  });

  it('restores blank transcript content as empty and clears verification', async () => {
    findFirstMock.mockResolvedValue({ content: { text: '   ' } });

    await expect(restoreVersion('letter-1', 4, 'transcript')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionText: '   ',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      workflow: 'UPLOADED',
      updatedAt: expect.any(Date),
    });
  });
});
