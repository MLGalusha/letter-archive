import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getLetterWithPagesMock,
  claimQueuedTranscriptionMock,
  claimRequestedTranscriptionMock,
  completeTranscriptionMock,
  failTranscriptionMock,
  withTranscriptionHeartbeatMock,
  transcribeImageMock,
  transcribeExtraContentMock,
  runAutomaticExtraContentMock,
} = vi.hoisted(() => ({
  getLetterWithPagesMock: vi.fn(),
  claimQueuedTranscriptionMock: vi.fn(),
  claimRequestedTranscriptionMock: vi.fn(),
  completeTranscriptionMock: vi.fn(),
  failTranscriptionMock: vi.fn(),
  withTranscriptionHeartbeatMock: vi.fn(),
  transcribeImageMock: vi.fn(),
  transcribeExtraContentMock: vi.fn(),
  runAutomaticExtraContentMock: vi.fn(),
}));

vi.mock('../../ai/openai.js', () => ({
  transcribeImage: transcribeImageMock,
  transcribeExtraContent: transcribeExtraContentMock,
}));

vi.mock('../../services/letters.js', () => ({
  getLetterWithPages: getLetterWithPagesMock,
}));

vi.mock('../../services/letter/transcription-job.js', () => ({
  claimQueuedTranscription: claimQueuedTranscriptionMock,
  claimRequestedTranscription: claimRequestedTranscriptionMock,
  completeTranscription: completeTranscriptionMock,
  failTranscription: failTranscriptionMock,
  withTranscriptionHeartbeat: withTranscriptionHeartbeatMock,
  observeTranscriptionState: vi.fn((source: Record<string, unknown>) => ({
    status: source.transcriptionStatus,
    workflow: source.workflow,
    transcriptionText: source.transcriptionText,
    transcriptionError: source.transcriptionError,
    transcriptionAttemptCount: source.transcriptionAttemptCount,
    transcriptionLeaseExpiresAt: source.transcriptionLeaseExpiresAt,
    transcriptionLeaseRunId: source.transcriptionLeaseRunId,
    transcriptionClaimKind: source.transcriptionClaimKind,
    metadataStatus: source.metadataStatus,
    entityExtractionStatus: source.entityExtractionStatus,
    deadLetter: source.deadLetter,
    transcriptStatus: source.transcriptStatus,
  })),
}));

vi.mock('../../services/storage.js', () => ({
  getAbsoluteStoragePath: vi.fn((path: string) => path),
}));

vi.mock('../../services/processes/runner.js', () => ({
  updateJobProgress: vi.fn(),
  clearJobProgress: vi.fn(),
  shouldAbortProcessing: vi.fn(() => false),
}));

vi.mock('../../services/letter/extra-content.js', () => ({
  runAutomaticExtraContent: runAutomaticExtraContentMock,
}));

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

import { runRequestedTranscription, runTranscription } from '../transcription.js';

const updatedAt = new Date('2026-07-17T12:00:00.000Z');

function letter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'letter-1',
    type: 'L',
    workflow: 'UPLOADED',
    transcriptionStatus: 'PENDING',
    transcriptionText: null,
    transcriptionError: null,
    transcriptionAttemptCount: 0,
    transcriptionLeaseExpiresAt: null,
    transcriptionLeaseRunId: null,
    transcriptionClaimKind: null,
    metadataStatus: 'PENDING',
    entityExtractionStatus: 'PENDING',
    deadLetter: false,
    transcriptStatus: 'EMPTY',
    updatedAt,
    collection: { collectionCode: '009' },
    dateRaw: '19470810',
    pages: [{ id: 'page-1', pageNumber: 1, storagePath: 'letter.jpg' }],
    ...overrides,
  };
}

describe('canonical transcription pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterWithPagesMock.mockResolvedValue(letter());
    claimQueuedTranscriptionMock.mockResolvedValue({ runId: 'run-a' });
    claimRequestedTranscriptionMock.mockResolvedValue({ runId: 'run-a' });
    completeTranscriptionMock.mockResolvedValue(true);
    failTranscriptionMock.mockResolvedValue(true);
    withTranscriptionHeartbeatMock.mockImplementation(
      async (
        _letterId: string,
        _runId: string,
        operation: (heartbeat: { hasOwnership(): boolean }) => Promise<unknown>,
      ) => operation({ hasOwnership: () => true }),
    );
    transcribeImageMock.mockResolvedValue({ text: 'Main transcript', isStub: false });
    transcribeExtraContentMock.mockResolvedValue({ text: 'Document transcript', isStub: false });
    runAutomaticExtraContentMock.mockResolvedValue({ kind: 'completed', value: 1 });
  });

  it('returns truthful metrics and runs the automatic extra producer once by default', async () => {
    await expect(runTranscription('letter-1')).resolves.toEqual({
      kind: 'completed',
      pageCount: 1,
      textLength: 15,
    });

    expect(claimQueuedTranscriptionMock).toHaveBeenCalledWith('letter-1', {
      status: 'PENDING',
      workflow: 'UPLOADED',
      transcriptionText: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      deadLetter: false,
      transcriptStatus: 'EMPTY',
    });
    expect(completeTranscriptionMock).toHaveBeenCalledWith(
      'letter-1',
      'run-a',
      'Main transcript',
    );
    expect(withTranscriptionHeartbeatMock).toHaveBeenCalledWith(
      'letter-1',
      'run-a',
      expect.any(Function),
    );
    expect(runAutomaticExtraContentMock).toHaveBeenCalledTimes(1);
    expect(runAutomaticExtraContentMock).toHaveBeenCalledWith('letter-1');
  });

  it('skips automatic extras when a caller owns the explicit extra contract', async () => {
    await expect(runTranscription('letter-1', { extraContent: 'skip' })).resolves.toEqual({
      kind: 'completed',
      pageCount: 1,
      textLength: 15,
    });

    expect(runAutomaticExtraContentMock).not.toHaveBeenCalled();
  });

  it('performs no AI work when the queued claim is lost', async () => {
    claimQueuedTranscriptionMock.mockResolvedValue(null);

    await expect(runTranscription('letter-1')).resolves.toEqual({ kind: 'claim_lost' });

    expect(transcribeImageMock).not.toHaveBeenCalled();
    expect(completeTranscriptionMock).not.toHaveBeenCalled();
  });

  it('claims a preflighted direct revision and uses the same no-extras producer', async () => {
    getLetterWithPagesMock.mockResolvedValue(letter({
      transcriptionStatus: 'SUCCESS',
    }));

    await expect(runRequestedTranscription('letter-1')).resolves.toEqual({
      kind: 'completed',
      pageCount: 1,
      textLength: 15,
    });

    expect(claimRequestedTranscriptionMock).toHaveBeenCalledWith('letter-1', {
      status: 'SUCCESS',
      workflow: 'UPLOADED',
      transcriptionText: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      deadLetter: false,
      transcriptStatus: 'EMPTY',
    });
    expect(claimQueuedTranscriptionMock).not.toHaveBeenCalled();
    expect(runAutomaticExtraContentMock).not.toHaveBeenCalled();
  });

  it('returns claim loss without AI when the direct revision changed or is active', async () => {
    getLetterWithPagesMock.mockResolvedValue(letter({ transcriptionStatus: 'RUNNING' }));
    claimRequestedTranscriptionMock.mockResolvedValue(null);

    await expect(runRequestedTranscription('letter-1')).resolves.toEqual({ kind: 'claim_lost' });

    expect(transcribeImageMock).not.toHaveBeenCalled();
  });

  it('does not publish extras or report completion after terminal ownership is lost', async () => {
    completeTranscriptionMock.mockResolvedValue(false);

    await expect(runTranscription('letter-1')).resolves.toEqual({ kind: 'superseded' });

    expect(runAutomaticExtraContentMock).not.toHaveBeenCalled();
  });

  it('stops before publication when the lease is lost during slow AI work', async () => {
    let ownsLease = true;
    withTranscriptionHeartbeatMock.mockImplementation(
      async (
        _letterId: string,
        _runId: string,
        operation: (heartbeat: { hasOwnership(): boolean }) => Promise<unknown>,
      ) => operation({ hasOwnership: () => ownsLease }),
    );
    transcribeImageMock.mockImplementation(async () => {
      ownsLease = false;
      return { text: 'Late transcript', isStub: false };
    });

    await expect(runTranscription('letter-1')).resolves.toEqual({ kind: 'superseded' });

    expect(completeTranscriptionMock).not.toHaveBeenCalled();
    expect(runAutomaticExtraContentMock).not.toHaveBeenCalled();
  });

  it('uses canonical non-letter behavior and reports empty output truthfully', async () => {
    getLetterWithPagesMock.mockResolvedValue(letter({ type: 'T' }));
    transcribeExtraContentMock.mockResolvedValue({ text: '\n\n', isStub: false });

    await expect(runRequestedTranscription('letter-1')).resolves.toEqual({
      kind: 'completed',
      pageCount: 1,
      textLength: 0,
    });

    expect(transcribeExtraContentMock).toHaveBeenCalledTimes(1);
    expect(completeTranscriptionMock).toHaveBeenCalledWith('letter-1', 'run-a', null);
  });

  it('does not let a late producer failure overwrite a superseding transition', async () => {
    const failure = new Error('vision unavailable');
    transcribeImageMock.mockRejectedValue(failure);
    failTranscriptionMock.mockResolvedValue(false);

    await expect(runTranscription('letter-1')).resolves.toEqual({ kind: 'superseded' });
    expect(failTranscriptionMock).toHaveBeenCalledWith(
      'letter-1',
      'run-a',
      'vision unavailable',
    );
  });

  it('records an owned producer failure and rethrows it', async () => {
    const failure = new Error('vision unavailable');
    transcribeImageMock.mockRejectedValue(failure);

    await expect(runTranscription('letter-1')).rejects.toBe(failure);
    expect(failTranscriptionMock).toHaveBeenCalledWith(
      'letter-1',
      'run-a',
      'vision unavailable',
    );
  });

  it('reloads page sources after winning the claim', async () => {
    getLetterWithPagesMock
      .mockResolvedValueOnce(letter({
        pages: [{ id: 'old-page', pageNumber: 1, storagePath: 'old.jpg' }],
      }))
      .mockResolvedValueOnce(letter({
        workflow: 'TRANSCRIBING',
        transcriptionStatus: 'RUNNING',
        pages: [{ id: 'new-page', pageNumber: 1, storagePath: 'new.jpg' }],
      }));

    await expect(runTranscription('letter-1')).resolves.toMatchObject({ kind: 'completed' });

    expect(transcribeImageMock).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'new.jpg',
    }));
    expect(transcribeImageMock).not.toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'old.jpg',
    }));
  });

  it('preserves source order when page numbers are sparse', async () => {
    getLetterWithPagesMock.mockResolvedValue(letter({
      pages: [
        { id: 'page-2', pageNumber: 2, storagePath: 'two.jpg' },
        { id: 'page-5', pageNumber: 5, storagePath: 'five.jpg' },
      ],
    }));
    transcribeImageMock.mockImplementation(async ({ filePath }: { filePath: string }) => ({
      text: filePath === 'two.jpg' ? 'Second' : 'Fifth',
      isStub: false,
    }));

    await expect(runTranscription('letter-1')).resolves.toEqual({
      kind: 'completed',
      pageCount: 2,
      textLength: 45,
    });

    expect(completeTranscriptionMock).toHaveBeenCalledWith(
      'letter-1',
      'run-a',
      '--- Page 1 ---\n\nSecond\n\n--- Page 2 ---\n\nFifth',
    );
  });

  it('fails an owned claim when the letter disappears before source reload', async () => {
    getLetterWithPagesMock
      .mockResolvedValueOnce(letter())
      .mockResolvedValueOnce(undefined);

    await expect(runTranscription('letter-1')).rejects.toThrow(
      'Letter disappeared after transcription claim',
    );
    expect(failTranscriptionMock).toHaveBeenCalledWith(
      'letter-1',
      'run-a',
      'Letter disappeared after transcription claim: letter-1',
    );
    expect(transcribeImageMock).not.toHaveBeenCalled();
  });

  it('validates direct requests before acquiring or mutating a claim', async () => {
    getLetterWithPagesMock.mockResolvedValueOnce(undefined);
    await expect(runRequestedTranscription('missing')).resolves.toEqual({ kind: 'not_found' });

    getLetterWithPagesMock.mockResolvedValueOnce(letter({ type: 'P' }));
    await expect(runRequestedTranscription('photo')).resolves.toEqual({
      kind: 'not_transcribable',
      type: 'P',
    });

    getLetterWithPagesMock.mockResolvedValueOnce(letter({ pages: [] }));
    await expect(runRequestedTranscription('empty')).resolves.toEqual({ kind: 'no_pages' });

    expect(claimRequestedTranscriptionMock).not.toHaveBeenCalled();
    expect(transcribeImageMock).not.toHaveBeenCalled();
  });
});
