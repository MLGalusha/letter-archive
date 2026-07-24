import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateBreakMapMock,
  getLetterByIdMock,
  updateReturningMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  generateBreakMapMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  updateReturningMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../db/index.js', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: updateWhereMock,
      })),
    })),
  },
  letters: new Proxy({}, {
    get: (_target, property) => `letters.${String(property)}`,
  }),
}));

vi.mock('../letters.js', () => ({
  getLetterById: getLetterByIdMock,
}));

vi.mock('../../ai/openai/breakMap.js', () => ({
  generateBreakMap: generateBreakMapMock,
}));

import { generateAndSaveReadingView } from '../letter/readingView.js';

describe('reading view source fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      primarySourceRevision: 7,
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Authoritative transcript',
    });
    generateBreakMapMock.mockResolvedValue('Paragraph-form reading view');
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
  });

  it('saves only against the transcript and source revision sent to the model', async () => {
    await expect(generateAndSaveReadingView('letter-1', 7)).resolves.toBe(
      'Paragraph-form reading view',
    );

    expect(generateBreakMapMock).toHaveBeenCalledWith(
      'Authoritative transcript',
      'letter-1',
    );
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        {
          kind: 'eq',
          field: 'letters.transcriptionText',
          value: 'Authoritative transcript',
        },
      ],
    });
  });

  it('rejects a caller that did not observe the current source before invoking the model', async () => {
    await expect(generateAndSaveReadingView('letter-1', 6)).rejects.toMatchObject({
      message: expect.stringContaining('source changed'),
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(generateBreakMapMock).not.toHaveBeenCalled();
    expect(updateWhereMock).not.toHaveBeenCalled();
  });

  it('rejects an AI result after its source epoch loses the compare-and-set', async () => {
    updateReturningMock.mockResolvedValueOnce([]);
    getLetterByIdMock
      .mockResolvedValueOnce({
        id: 'letter-1',
        type: 'L',
        primarySourceRevision: 7,
        transcriptionStatus: 'SUCCESS',
        transcriptionText: 'Authoritative transcript',
      })
      .mockResolvedValueOnce({
        id: 'letter-1',
        type: 'L',
        primarySourceRevision: 8,
        transcriptionStatus: 'PENDING',
        transcriptionText: 'Authoritative transcript',
      });

    await expect(generateAndSaveReadingView('letter-1', 7)).rejects.toMatchObject({
      message: expect.stringContaining('source changed'),
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });
  });

  it('reports a same-epoch transcript race without misclassifying it as a source change', async () => {
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(generateAndSaveReadingView('letter-1', 7)).rejects.toMatchObject({
      message: expect.stringContaining('transcript changed'),
      status: 409,
    });
  });

  it('does not call the model for an invalidated pending transcript', async () => {
    getLetterByIdMock.mockResolvedValueOnce({
      id: 'letter-1',
      primarySourceRevision: 8,
      transcriptionStatus: 'PENDING',
      transcriptionText: 'Private stale transcript',
    });

    await expect(generateAndSaveReadingView('letter-1', 8)).resolves.toBeNull();
    expect(generateBreakMapMock).not.toHaveBeenCalled();
    expect(updateWhereMock).not.toHaveBeenCalled();
  });
});
