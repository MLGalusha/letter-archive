import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MetadataDisposition,
  TranscriptConfirmationReceipt,
} from '../../../api/admin/letters';
import { ApiError } from '../../../api/client';
import type { Letter } from '../../../types/Letter';
import {
  getTranscriptConfirmationFeedback,
  resolveTranscriptConfirmationOutcome,
  TranscriptConfirmationAcceptedError,
  TranscriptConfirmationOutcomeUnknownError,
} from '../transcriptConfirmationOutcome';

const {
  confirmTranscriptMock,
  getAdminLetterByIdMock,
} = vi.hoisted(() => ({
  confirmTranscriptMock: vi.fn(),
  getAdminLetterByIdMock: vi.fn(),
}));

vi.mock('../../../api/admin/letters', () => ({
  confirmTranscript: confirmTranscriptMock,
}));

vi.mock('../../../api/letters', () => ({
  getAdminLetterById: getAdminLetterByIdMock,
}));

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-1',
    title: 'Letter One',
    primarySourceRevision: 7,
    images: [],
    transcript: {
      pages: [],
      fullText: 'Persisted transcript',
      verified: false,
    },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'METADATA_EXTRACTING',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EDITED',
    metadataContentStatus: 'EMPTY',
    extraContentStatus: 'EMPTY',
    transcriptConfirmedAt: '2026-07-25T12:00:00.000Z',
    transcriptConfirmationId: 'confirmation-1',
    createdAt: '2026-07-25T11:00:00.000Z',
    flagged: false,
    ...overrides,
  };
}

function makeReceipt(
  metadataDisposition: MetadataDisposition = 'queued',
): TranscriptConfirmationReceipt {
  return {
    confirmationId: 'confirmation-1',
    confirmedAt: '2026-07-25T12:00:00.000Z',
    confirmedBy: null,
    transcriptSource: {
      primarySourceRevision: 7,
      transcriptDigest: 'digest-1',
    },
    metadataInputIdentity: 'metadata-input-1',
    intentIdentity: 'intent-1',
    metadataDisposition,
  };
}

const request = {
  letterId: 'letter-1',
  primarySourceRevision: 7,
  transcriptDigest: 'digest-1',
  confirmedSender: 'Mabel',
  confirmedRecipient: 'Theo',
};

describe('resolveTranscriptConfirmationOutcome', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses the optional response Letter without an extra GET', async () => {
    const letter = makeLetter();
    const receipt = makeReceipt();
    confirmTranscriptMock.mockResolvedValue({ receipt, letter });

    await expect(resolveTranscriptConfirmationOutcome(request)).resolves
      .toEqual({
        letter,
        receipt,
        origin: 'response',
      });

    expect(confirmTranscriptMock).toHaveBeenCalledWith(
      'letter-1',
      7,
      'digest-1',
      {
        confirmedSender: 'Mabel',
        confirmedRecipient: 'Theo',
      },
    );
    expect(getAdminLetterByIdMock).not.toHaveBeenCalled();
  });

  it('reconciles an accepted receipt without a Letter through one GET', async () => {
    const letter = makeLetter();
    const receipt = makeReceipt('already_running');
    confirmTranscriptMock.mockResolvedValue({ receipt });
    getAdminLetterByIdMock.mockResolvedValue(letter);

    await expect(resolveTranscriptConfirmationOutcome(request)).resolves
      .toEqual({
        letter,
        receipt,
        origin: 'receipt_reconciliation',
      });
    expect(getAdminLetterByIdMock).toHaveBeenCalledOnce();
    expect(getAdminLetterByIdMock).toHaveBeenCalledWith('letter-1');
  });

  it('drops receipt disposition when the response Letter is unconfirmed', async () => {
    const receipt = makeReceipt('queued');
    const unconfirmed = makeLetter({
      workflowState: 'TRANSCRIBED',
      transcriptConfirmedAt: undefined,
    });
    confirmTranscriptMock.mockResolvedValue({
      receipt,
      letter: unconfirmed,
    });

    await expect(resolveTranscriptConfirmationOutcome(request)).resolves
      .toEqual({
        letter: unconfirmed,
        origin: 'ambiguous_reconciliation',
      });
  });

  it('drops receipt disposition when receipt reconciliation reads a newer source', async () => {
    const receipt = makeReceipt('queued');
    const newer = makeLetter({ primarySourceRevision: 8 });
    confirmTranscriptMock.mockResolvedValue({ receipt });
    getAdminLetterByIdMock.mockResolvedValue(newer);

    await expect(resolveTranscriptConfirmationOutcome(request)).resolves
      .toEqual({
        letter: newer,
        origin: 'ambiguous_reconciliation',
      });
  });

  it('drops receipt disposition for a same-source newer confirmation identity', async () => {
    const receipt = makeReceipt('queued');
    const newerConfirmation = makeLetter({
      transcriptConfirmationId: 'confirmation-2',
    });
    confirmTranscriptMock.mockResolvedValue({ receipt });
    getAdminLetterByIdMock.mockResolvedValue(newerConfirmation);

    const outcome = await resolveTranscriptConfirmationOutcome(request);

    expect(outcome).toEqual({
      letter: newerConfirmation,
      origin: 'ambiguous_reconciliation',
    });
    expect(getTranscriptConfirmationFeedback(outcome)).toEqual({
      message: 'Transcript is confirmed; current metadata state refreshed.',
      type: 'info',
    });
  });

  it.each([0, 500, 503])(
    'reconciles ambiguous status %s without retrying confirmation',
    async (status) => {
      const letter = makeLetter();
      confirmTranscriptMock.mockRejectedValue(
        new ApiError(status, 'Confirmation response unavailable'),
      );
      getAdminLetterByIdMock.mockResolvedValue(letter);

      await expect(resolveTranscriptConfirmationOutcome(request)).resolves
        .toEqual({
          letter,
          origin: 'ambiguous_reconciliation',
        });
      expect(confirmTranscriptMock).toHaveBeenCalledOnce();
      expect(getAdminLetterByIdMock).toHaveBeenCalledOnce();
    },
  );

  it('rethrows the original ambiguous error when GET proves unconfirmed', async () => {
    const error = new ApiError(500, 'Confirmation failed before commit');
    confirmTranscriptMock.mockRejectedValue(error);
    getAdminLetterByIdMock.mockResolvedValue(makeLetter({
      workflowState: 'TRANSCRIBED',
      transcriptConfirmedAt: undefined,
    }));

    await expect(resolveTranscriptConfirmationOutcome(request))
      .rejects.toBe(error);
    expect(confirmTranscriptMock).toHaveBeenCalledOnce();
    expect(getAdminLetterByIdMock).toHaveBeenCalledOnce();
  });

  it('returns a newer source for consumer-owned conflict handling', async () => {
    confirmTranscriptMock.mockRejectedValue(
      new ApiError(0, 'Connection interrupted'),
    );
    const newer = makeLetter({
      primarySourceRevision: 8,
      workflowState: 'TRANSCRIBED',
      transcriptConfirmedAt: undefined,
    });
    getAdminLetterByIdMock.mockResolvedValue(newer);

    await expect(resolveTranscriptConfirmationOutcome(request)).resolves
      .toEqual({
        letter: newer,
        origin: 'ambiguous_reconciliation',
      });
  });

  it('reports a typed accepted error when receipt reconciliation fails', async () => {
    const receipt = makeReceipt();
    confirmTranscriptMock.mockResolvedValue({ receipt });
    getAdminLetterByIdMock.mockRejectedValue(new Error('GET failed'));

    const error = await resolveTranscriptConfirmationOutcome(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TranscriptConfirmationAcceptedError);
    expect(error).toMatchObject({ receipt });
    expect(confirmTranscriptMock).toHaveBeenCalledOnce();
  });

  it('reports a typed unknown error when ambiguous reconciliation fails', async () => {
    confirmTranscriptMock.mockRejectedValue(
      new ApiError(500, 'Response lost'),
    );
    getAdminLetterByIdMock.mockRejectedValue(new Error('GET failed'));

    await expect(resolveTranscriptConfirmationOutcome(request))
      .rejects.toBeInstanceOf(
        TranscriptConfirmationOutcomeUnknownError,
      );
    expect(confirmTranscriptMock).toHaveBeenCalledOnce();
  });

  it('does not reconcile a non-ambiguous precondition error', async () => {
    const error = new ApiError(409, 'Source changed', {
      code: 'SOURCE_REVISION_CHANGED',
    });
    confirmTranscriptMock.mockRejectedValue(error);

    await expect(resolveTranscriptConfirmationOutcome(request))
      .rejects.toBe(error);
    expect(getAdminLetterByIdMock).not.toHaveBeenCalled();
  });
});

describe('getTranscriptConfirmationFeedback', () => {
  it.each([
    ['queued', 'Transcript confirmed; metadata extraction queued.', 'success'],
    [
      'already_running',
      'Transcript confirmed; metadata extraction is already in progress.',
      'info',
    ],
    [
      'already_available',
      'Transcript confirmed; metadata is already available.',
      'success',
    ],
    [
      'failed',
      'Transcript confirmed; metadata extraction failed. '
      + 'Retry metadata extraction.',
      'error',
    ],
    [
      'not_applicable',
      'Transcript confirmed; metadata extraction does not apply '
      + 'to this content.',
      'info',
    ],
  ] as const)(
    'maps %s to truthful feedback',
    (metadataDisposition, message, type) => {
      expect(getTranscriptConfirmationFeedback({
        letter: makeLetter(),
        receipt: makeReceipt(metadataDisposition),
        origin: 'response',
      })).toEqual({ message, type });
    },
  );

  it('uses generic copy after an ambiguous authoritative read', () => {
    expect(getTranscriptConfirmationFeedback({
      letter: makeLetter(),
      origin: 'ambiguous_reconciliation',
    })).toEqual({
      message: 'Transcript is confirmed; current metadata state refreshed.',
      type: 'info',
    });
  });

  it('does not claim confirmation from an unconfirmed authoritative read', () => {
    expect(getTranscriptConfirmationFeedback({
      letter: makeLetter({
        workflowState: 'TRANSCRIBED',
        transcriptConfirmedAt: undefined,
      }),
      origin: 'ambiguous_reconciliation',
    })).toEqual({
      message:
        'Confirmation outcome reconciled; current letter state refreshed.',
      type: 'info',
    });
  });
});
