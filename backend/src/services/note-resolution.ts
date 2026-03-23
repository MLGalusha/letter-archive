/**
 * Note Auto-Resolution Service
 *
 * Checks structured AI notes for auto-resolution triggers and marks
 * matching notes as resolved when the relevant field changes.
 */

import { eq } from 'drizzle-orm';
import { db, letters } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type { StructuredNote } from '../ai/schemas/metadataV2.js';

const log = createLogger({ module: 'note-resolution' });

/**
 * Mapping from resolves_when trigger keys to the field change that triggers them.
 */
const TRIGGER_MAP: Record<string, string> = {
  sender_filled: 'sender',
  recipient_filled: 'recipient',
  date_confirmed: 'extractedDateConfidence',
  location_filled: 'locationWritten',
  relationship_set: 'senderRecipientRelationship',
  transcription_edited: 'transcriptionText',
  date_conflict_resolved: 'extractedDate',
};

/**
 * Check and auto-resolve notes for a letter when a field changes.
 *
 * @param letterId - The letter to check
 * @param changedField - The field name that was changed (e.g., 'sender', 'recipient')
 */
export async function checkNoteAutoResolutions(
  letterId: string,
  changedField: string,
): Promise<void> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) return;

  const aiNotes = letter.aiNotes as StructuredNote[] | null;
  if (!Array.isArray(aiNotes) || aiNotes.length === 0) return;

  // Find which trigger keys match the changed field
  const matchingTriggers = Object.entries(TRIGGER_MAP)
    .filter(([_, field]) => field === changedField)
    .map(([trigger]) => trigger);

  if (matchingTriggers.length === 0) return;

  let resolved = false;
  const updatedNotes = aiNotes.map((note) => {
    if (
      note.status === 'open' &&
      note.resolves_when &&
      matchingTriggers.includes(note.resolves_when)
    ) {
      resolved = true;
      return {
        ...note,
        status: 'resolved' as const,
        resolved_at: new Date().toISOString(),
        resolved_by: 'auto',
      };
    }
    return note;
  });

  if (resolved) {
    await db
      .update(letters)
      .set({ aiNotes: updatedNotes, updatedAt: new Date() })
      .where(eq(letters.id, letterId));

    const resolvedCount = updatedNotes.filter(
      (n) => n.resolved_by === 'auto' && n.resolved_at !== null,
    ).length;
    log.info({ letterId, changedField, resolvedCount }, 'Auto-resolved AI notes');
  }
}
