import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLetterByIdMock, runTranscriptionMock } = vi.hoisted(() => ({
  getLetterByIdMock: vi.fn(),
  runTranscriptionMock: vi.fn(),
}));

vi.mock('../../services/letters.js', () => ({
  getLetterById: getLetterByIdMock,
}));

vi.mock('../transcription.js', () => ({
  runTranscription: runTranscriptionMock,
}));

vi.mock('../metadataV2.js', () => ({
  runMetadataExtractionV2: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
  })),
}));

import { processLetter } from '../processor.js';

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
