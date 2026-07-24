import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { letterPages, letters } from '../db/index.js';
import {
  isTranscribableType,
  TRANSCRIBABLE_TYPES,
} from './letter/shared.js';

interface TranscriptionStageState {
  type: string;
  metadataStatus: string;
  entityExtractionStatus: string;
}

type TranscriptionDownstreamState = Pick<
  TranscriptionStageState,
  'metadataStatus' | 'entityExtractionStatus'
>;

interface MetadataStageState {
  type: string;
  transcriptionStatus: string;
  transcriptionText: string | null;
  transcriptConfirmedAt: Date | null;
  entityExtractionStatus: string;
  extraContentJobStatus: string;
}

/** In-memory half of the transcription prerequisites; SQL also requires a page. */
export function hasIdleTranscriptionDownstream(
  state: TranscriptionDownstreamState,
): boolean {
  return (
    state.metadataStatus !== 'RUNNING'
    && state.entityExtractionStatus !== 'RUNNING'
  );
}

export function isTranscriptionStateEligible(
  state: TranscriptionStageState,
): boolean {
  return (
    isTranscribableType(state.type)
    && hasIdleTranscriptionDownstream(state)
  );
}

export function isMetadataSourceEligible(state: MetadataStageState): boolean {
  return (
    state.type === 'L'
    && state.transcriptionStatus !== 'RUNNING'
    && state.entityExtractionStatus !== 'RUNNING'
    && state.extraContentJobStatus !== 'RUNNING'
    && Boolean(state.transcriptionText?.trim())
  );
}

export function isMetadataStateEligible(state: MetadataStageState): boolean {
  return (
    isMetadataSourceEligible(state)
    && state.transcriptConfirmedAt !== null
  );
}

export function transcriptionPrerequisiteConditions(): SQL[] {
  return [
    inArray(letters.type, [...TRANSCRIBABLE_TYPES]),
    ne(letters.metadataStatus, 'RUNNING'),
    ne(letters.entityExtractionStatus, 'RUNNING'),
    sql`EXISTS (
      SELECT 1
      FROM ${letterPages}
      WHERE ${letterPages.letterId} = ${letters.id}
    )`,
  ];
}

export function metadataPrerequisiteConditions(): SQL[] {
  return [
    eq(letters.type, 'L'),
    ne(letters.transcriptionStatus, 'RUNNING'),
    ne(letters.entityExtractionStatus, 'RUNNING'),
    ne(letters.extraContentJobStatus, 'RUNNING'),
    isNotNull(letters.transcriptConfirmedAt),
    isNotNull(letters.transcriptionText),
    sql`${letters.transcriptionText} ~ '[^[:space:]]'`,
  ];
}

export function entityExtractionPrerequisiteConditions(): SQL[] {
  return [
    eq(letters.type, 'L'),
    ne(letters.transcriptionStatus, 'RUNNING'),
    eq(letters.metadataStatus, 'SUCCESS'),
  ];
}

/**
 * Extra-content work belongs to a primary letter that has at least one related
 * telegram, cover, or ephemera record with the same archive identity.
 */
export function extraContentPrerequisiteConditions(): SQL[] {
  return [
    eq(letters.type, 'L'),
    sql`EXISTS (
      SELECT 1 FROM letters AS rel
      WHERE rel.collection_id = ${letters.collectionId}
        AND rel.date_raw = ${letters.dateRaw}
        AND rel.type_sequence = ${letters.typeSequence}
        AND rel.type IN ('T', 'C', 'E')
        AND rel.id != ${letters.id}
    )`,
  ];
}

/**
 * Durable queue predicates shared by API enqueueing, queue snapshots, worker
 * polling, and worker wake/exit decisions. Keeping these predicates together
 * prevents one runtime from seeing work that another runtime considers absent.
 */
export function queuedTranscriptionConditions(): SQL[] {
  return [
    ...transcriptionPrerequisiteConditions(),
    eq(letters.workflow, 'UPLOADED'),
    eq(letters.transcriptionStatus, 'PENDING'),
    isNull(letters.transcriptionRunId),
    or(
      and(
        isNull(letters.transcriptionLeaseExpiresAt),
        isNull(letters.transcriptionClaimKind),
      ),
      and(
        isNotNull(letters.transcriptionLeaseExpiresAt),
        isNotNull(letters.transcriptionClaimKind),
      ),
    )!,
    eq(letters.deadLetter, false),
  ];
}

export function queuedMetadataConditions(): SQL[] {
  return [
    ...metadataPrerequisiteConditions(),
    eq(letters.workflow, 'TRANSCRIBED'),
    eq(letters.metadataStatus, 'PENDING'),
    isNull(letters.metadataRunId),
    isNull(letters.metadataRunRevision),
    isNull(letters.metadataLeaseExpiresAt),
    isNull(letters.metadataLeaseRunId),
    isNull(letters.metadataClaimKind),
    eq(letters.deadLetter, false),
  ];
}

export function queuedEntityExtractionConditions(): SQL[] {
  return [
    ...entityExtractionPrerequisiteConditions(),
    eq(letters.entityExtractionStatus, 'PENDING'),
    eq(letters.deadLetter, false),
  ];
}

export function queuedExtraContentConditions(): SQL[] {
  return [
    ...extraContentPrerequisiteConditions(),
    eq(letters.extraContentJobStatus, 'PENDING'),
  ];
}
