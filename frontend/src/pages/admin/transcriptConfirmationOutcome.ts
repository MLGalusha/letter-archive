import {
  confirmTranscript,
  type TranscriptConfirmationReceipt,
} from '../../api/admin/letters';
import { ApiError } from '../../api/client';
import { getAdminLetterById } from '../../api/letters';
import type { Letter } from '../../types/Letter';

interface ResolveTranscriptConfirmationOptions {
  letterId: string;
  primarySourceRevision: number;
  transcriptDigest: string;
  confirmedSender?: string;
  confirmedRecipient?: string;
}

export interface ResolvedTranscriptConfirmation {
  letter: Letter;
  receipt?: TranscriptConfirmationReceipt;
  origin:
    | 'response'
    | 'receipt_reconciliation'
    | 'ambiguous_reconciliation';
}

export type TranscriptConfirmationToastType = 'success' | 'error' | 'info';

export interface TranscriptConfirmationFeedback {
  message: string;
  type: TranscriptConfirmationToastType;
}

/**
 * The confirmation commit is known to have succeeded, but the frontend could
 * not hydrate the resulting Letter. Consumers must block confirmation replay
 * until an explicit reload establishes the current source.
 */
export class TranscriptConfirmationAcceptedError extends Error {
  readonly receipt: TranscriptConfirmationReceipt;

  constructor(
    receipt: TranscriptConfirmationReceipt,
    cause: unknown,
  ) {
    super(
      'Transcript confirmed, but the latest letter could not be loaded. '
      + 'Reload before continuing.',
      { cause },
    );
    this.name = 'TranscriptConfirmationAcceptedError';
    this.receipt = receipt;
  }
}

/**
 * A transport/5xx failure and the authoritative read both failed. Neither
 * success nor failure is safe to claim, so consumers must block blind replay.
 */
export class TranscriptConfirmationOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super(
      'Transcript confirmation outcome is unknown. Refresh before retrying.',
      { cause },
    );
    this.name = 'TranscriptConfirmationOutcomeUnknownError';
  }
}

function isAmbiguousConfirmationFailure(
  error: unknown,
): error is ApiError {
  return error instanceof ApiError
    && (error.status === 0 || error.status >= 500);
}

function acceptedReceiptOutcome(
  letter: Letter,
  receipt: TranscriptConfirmationReceipt,
  origin: 'response' | 'receipt_reconciliation',
): ResolvedTranscriptConfirmation {
  if (
    letter.primarySourceRevision
      === receipt.transcriptSource.primarySourceRevision
    && letter.transcriptConfirmationId === receipt.confirmationId
    && Boolean(letter.transcriptConfirmedAt)
  ) {
    return { letter, receipt, origin };
  }

  // Hydration may race a newer source or observe an incoherent unconfirmed
  // DTO. The Letter remains authoritative, but the old receipt disposition
  // must not describe it.
  return {
    letter,
    origin: 'ambiguous_reconciliation',
  };
}

async function reconcileAcceptedReceipt(
  letterId: string,
  receipt: TranscriptConfirmationReceipt,
): Promise<ResolvedTranscriptConfirmation> {
  try {
    return acceptedReceiptOutcome(
      await getAdminLetterById(letterId),
      receipt,
      'receipt_reconciliation',
    );
  } catch (error) {
    throw new TranscriptConfirmationAcceptedError(receipt, error);
  }
}

/**
 * Confirms once and reconciles only with an authoritative GET.
 *
 * This function never retries the POST. A successful receipt without a DTO is
 * already committed, while status-zero and 5xx failures remain ambiguous until
 * the GET proves a same-source confirmation or exposes a newer source.
 */
export async function resolveTranscriptConfirmationOutcome({
  letterId,
  primarySourceRevision,
  transcriptDigest,
  confirmedSender,
  confirmedRecipient,
}: ResolveTranscriptConfirmationOptions): Promise<ResolvedTranscriptConfirmation> {
  try {
    const response = await confirmTranscript(
      letterId,
      primarySourceRevision,
      transcriptDigest,
      {
        confirmedSender,
        confirmedRecipient,
      },
    );

    if (response.letter) {
      return acceptedReceiptOutcome(
        response.letter,
        response.receipt,
        'response',
      );
    }

    return reconcileAcceptedReceipt(letterId, response.receipt);
  } catch (error) {
    if (
      error instanceof TranscriptConfirmationAcceptedError
      || !isAmbiguousConfirmationFailure(error)
    ) {
      throw error;
    }

    let letter: Letter;
    try {
      letter = await getAdminLetterById(letterId);
    } catch (readError) {
      throw new TranscriptConfirmationOutcomeUnknownError(readError);
    }

    // A newer source is authoritative but cannot be attributed to the old
    // request. Return it so each consumer's source guard can take ownership.
    if (letter.primarySourceRevision !== primarySourceRevision) {
      return {
        letter,
        origin: 'ambiguous_reconciliation',
      };
    }

    if (!letter.transcriptConfirmedAt) {
      throw error;
    }

    return {
      letter,
      origin: 'ambiguous_reconciliation',
    };
  }
}

export function getTranscriptConfirmationFeedback(
  outcome: ResolvedTranscriptConfirmation,
): TranscriptConfirmationFeedback {
  if (!outcome.receipt) {
    if (!outcome.letter.transcriptConfirmedAt) {
      return {
        message:
          'Confirmation outcome reconciled; current letter state refreshed.',
        type: 'info',
      };
    }
    return {
      message: 'Transcript is confirmed; current metadata state refreshed.',
      type: 'info',
    };
  }

  switch (outcome.receipt.metadataDisposition) {
    case 'queued':
      return {
        message: 'Transcript confirmed; metadata extraction queued.',
        type: 'success',
      };
    case 'already_running':
      return {
        message:
          'Transcript confirmed; metadata extraction is already in progress.',
        type: 'info',
      };
    case 'already_available':
      return {
        message: 'Transcript confirmed; metadata is already available.',
        type: 'success',
      };
    case 'failed':
      return {
        message:
          'Transcript confirmed; metadata extraction failed. '
          + 'Retry metadata extraction.',
        type: 'error',
      };
    case 'not_applicable':
      return {
        message:
          'Transcript confirmed; metadata extraction does not apply '
          + 'to this content.',
        type: 'info',
      };
  }
}
