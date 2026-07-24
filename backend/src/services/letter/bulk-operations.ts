import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import {
  db,
  letters,
  letterPersons,
  letterPlaces,
  personRelationships,
} from '../../db/index.js';
import {
  requestBackgroundWorkerRun,
} from '../processing-queue.js';
import {
  metadataPrerequisiteConditions,
  transcriptionPrerequisiteConditions,
} from '../processing-eligibility.js';
import { syncLetterParticipantsFromMetadata } from '../entities/participant-sync.js';
import type { ParticipantSyncDatabase } from '../entities/participant-sync.js';
import {
  commitDirectIdentityField,
  isIdentityRevisionConflict,
  observeIdentityField,
  propagateName,
  propagatePlaceholderReplacement,
  type IdentityField,
  type IdentityMutationDatabase,
  type IdentityState,
} from '../name-propagation.js';
import { isPlaceholderValue } from '../../utils/placeholders.js';
import {
  assertCurrentPrimarySourceRevision,
} from './source-revision.js';
import {
  observeTranscriptionState,
  observedTranscriptionStateConditions,
} from './transcription-job.js';
import {
  observeMetadataState,
  observedMetadataStateConditions,
} from './metadata-job.js';
import { clearedEntityExtractionOwnership } from './entity-extraction-job.js';
import {
  isTranscribableType,
  log,
  type BulkClearResult,
  type BulkResult,
  type BulkSourceEntry,
  type BulkUpdateFieldEntry,
  type BulkUpdateFieldsResult,
} from './shared.js';

function expectedSourceCondition(source: BulkSourceEntry) {
  return and(
    eq(letters.id, source.letterId),
    eq(letters.primarySourceRevision, source.primarySourceRevision),
  );
}

export async function bulkTranscribe(
  sources: BulkSourceEntry[],
  overwrite = false,
): Promise<BulkResult> {
  log.info({ requestedCount: sources.length }, 'Bulk transcribe request received');

  if (sources.length === 0) {
    return { requested: 0, queued: 0, skipped: 0, skipReasons: [] };
  }

  const allRequested = await db.query.letters.findMany({
    where: inArray(letters.id, sources.map(({ letterId }) => letterId)),
    with: { pages: true },
  });

  const requestedById = new Map(allRequested.map(letter => [letter.id, letter]));
  const eligible: Array<{
    letter: (typeof allRequested)[number];
    source: BulkSourceEntry;
  }> = [];
  const skipReasons: BulkResult['skipReasons'] = [];

  for (const source of sources) {
    const letter = requestedById.get(source.letterId);
    if (!letter) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'NOT_FOUND',
        reason: 'Letter not found or deleted',
      });
    } else if (
      (letter.primarySourceRevision ?? 0) !== source.primarySourceRevision
    ) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      });
    } else if (!isTranscribableType(letter.type)) {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: `Type '${letter.type}' is not transcribable`,
      });
    } else if (letter.workflow !== 'UPLOADED' && !overwrite) {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: `Already past upload stage (workflow: ${letter.workflow})`,
      });
    } else if (letter.pages.length === 0) {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'No page images uploaded',
      });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Transcription already running',
      });
    } else if (letter.metadataStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Metadata extraction already running',
      });
    } else if (letter.entityExtractionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Entity extraction already running',
      });
    } else {
      eligible.push({ letter, source });
    }
  }

  if (eligible.length === 0) {
    log.info({ skipped: skipReasons.length }, 'Bulk transcribe: no eligible letters');
    return {
      requested: sources.length,
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
    };
  }

  const needsResetLetters = overwrite
    ? eligible.filter(({ letter }) => letter.workflow !== 'UPLOADED')
    : [];
  const needsReset = new Set(
    needsResetLetters.map(({ source }) => source.letterId),
  );
  const queueOnlyLetters = eligible.filter(
    ({ source }) => !needsReset.has(source.letterId),
  );

  const observedQueueState = (candidate: (typeof eligible)[number]) => and(
    expectedSourceCondition(candidate.source),
    ...transcriptionPrerequisiteConditions(),
    ...observedTranscriptionStateConditions(
      observeTranscriptionState(candidate.letter),
    ),
  );

  const queueLetters = async (
    candidates: typeof eligible,
    resetWorkflow: boolean,
  ) => {
    if (candidates.length === 0) return [];
    return db.update(letters).set({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      ...(resetWorkflow ? {
        workflow: 'UPLOADED' as const,
      } : {}),
      updatedAt: new Date(),
    }).where(or(...candidates.map(observedQueueState))).returning({ id: letters.id });
  };

  const queued = [
    ...await queueLetters(needsResetLetters, true),
    ...await queueLetters(queueOnlyLetters, false),
  ];
  const queuedIds = queued.map(letter => letter.id);
  const queuedIdSet = new Set(queuedIds);
  for (const { source } of eligible) {
    if (!queuedIdSet.has(source.letterId)) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Transcription eligibility changed before it could be queued',
      });
    }
  }

  if (queuedIds.length === 0) {
    log.info({ skipped: skipReasons.length }, 'Bulk transcribe: no letters remained eligible');
    return {
      requested: sources.length,
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
    };
  }

  await requestBackgroundWorkerRun('bulk:transcription');

  log.info(
    { queued: queuedIds.length, skipped: skipReasons.length },
    'Bulk transcribe queued',
  );
  return {
    requested: sources.length,
    queued: queuedIds.length,
    skipped: skipReasons.length,
    skipReasons,
  };
}

/*
 * Each source is classified from the same snapshot used to build the guarded
 * update below. A failed update predicate is reported as a truthful skip
 * instead of being counted as queued.
 */
export async function bulkExtractMetadata(
  sources: BulkSourceEntry[],
): Promise<BulkResult> {
  if (sources.length === 0) {
    return {
      requested: 0,
      queued: 0,
      skipped: 0,
      skipReasons: [],
      unconfirmedCount: 0,
    };
  }

  const allRequested = await db.query.letters.findMany({
    where: inArray(letters.id, sources.map(({ letterId }) => letterId)),
  });

  const requestedById = new Map(allRequested.map(letter => [letter.id, letter]));
  const eligible: Array<{
    letter: (typeof allRequested)[number];
    source: BulkSourceEntry;
  }> = [];
  const skipReasons: BulkResult['skipReasons'] = [];
  let unconfirmedCount = 0;

  for (const source of sources) {
    const letter = requestedById.get(source.letterId);
    if (!letter) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'NOT_FOUND',
        reason: 'Letter not found or deleted',
      });
    } else if (
      (letter.primarySourceRevision ?? 0) !== source.primarySourceRevision
    ) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      });
    } else if (letter.type !== 'L') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: `Type '${letter.type}' does not support metadata extraction (only letters)`,
      });
    } else if (!isTranscribableType(letter.type)) {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: `Type '${letter.type}' is not transcribable`,
      });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Transcription already running',
      });
    } else if (letter.workflow === 'UPLOADED') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Needs transcription first (workflow: UPLOADED)',
      });
    } else if (letter.workflow !== 'TRANSCRIBED') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: `Already processed (workflow: ${letter.workflow})`,
      });
    } else if (!letter.transcriptConfirmedAt) {
      unconfirmedCount++;
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Transcript not yet confirmed',
      });
    } else if (!letter.transcriptionText?.trim()) {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'No transcript text available',
      });
    } else if (letter.metadataStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Metadata extraction already running',
      });
    } else if (letter.entityExtractionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Entity extraction already running',
      });
    } else if (letter.extraContentJobStatus === 'RUNNING') {
      skipReasons.push({
        letterId: letter.id,
        code: 'INELIGIBLE',
        reason: 'Extra-content transcription already running',
      });
    } else {
      eligible.push({ letter, source });
    }
  }

  if (eligible.length === 0) {
    return {
      requested: sources.length,
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
      unconfirmedCount,
    };
  }

  const queuedRows = await db.update(letters).set({
    metadataStatus: 'PENDING',
    metadataRunId: null,
    metadataRunRevision: null,
    metadataLeaseExpiresAt: null,
    metadataLeaseRunId: null,
    metadataClaimKind: null,
    metadataRevision: sql`${letters.metadataRevision} + 1`,
    metadataError: null,
    metadataAttemptCount: 0,
    deadLetter: false,
    updatedAt: new Date(),
  }).where(or(...eligible.map(({ letter, source }) => and(
    expectedSourceCondition(source),
    ...metadataPrerequisiteConditions(),
    ...observedMetadataStateConditions(observeMetadataState(letter)),
  )))).returning({ id: letters.id });

  const queuedIds = queuedRows.map(row => row.id);
  const queuedIdSet = new Set(queuedIds);
  for (const { source } of eligible) {
    if (!queuedIdSet.has(source.letterId)) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Metadata eligibility changed before it could be queued',
      });
    }
  }

  if (queuedIds.length > 0) {
    await requestBackgroundWorkerRun('bulk:metadata');
  }

  return {
    requested: sources.length,
    queued: queuedIds.length,
    skipped: skipReasons.length,
    skipReasons,
    unconfirmedCount,
  };
}

export async function bulkClearTranscriptions(
  sources: BulkSourceEntry[],
): Promise<BulkClearResult> {
  log.info({ count: sources.length }, 'Bulk clear transcriptions requested');

  if (sources.length === 0) {
    return { requested: 0, applied: 0, skipped: 0, skipReasons: [] };
  }

  const allRequested = await db.query.letters.findMany({
    where: inArray(letters.id, sources.map(({ letterId }) => letterId)),
  });
  const requestedById = new Map(allRequested.map(letter => [letter.id, letter]));
  const eligibleSources: BulkSourceEntry[] = [];
  const skipReasons: BulkClearResult['skipReasons'] = [];

  for (const source of sources) {
    const letter = requestedById.get(source.letterId);
    if (!letter) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'NOT_FOUND',
        reason: 'Letter not found or deleted',
      });
    } else if (
      (letter.primarySourceRevision ?? 0) !== source.primarySourceRevision
    ) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Transcription is running',
      });
    } else if (letter.metadataStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Metadata extraction is running',
      });
    } else if (letter.entityExtractionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Entity extraction is running',
      });
    } else if (letter.extraContentJobStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Extra-content transcription is running',
      });
    } else {
      eligibleSources.push(source);
    }
  }

  if (eligibleSources.length === 0) {
    return {
      requested: sources.length,
      applied: 0,
      skipped: skipReasons.length,
      skipReasons,
    };
  }

  const clearedIds = await db.transaction(async (tx) => {
    const cleared = await tx.update(letters).set({
      workflow: 'UPLOADED',
      transcriptionText: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: 'Cleared by admin',
      transcriptionAttemptCount: 0,
      deadLetter: false,
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'FAILED' as const,
      extraContentJobError: 'Cleared by admin',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      metadataStatus: 'FAILED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      metadataError: 'Cleared by admin',
      metadataAttemptCount: 0,
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      tags: null,
      metadataJson: null,
      metadataV2Json: null,
      emotionalTone: null,
      senderRecipientRelationship: null,
      primaryTopics: null,
      aiNotes: null,
      entityExtractionJson: null,
      entityExtractionStatus: 'FAILED',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: 'Cleared by admin',
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptPublished: false,
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      updatedAt: new Date(),
    }).where(
      and(
        or(...eligibleSources.map(expectedSourceCondition)),
        ne(letters.transcriptionStatus, 'RUNNING'),
        ne(letters.metadataStatus, 'RUNNING'),
        ne(letters.entityExtractionStatus, 'RUNNING'),
        ne(letters.extraContentJobStatus, 'RUNNING'),
      ),
    ).returning({ id: letters.id });

    const ids = cleared.map(row => row.id);
    if (ids.length > 0) {
      await tx.delete(letterPersons).where(inArray(letterPersons.letterId, ids));
      await tx.delete(letterPlaces).where(inArray(letterPlaces.letterId, ids));
      await tx.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, ids));
    }
    return ids;
  });

  const clearedIdSet = new Set(clearedIds);
  for (const source of eligibleSources) {
    if (!clearedIdSet.has(source.letterId)) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Letter source or processing state changed before it could be cleared',
      });
    }
  }

  log.info(
    { applied: clearedIds.length, skipped: skipReasons.length },
    'Bulk clear transcriptions completed',
  );

  return {
    requested: sources.length,
    applied: clearedIds.length,
    skipped: skipReasons.length,
    skipReasons,
  };
}

async function updateBulkIdentityField(
  letter: IdentityState,
  field: IdentityField,
  value: string | null,
  expectedPrimarySourceRevision: number,
  database: IdentityMutationDatabase & ParticipantSyncDatabase,
): Promise<{ letter: IdentityState; changed: boolean }> {
  assertCurrentPrimarySourceRevision(
    letter.primarySourceRevision ?? 0,
    expectedPrimarySourceRevision,
    'Letter source changed before names could be saved; reload the dashboard and try again',
  );
  if (letter[field] === value) return { letter, changed: false };

  const observed = observeIdentityField(letter, field);
  let committed: IdentityState;

  if (value === null) {
    committed = await commitDirectIdentityField(
      { letter, field, value },
      database,
    );
  } else {
    try {
      const result = isPlaceholderValue(letter[field]) || !letter[field]
        ? await propagatePlaceholderReplacement({
            letterId: letter.id,
            field,
          newName: value,
          observed,
        }, database)
        : await propagateName({
            letterId: letter.id,
            field,
            oldName: letter[field],
          newName: value,
          observed,
        }, database);
      committed = result.letter;
    } catch (error) {
      if (isIdentityRevisionConflict(error)) throw error;

      log.warn(
        { letterId: letter.id, field, error },
        'Bulk identity propagation failed, using guarded direct update',
      );
      committed = await commitDirectIdentityField(
        { letter, field, value },
        database,
      );
    }
  }

  await syncLetterParticipantsFromMetadata({
    letterId: letter.id,
    [field]: value,
    database,
  });

  return { letter: committed, changed: true };
}

export async function bulkUpdateFields(updates: BulkUpdateFieldEntry[]): Promise<BulkUpdateFieldsResult> {
  log.info({ updateCount: updates.length }, 'Bulk update fields request received');

  let applied = 0;
  let updated = 0;
  const skipReasons: BulkUpdateFieldsResult['skipReasons'] = [];
  for (const update of updates) {
    const sender = update.sender !== undefined ? (update.sender || null) : undefined;
    const recipient = update.recipient !== undefined ? (update.recipient || null) : undefined;

    try {
      const changed = await db.transaction(async (tx) => {
        const letter = await tx.query.letters.findFirst({
          where: eq(letters.id, update.letterId),
        });
        if (!letter) return null;
        assertCurrentPrimarySourceRevision(
          letter.primarySourceRevision ?? 0,
          update.primarySourceRevision,
          'Letter source changed before names could be saved; reload the dashboard and try again',
        );

        let current: IdentityState = letter;
        let entryChanged = false;
        if (sender !== undefined) {
          const result = await updateBulkIdentityField(
            current,
            'sender',
            sender,
            update.primarySourceRevision,
            tx,
          );
          current = result.letter;
          entryChanged ||= result.changed;
        }
        if (recipient !== undefined) {
          const result = await updateBulkIdentityField(
            current,
            'recipient',
            recipient,
            update.primarySourceRevision,
            tx,
          );
          current = result.letter;
          entryChanged ||= result.changed;
        }
        return entryChanged;
      });
      if (changed === null) {
        skipReasons.push({ letterId: update.letterId, code: 'NOT_FOUND' });
        continue;
      }
      applied += 1;
      if (changed) updated += 1;
    } catch (error) {
      const latest = await db.query.letters.findFirst({
        where: eq(letters.id, update.letterId),
      });
      const code = !latest
        ? 'NOT_FOUND'
        : (latest.primarySourceRevision ?? 0) !== update.primarySourceRevision
          ? 'SOURCE_CHANGED'
          : isIdentityRevisionConflict(error)
            ? 'WRITE_CONFLICT'
            : 'MUTATION_FAILED';
      skipReasons.push({ letterId: update.letterId, code });
      log.warn(
        { letterId: update.letterId, code, error },
        'Bulk identity update skipped',
      );
    }
  }

  log.info(
    { requested: updates.length, applied, skipped: skipReasons.length, updated },
    'Bulk update fields completed',
  );

  return {
    requested: updates.length,
    applied,
    skipped: skipReasons.length,
    updated,
    skipReasons,
  };
}

export async function bulkClearMetadata(
  sources: BulkSourceEntry[],
): Promise<BulkClearResult> {
  if (sources.length === 0) {
    return { requested: 0, applied: 0, skipped: 0, skipReasons: [] };
  }

  const allRequested = await db.query.letters.findMany({
    where: inArray(letters.id, sources.map(({ letterId }) => letterId)),
  });
  const requestedById = new Map(allRequested.map(letter => [letter.id, letter]));
  const eligibleSources: BulkSourceEntry[] = [];
  const skipReasons: BulkClearResult['skipReasons'] = [];

  for (const source of sources) {
    const letter = requestedById.get(source.letterId);
    if (!letter) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'NOT_FOUND',
        reason: 'Letter not found or deleted',
      });
    } else if (
      (letter.primarySourceRevision ?? 0) !== source.primarySourceRevision
    ) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Transcription is running',
      });
    } else if (letter.metadataStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Metadata extraction is running',
      });
    } else if (letter.entityExtractionStatus === 'RUNNING') {
      skipReasons.push({
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Entity extraction is running',
      });
    } else {
      eligibleSources.push(source);
    }
  }

  if (eligibleSources.length === 0) {
    return {
      requested: sources.length,
      applied: 0,
      skipped: skipReasons.length,
      skipReasons,
    };
  }

  const metadataFields = {
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    tags: null,
    metadataStatus: 'FAILED' as const,
    metadataRunId: null,
    metadataRunRevision: null,
    metadataLeaseExpiresAt: null,
    metadataLeaseRunId: null,
    metadataClaimKind: null,
    metadataRevision: sql`${letters.metadataRevision} + 1`,
    metadataError: 'Cleared by admin',
    metadataAttemptCount: 0,
    deadLetter: false,
    metadataJson: null,
    metadataV2Json: null,
    emotionalTone: null,
    senderRecipientRelationship: null,
    primaryTopics: null,
    aiNotes: null,
    entityExtractionJson: null,
    entityExtractionStatus: 'FAILED' as const,
    ...clearedEntityExtractionOwnership(),
    entityExtractionError: 'Cleared by admin',
    metadataContentStatus: 'EMPTY' as const,
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    metadataPublished: false,
    updatedAt: new Date(),
  };

  const clearedIds = await db.transaction(async (tx) => {
    const cleared = await tx.update(letters).set({
      ...metadataFields,
      workflow: sql`CASE
        WHEN ${letters.transcriptionText} IS NULL THEN 'UPLOADED'
        ELSE 'TRANSCRIBED'
      END`,
    }).where(and(
      or(...eligibleSources.map(expectedSourceCondition)),
      ne(letters.transcriptionStatus, 'RUNNING'),
      ne(letters.metadataStatus, 'RUNNING'),
      ne(letters.entityExtractionStatus, 'RUNNING'),
    )).returning({ id: letters.id });

    const ids = cleared.map(row => row.id);
    if (ids.length > 0) {
      await tx.delete(letterPersons).where(inArray(letterPersons.letterId, ids));
      await tx.delete(letterPlaces).where(inArray(letterPlaces.letterId, ids));
      await tx.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, ids));
    }
    return ids;
  });

  const clearedIdSet = new Set(clearedIds);
  for (const source of eligibleSources) {
    if (!clearedIdSet.has(source.letterId)) {
      skipReasons.push({
        letterId: source.letterId,
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Letter source or processing state changed before metadata could be cleared',
      });
    }
  }

  return {
    requested: sources.length,
    applied: clearedIds.length,
    skipped: skipReasons.length,
    skipReasons,
  };
}
