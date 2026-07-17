import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getLetterWithPagesMock,
  claimJobMock,
  updateLetterWorkflowMock,
  updateTranscriptionStatusMock,
  transcribeImageMock,
  runAutomaticExtraContentMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  findFirstMock,
} = vi.hoisted(() => ({
  getLetterWithPagesMock: vi.fn(),
  claimJobMock: vi.fn(),
  updateLetterWorkflowMock: vi.fn(),
  updateTranscriptionStatusMock: vi.fn(),
  transcribeImageMock: vi.fn(),
  runAutomaticExtraContentMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../ai/openai.js', () => ({
  transcribeImage: transcribeImageMock,
  transcribeExtraContent: vi.fn(),
}));

vi.mock('../../services/letters.js', () => ({
  getLetterWithPages: getLetterWithPagesMock,
  claimJob: claimJobMock,
  updateLetterWorkflow: updateLetterWorkflowMock,
  updateTranscriptionStatus: updateTranscriptionStatusMock,
  incrementTranscriptionAttempts: vi.fn(),
}));

vi.mock('../../services/storage.js', () => ({
  getAbsoluteStoragePath: vi.fn((path: string) => path),
}));

vi.mock('../../services/processing-queue.js', () => ({
  updateJobProgress: vi.fn(),
  clearJobProgress: vi.fn(),
  shouldAbortProcessing: vi.fn(() => false),
}));

vi.mock('../../services/letter/extra-content.js', () => ({
  runAutomaticExtraContent: runAutomaticExtraContentMock,
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  return {
    db: {
      query: { letters: { findFirst: findFirstMock } },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

import { runTranscription } from '../transcription.js';

describe('transcription extra-content wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterWithPagesMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [{ id: 'page-1', pageNumber: 1, storagePath: 'letter.jpg' }],
    });
    claimJobMock.mockResolvedValue(true);
    updateWhereMock.mockResolvedValue(undefined);
    findFirstMock.mockResolvedValue({ transcriptionStatus: 'RUNNING' });
    transcribeImageMock.mockResolvedValue({ text: 'Main transcript', isStub: false });
    runAutomaticExtraContentMock.mockResolvedValue({ kind: 'completed', value: 1 });
  });

  it('runs the automatic extra producer once by default', async () => {
    await runTranscription('letter-1');

    expect(runAutomaticExtraContentMock).toHaveBeenCalledTimes(1);
    expect(runAutomaticExtraContentMock).toHaveBeenCalledWith('letter-1');
  });

  it('skips automatic extras when a caller owns the explicit extra contract', async () => {
    await runTranscription('letter-1', { extraContent: 'skip' });

    expect(runAutomaticExtraContentMock).not.toHaveBeenCalled();
  });
});
