import { eq } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { log } from './shared.js';

export async function updateAiNotes(letterId: string, aiNotes: unknown): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    aiNotes: Array.isArray(aiNotes) ? aiNotes : [],
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.debug({ letterId }, 'AI notes updated');
  return true;
}
