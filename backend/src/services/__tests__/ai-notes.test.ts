import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbUpdateMock,
  getLetterByIdMock,
  updateReturningMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  dbUpdateMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  updateReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({
    kind: 'eq',
    field,
    value,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  return {
    db: { update: dbUpdateMock },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
    },
  };
});

vi.mock('../letters.js', () => ({
  getLetterById: getLetterByIdMock,
}));

vi.mock('../letter/metadata-job.js', () => ({
  buildHumanMetadataNotesPatch: vi.fn(() => ({
    metadataRevision: { kind: 'increment' },
  })),
  observedMetadataRevisionConditions: vi.fn((
    letterId: string,
    source: { metadataRevision: number },
  ) => [{
    kind: 'metadata-revision',
    letterId,
    value: source.metadataRevision,
  }]),
}));

vi.mock('../letter/shared.js', () => ({
  log: {
    debug: vi.fn(),
  },
}));

import {
  addAiNote,
  resolveAiNotesForChangedFields,
  updateAiNoteStatus,
  updateAiNotes,
} from '../letter/ai-notes.js';

function openNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    content: 'Confirm the sender',
    category: 'identity',
    priority: 'high',
    status: 'open',
    resolves_when: 'sender_filled',
    resolved_at: null,
    resolved_by: null,
    source: 'ai',
    ...overrides,
  };
}

function letter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'letter-1',
    primarySourceRevision: 7,
    metadataRevision: 4,
    aiNotes: [openNote()],
    ...overrides,
  };
}

describe('AI note mutation ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterByIdMock.mockResolvedValue(letter());
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
  });

  it('CASes note writes against both metadata and the observed source epoch', async () => {
    await expect(addAiNote(
      'letter-1',
      {
        content: 'Check the date',
        category: 'date',
        priority: 'medium',
      },
      7,
      'reviewer-1',
    )).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      aiNotes: [
        expect.objectContaining({ id: 'note-1' }),
        expect.objectContaining({
          content: 'Check the date',
          category: 'date',
          priority: 'medium',
          source: 'admin',
          status: 'open',
        }),
      ],
      metadataRevision: { kind: 'increment' },
      updatedAt: expect.any(Date),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        {
          kind: 'metadata-revision',
          letterId: 'letter-1',
          value: 4,
        },
        {
          kind: 'eq',
          field: 'letters.primarySourceRevision',
          value: 7,
        },
      ],
    });
  });

  it('rejects a stale source before attempting a note write', async () => {
    getLetterByIdMock.mockResolvedValueOnce(letter({
      primarySourceRevision: 8,
    }));

    await expect(updateAiNotes('letter-1', [], 7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('classifies a source replacement that wins the note CAS as terminal', async () => {
    getLetterByIdMock
      .mockResolvedValueOnce(letter())
      .mockResolvedValueOnce(letter({ primarySourceRevision: 8 }));
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(updateAiNoteStatus(
      'letter-1',
      'note-1',
      'resolved',
      7,
      'reviewer-1',
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });
  });

  it('keeps a same-source metadata race recoverable', async () => {
    getLetterByIdMock
      .mockResolvedValueOnce(letter())
      .mockResolvedValueOnce(letter({ metadataRevision: 5 }));
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(updateAiNotes('letter-1', [], 7)).rejects.toMatchObject({
      statusCode: 409,
      code: undefined,
      message: expect.stringContaining('Metadata changed'),
    });
  });

  it('resolves matching notes as part of the triggering field mutation', () => {
    const outcome = resolveAiNotesForChangedFields(
      [
        openNote(),
        openNote({
          id: 'note-2',
          resolves_when: 'recipient_filled',
        }),
        openNote({
          id: 'note-3',
          status: 'dismissed',
        }),
      ],
      ['sender'],
      new Date('2026-07-24T12:00:00.000Z'),
    );

    expect(outcome).toEqual({
      resolvedCount: 1,
      notes: [
        expect.objectContaining({
          id: 'note-1',
          status: 'resolved',
          resolved_at: '2026-07-24T12:00:00.000Z',
          resolved_by: 'auto',
        }),
        expect.objectContaining({
          id: 'note-2',
          status: 'open',
        }),
        expect.objectContaining({
          id: 'note-3',
          status: 'dismissed',
        }),
      ],
    });
  });
});
