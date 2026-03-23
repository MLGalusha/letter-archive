import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  letters,
  letterPersons,
  letterPlaces,
  personRelationships,
} from '../../db/index.js';
import {
  getProcessingStatus,
  processLettersAsync,
  resetProcessingState,
} from '../processing-queue.js';
import { syncLetterParticipantsFromMetadata } from '../entities/participant-sync.js';
import { propagateName } from '../name-propagation.js';
import {
  log,
  type BulkClearResult,
  type BulkResult,
  type BulkUpdateFieldEntry,
  type BulkUpdateFieldsResult,
} from './shared.js';

export async function bulkTranscribe(letterIds: string[]): Promise<BulkResult> {
  log.info({ requestedCount: letterIds.length }, 'Bulk transcribe request received');

  const allRequested = await db.query.letters.findMany({
    where: and(
      inArray(letters.id, letterIds)
    ),
    with: { pages: true },
  });

  const foundIds = new Set(allRequested.map(l => l.id));
  const eligible: typeof allRequested = [];
  const skipReasons: Array<{ letterId: string; reason: string }> = [];

  for (const id of letterIds) {
    if (!foundIds.has(id)) {
      skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
    }
  }

  for (const letter of allRequested) {
    if (letter.type !== 'L') {
      skipReasons.push({ letterId: letter.id, reason: `Type is '${letter.type}' (only type 'L' supported)` });
    } else if (letter.workflow !== 'UPLOADED') {
      skipReasons.push({ letterId: letter.id, reason: `Already past upload stage (workflow: ${letter.workflow})` });
    } else if (letter.pages.length === 0) {
      skipReasons.push({ letterId: letter.id, reason: 'No page images uploaded' });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({ letterId: letter.id, reason: 'Transcription already running' });
    } else {
      eligible.push(letter);
    }
  }

  if (eligible.length === 0) {
    log.info({ skipped: skipReasons.length }, 'Bulk transcribe: no eligible letters');
    return { queued: 0, skipped: skipReasons.length, skipReasons, processing: false };
  }

  for (const letter of eligible) {
    await db.update(letters).set({
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letter.id));
  }

  if (getProcessingStatus().isRunning) {
    log.info(
      { queued: eligible.length, skipped: skipReasons.length },
      'Bulk transcribe queued (another batch running)',
    );
    return { queued: eligible.length, skipped: skipReasons.length, skipReasons, processing: false };
  }

  resetProcessingState(eligible.length);
  processLettersAsync(eligible.map(l => l.id), 'transcription');

  log.info(
    { queued: eligible.length, skipped: skipReasons.length },
    'Bulk transcribe started immediately',
  );
  return { queued: eligible.length, skipped: skipReasons.length, skipReasons, processing: true };
}

export async function bulkExtractMetadata(
  letterIds: string[],
  skipConfirmationCheck = false,
): Promise<BulkResult> {
  const allRequested = await db.query.letters.findMany({
    where: and(
      inArray(letters.id, letterIds)
    ),
  });

  const foundIds = new Set(allRequested.map(l => l.id));
  const eligible: typeof allRequested = [];
  const skipReasons: Array<{ letterId: string; reason: string }> = [];
  let unconfirmedCount = 0;

  for (const id of letterIds) {
    if (!foundIds.has(id)) {
      skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
    }
  }

  for (const letter of allRequested) {
    if (letter.type !== 'L') {
      skipReasons.push({ letterId: letter.id, reason: `Type is '${letter.type}' (only type 'L' supported)` });
    } else if (letter.workflow === 'UPLOADED') {
      skipReasons.push({ letterId: letter.id, reason: 'Needs transcription first (workflow: UPLOADED)' });
    } else if (letter.workflow !== 'TRANSCRIBED') {
      skipReasons.push({ letterId: letter.id, reason: `Already processed (workflow: ${letter.workflow})` });
    } else if (!letter.transcriptConfirmedAt && !skipConfirmationCheck) {
      unconfirmedCount++;
      skipReasons.push({ letterId: letter.id, reason: 'Transcript not yet confirmed' });
    } else if (letter.metadataStatus === 'RUNNING') {
      skipReasons.push({ letterId: letter.id, reason: 'Metadata extraction already running' });
    } else {
      eligible.push(letter);
    }
  }

  if (unconfirmedCount > 0 && !skipConfirmationCheck && eligible.length === 0) {
    return {
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  if (eligible.length === 0) {
    return {
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  for (const letter of eligible) {
    await db.update(letters).set({
      metadataStatus: 'PENDING',
      metadataError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letter.id));
  }

  if (getProcessingStatus().isRunning) {
    return {
      queued: eligible.length,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  resetProcessingState(eligible.length);
  processLettersAsync(eligible.map(l => l.id), 'metadata');

  return {
    queued: eligible.length,
    skipped: skipReasons.length,
    skipReasons,
    processing: true,
    unconfirmedCount,
  };
}

export async function bulkClearTranscriptions(letterIds: string[]): Promise<BulkClearResult> {
  log.info({ count: letterIds.length }, 'Bulk clear transcriptions requested');

  await db.delete(letterPersons).where(inArray(letterPersons.letterId, letterIds));
  await db.delete(letterPlaces).where(inArray(letterPlaces.letterId, letterIds));
  await db.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, letterIds));

  await db.update(letters).set({
    workflow: 'UPLOADED',
    transcriptionText: null,
    transcriptConfirmedAt: null,
    transcriptConfirmedBy: null,
    transcriptionStatus: 'FAILED',
    transcriptionError: 'Cleared by admin',
    transcriptionAttemptCount: 0,
    extraContentTranscript: null,
    extraContentStatus: 'EMPTY',
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
    metadataStatus: 'FAILED',
    metadataError: 'Cleared by admin',
    metadataAttemptCount: 0,
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    extractedDateConfidence: null,
    tags: null,
    metadataJson: null,
    metadataV2Json: null,
    emotionalTone: null,
    senderRecipientRelationship: null,
    primaryTopics: null,
    aiNotes: null,
    entityExtractionJson: null,
    entityExtractionStatus: 'FAILED',
    entityExtractionError: 'Cleared by admin',
    transcriptStatus: 'EMPTY',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    metadataContentStatus: 'EMPTY',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    updatedAt: new Date(),
  }).where(
    and(
      inArray(letters.id, letterIds)
    ),
  );

  log.info({ updated: letterIds.length }, 'Bulk clear transcriptions completed');

  return {
    message: 'Transcriptions cleared',
    updated: letterIds.length,
  };
}

export async function bulkUpdateFields(updates: BulkUpdateFieldEntry[]): Promise<BulkUpdateFieldsResult> {
  log.info({ updateCount: updates.length }, 'Bulk update fields request received');

  let successCount = 0;
  for (const update of updates) {
    const sender = update.sender !== undefined ? (update.sender || null) : undefined;
    const recipient = update.recipient !== undefined ? (update.recipient || null) : undefined;

    if (sender === undefined && recipient === undefined) continue;

    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, update.letterId),
    });
    if (!letter) continue;

    let didPropagate = false;

    if (sender !== undefined && sender !== null && letter.sender && letter.sender !== sender) {
      try {
        await propagateName({ letterId: update.letterId, field: 'sender', oldName: letter.sender, newName: sender });
        didPropagate = true;
      } catch (err) {
        log.warn({ letterId: update.letterId, err }, 'Bulk propagation failed for sender, using simple update');
      }
    }

    if (recipient !== undefined && recipient !== null && letter.recipient && letter.recipient !== recipient) {
      try {
        await propagateName({ letterId: update.letterId, field: 'recipient', oldName: letter.recipient, newName: recipient });
        didPropagate = true;
      } catch (err) {
        log.warn({ letterId: update.letterId, err }, 'Bulk propagation failed for recipient, using simple update');
      }
    }

    if (!didPropagate) {
      const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

      if (sender !== undefined) {
        dbUpdates.sender = sender;
      }
      if (recipient !== undefined) {
        dbUpdates.recipient = recipient;
      }

      if (Object.keys(dbUpdates).length > 1) {
        await db.update(letters).set(dbUpdates).where(eq(letters.id, update.letterId));
      }
    }

    if (sender !== undefined || recipient !== undefined) {
      await syncLetterParticipantsFromMetadata({
        letterId: update.letterId,
        sender: sender !== undefined ? sender : undefined,
        recipient: recipient !== undefined ? recipient : undefined,
      });
    }

    successCount++;
  }

  log.info({ updated: successCount }, 'Bulk update fields completed');

  return {
    message: 'Fields updated',
    updated: successCount,
  };
}

export async function bulkClearMetadata(letterIds: string[]): Promise<BulkClearResult> {
  await db.delete(letterPersons).where(inArray(letterPersons.letterId, letterIds));
  await db.delete(letterPlaces).where(inArray(letterPlaces.letterId, letterIds));
  await db.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, letterIds));

  await db.update(letters).set({
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    extractedDateConfidence: null,
    tags: null,
    metadataStatus: 'FAILED',
    metadataError: 'Cleared by admin',
    metadataAttemptCount: 0,
    metadataJson: null,
    metadataV2Json: null,
    emotionalTone: null,
    senderRecipientRelationship: null,
    primaryTopics: null,
    aiNotes: null,
    entityExtractionJson: null,
    entityExtractionStatus: 'FAILED',
    entityExtractionError: 'Cleared by admin',
    metadataContentStatus: 'EMPTY',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    workflow: 'TRANSCRIBED',
    updatedAt: new Date(),
  }).where(
    and(
      inArray(letters.id, letterIds)
    ),
  );

  return {
    message: 'Metadata cleared',
    updated: letterIds.length,
  };
}
