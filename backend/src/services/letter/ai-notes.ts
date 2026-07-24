import { randomUUID } from 'node:crypto';
import { and } from 'drizzle-orm';
import type {
  NoteCategory,
  NotePriority,
  StructuredNote,
} from '../../ai/schemas/metadataV2.js';
import { db, letters } from '../../db/index.js';
import { AppError, NotFoundError } from '../../utils/response-helpers.js';
import { getLetterById } from '../letters.js';
import { log } from './shared.js';
import {
  buildHumanMetadataNotesPatch,
  observedMetadataRevisionConditions,
} from './metadata-job.js';
import {
  assertCurrentPrimarySourceRevision,
  currentPrimarySourceRevisionCondition,
} from './source-revision.js';

export interface AddAiNoteInput {
  content: string;
  category: NoteCategory;
  priority: NotePriority;
}

type NoteStatus = Extract<StructuredNote['status'], 'resolved' | 'dismissed'>;
type NoteMutation = (notes: StructuredNote[]) => StructuredNote[];

const TRIGGER_FIELDS = new Map<string, string>([
  ['sender_filled', 'sender'],
  ['recipient_filled', 'recipient'],
  ['date_confirmed', 'extractedDate'],
  ['location_filled', 'locationWritten'],
  ['relationship_set', 'senderRecipientRelationship'],
  ['transcription_edited', 'transcriptionText'],
  ['date_conflict_resolved', 'extractedDate'],
]);

function structuredNotes(value: unknown): StructuredNote[] {
  return Array.isArray(value) ? value as StructuredNote[] : [];
}

async function mutateAiNotes(
  letterId: string,
  expectedPrimarySourceRevision: number,
  mutation: NoteMutation,
  conflictMessage: string,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision ?? 0,
    expectedPrimarySourceRevision,
    'Letter source changed before its notes could be saved; reload and try again',
  );

  const updated = await db
    .update(letters)
    .set({
      aiNotes: mutation(structuredNotes(existingLetter.aiNotes)),
      ...buildHumanMetadataNotesPatch(),
      updatedAt: new Date(),
    })
    .where(and(
      ...observedMetadataRevisionConditions(letterId, existingLetter),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
    ))
    .returning({ id: letters.id });

  if (updated.length === 0) {
    const latest = await getLetterById(letterId);
    if (latest) {
      assertCurrentPrimarySourceRevision(
        latest.primarySourceRevision ?? 0,
        expectedPrimarySourceRevision,
        'Letter source changed before its notes could be saved; reload and try again',
      );
    }
    throw new AppError(409, conflictMessage);
  }

  return true;
}

export async function updateAiNotes(
  letterId: string,
  aiNotes: unknown[],
  expectedPrimarySourceRevision: number,
): Promise<true | null> {
  const result = await mutateAiNotes(
    letterId,
    expectedPrimarySourceRevision,
    () => structuredNotes(aiNotes),
    'Metadata changed before AI notes could be saved; reload and try again',
  );
  if (result) log.debug({ letterId }, 'AI notes replaced');
  return result;
}

export async function addAiNote(
  letterId: string,
  input: AddAiNoteInput,
  expectedPrimarySourceRevision: number,
  actor: string,
): Promise<true | null> {
  const note: StructuredNote = {
    id: randomUUID(),
    content: input.content,
    category: input.category,
    priority: input.priority,
    status: 'open',
    resolves_when: null,
    resolved_at: null,
    resolved_by: null,
    source: 'admin',
  };
  const result = await mutateAiNotes(
    letterId,
    expectedPrimarySourceRevision,
    (notes) => [...notes, note],
    'Metadata changed before the note could be added; reload and try again',
  );
  if (result) log.debug({ actor, letterId, noteId: note.id }, 'AI note added');
  return result;
}

export async function updateAiNoteStatus(
  letterId: string,
  noteId: string,
  status: NoteStatus,
  expectedPrimarySourceRevision: number,
  actor: string,
): Promise<true | null> {
  const result = await mutateAiNotes(
    letterId,
    expectedPrimarySourceRevision,
    (notes) => {
      const index = notes.findIndex((note) => note.id === noteId);
      if (index === -1) throw new NotFoundError('Note not found');
      return notes.map((note, noteIndex) => noteIndex === index
        ? {
            ...note,
            status,
            resolved_at: new Date().toISOString(),
            resolved_by: actor,
          }
        : note);
    },
    'Metadata changed before the note could be updated; reload and try again',
  );
  if (result) log.debug({ actor, letterId, noteId, status }, 'AI note status updated');
  return result;
}

/**
 * Produces the note portion of a field mutation so the caller can commit the
 * field and its auto-resolutions in one compare-and-swap. No later source
 * epoch can therefore inherit an older field-change trigger.
 */
export function resolveAiNotesForChangedFields(
  value: unknown,
  changedFields: readonly string[],
  resolvedAt = new Date(),
): { notes: StructuredNote[]; resolvedCount: number } | null {
  if (changedFields.length === 0) return null;
  const fields = new Set(changedFields);
  const notes = structuredNotes(value);
  let resolvedCount = 0;
  const nextNotes = notes.map((note) => {
    if (
      note.status !== 'open'
      || !note.resolves_when
      || !fields.has(TRIGGER_FIELDS.get(note.resolves_when) ?? '')
    ) {
      return note;
    }
    resolvedCount += 1;
    return {
      ...note,
      status: 'resolved' as const,
      resolved_at: resolvedAt.toISOString(),
      resolved_by: 'auto',
    };
  });
  return resolvedCount > 0 ? { notes: nextNotes, resolvedCount } : null;
}
