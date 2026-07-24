/**
 * Reading View Service
 *
 * Generates and saves paragraph-formatted reading text for a letter
 * using the break-map AI service.
 */

import { and, eq } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { generateBreakMap } from '../../ai/openai/breakMap.js';
import { log } from './shared.js';
import { assertCurrentPrimarySourceRevision } from './source-revision.js';

/**
 * Generate reading view text for a letter and save it to the database.
 *
 * @param letterId - The letter ID
 * @param expectedPrimarySourceRevision - The source epoch observed by the caller
 * @returns The generated reading text, or null if letter has no transcript
 */
export async function generateAndSaveReadingView(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<string | null> {
  const letter = await getLetterById(letterId);
  if (!letter) {
    log.warn({ letterId }, 'Letter not found for reading view generation');
    return null;
  }
  assertCurrentPrimarySourceRevision(
    letter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before the reading view could be generated; reload and try again',
  );

  if (
    letter.transcriptionStatus !== 'SUCCESS'
    || !letter.transcriptionText
  ) {
    log.warn({ letterId }, 'Completed transcript required for reading view generation');
    return null;
  }

  const source = {
    primarySourceRevision: letter.primarySourceRevision,
    transcriptionText: letter.transcriptionText,
  };
  log.info({ letterId }, 'Generating reading view');
  const readingText = await generateBreakMap(source.transcriptionText, letterId);

  const updated = await db
    .update(letters)
    .set({
      readingText,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.primarySourceRevision, expectedPrimarySourceRevision),
      eq(letters.transcriptionStatus, 'SUCCESS'),
      eq(letters.transcriptionText, source.transcriptionText),
    ))
    .returning({ id: letters.id });
  if (updated.length !== 1) {
    const latest = await getLetterById(letterId);
    if (latest) {
      assertCurrentPrimarySourceRevision(
        latest.primarySourceRevision,
        expectedPrimarySourceRevision,
        'Letter source changed before the reading view could be saved; reload and try again',
      );
    }
    const error = new Error(
      'Letter transcript changed before the reading view could be saved; reload and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  log.info({ letterId, textLength: readingText.length }, 'Reading view saved');
  return readingText;
}
