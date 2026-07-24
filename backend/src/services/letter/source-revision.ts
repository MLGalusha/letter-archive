import { eq } from 'drizzle-orm';
import { letters } from '../../db/index.js';
import { AppError } from '../../utils/response-helpers.js';

export const SOURCE_REVISION_CHANGED_ERROR_CODE = 'SOURCE_REVISION_CHANGED';

/**
 * The only HTTP conflict that tells an editor its complete source-derived
 * draft is stale. Other 409s describe narrower write races and must remain
 * recoverable without forcing a page reload.
 */
export class SourceRevisionChangedError extends AppError {
  constructor(message: string) {
    super(409, message, undefined, SOURCE_REVISION_CHANGED_ERROR_CODE);
  }
}

export function sourceRevisionChanged(message: string): SourceRevisionChangedError {
  return new SourceRevisionChangedError(message);
}

export function assertCurrentPrimarySourceRevision(
  actualRevision: number,
  expectedRevision: number,
  message: string,
): void {
  if (actualRevision === expectedRevision) return;
  throw sourceRevisionChanged(message);
}

export function currentPrimarySourceRevisionCondition(
  expectedRevision: number,
) {
  return eq(letters.primarySourceRevision, expectedRevision);
}
