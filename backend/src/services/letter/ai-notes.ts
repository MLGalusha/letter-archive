import { and } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { log } from './shared.js';
import {
  buildHumanMetadataNotesPatch,
  observedMetadataRevisionConditions,
} from './metadata-job.js';

export async function updateAiNotes(letterId: string, aiNotes: unknown): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  const updated = await db
    .update(letters)
    .set({
      aiNotes: Array.isArray(aiNotes) ? aiNotes : [],
      ...buildHumanMetadataNotesPatch(),
      updatedAt: new Date(),
    })
    .where(and(...observedMetadataRevisionConditions(letterId, existingLetter)))
    .returning({ id: letters.id });

  if (updated.length === 0) {
    const error = new Error(
      'Metadata changed before AI notes could be saved; reload and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  log.debug({ letterId }, 'AI notes updated');
  return true;
}
