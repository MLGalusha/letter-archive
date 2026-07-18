import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLetterByIdMock, runTranscriptionMock, runMetadataExtractionV2Mock } = vi.hoisted(() => ({
  getLetterByIdMock: vi.fn(),
  runTranscriptionMock: vi.fn(),
  runMetadataExtractionV2Mock: vi.fn(),
}));

vi.mock('../../services/letters.js', () => ({
  getLetterById: getLetterByIdMock,
}));

vi.mock('../transcription.js', () => ({
  runTranscription: runTranscriptionMock,
}));

vi.mock('../metadataV2.js', () => ({
  runMetadataExtractionV2: runMetadataExtractionV2Mock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
  })),
}));

import { processLetter, processMetadata } from '../processor.js';

describe('processLetter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
    });
    runTranscriptionMock.mockResolvedValue({
      kind: 'completed',
      pageCount: 1,
      textLength: 12,
    });
  });

  it('returns normally when the canonical transcription attempt completes', async () => {
    await expect(processLetter('letter-1')).resolves.toBeUndefined();
  });

  it.each(['claim_lost', 'superseded', 'ineligible'] as const)(
    'preserves a neutral %s outcome as skipped',
    async (reason) => {
      runTranscriptionMock.mockResolvedValue({ kind: reason });

      await expect(processLetter('letter-1')).resolves.toEqual({
        kind: 'skipped',
        reason,
      });
    },
  );

  it('reports a stale or otherwise ineligible preflight as skipped', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
    });

    await expect(processLetter('letter-1')).resolves.toEqual({
      kind: 'skipped',
      reason: 'ineligible',
    });
    expect(runTranscriptionMock).not.toHaveBeenCalled();
  });

  it('reports a non-transcribable type as skipped', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'P',
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
    });

    await expect(processLetter('letter-1')).resolves.toEqual({
      kind: 'skipped',
      reason: 'ineligible',
    });
    expect(runTranscriptionMock).not.toHaveBeenCalled();
  });
});

describe('processMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'PENDING',
      sender: null,
      recipient: null,
    });
    runMetadataExtractionV2Mock.mockResolvedValue({ kind: 'completed' });
  });

  it('starts metadata when the transcript is idle and the letter is eligible', async () => {
    await expect(processMetadata('letter-1')).resolves.toBeUndefined();

    expect(runMetadataExtractionV2Mock).toHaveBeenCalledWith('letter-1');
  });

  it('does not start metadata while retranscription is running', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'RUNNING',
      metadataStatus: 'PENDING',
      sender: null,
      recipient: null,
    });

    await expect(processMetadata('letter-1')).resolves.toEqual({
      kind: 'skipped',
      reason: 'ineligible',
    });

    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it.each(['claim_lost', 'superseded', 'ineligible'] as const)(
    'preserves neutral metadata %s as skipped',
    async (reason) => {
      runMetadataExtractionV2Mock.mockResolvedValue({ kind: reason });

      await expect(processMetadata('letter-1')).resolves.toEqual({
        kind: 'skipped',
        reason,
      });
    },
  );
});
