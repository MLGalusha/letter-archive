/**
 * Reading View Service
 *
 * Generates and saves paragraph-formatted reading text for a letter
 * using the break-map AI service.
 */

import { eq } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { generateBreakMap } from '../../ai/openai/breakMap.js';
import { log } from './shared.js';

/**
 * Generate reading view text for a letter and save it to the database.
 *
 * @param letterId - The letter ID
 * @returns The generated reading text, or null if letter has no transcript
 */
export async function generateAndSaveReadingView(letterId: string): Promise<string | null> {
  const letter = await getLetterById(letterId);
  if (!letter) {
    log.warn({ letterId }, 'Letter not found for reading view generation');
    return null;
  }

  if (!letter.transcriptionText) {
    log.warn({ letterId }, 'No transcript — cannot generate reading view');
    return null;
  }

  log.info({ letterId }, 'Generating reading view');
  const readingText = await generateBreakMap(letter.transcriptionText, letterId);

  await db.update(letters).set({
    readingText,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, textLength: readingText.length }, 'Reading view saved');
  return readingText;
}
