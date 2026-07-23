import { unlink } from 'node:fs/promises';
import { Router } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db, canonicalPersons, letterPages, letterPersons, letters } from '../../../db/index.js';
import type { StructuredNote, NoteCategory, NotePriority } from '../../../ai/schemas/metadataV2.js';
import { savePageLineSegments } from '../../../services/line-segments.js';
import {
  createVersion,
  describePhoto,
  getVersions,
  regenerateTranscription,
  restoreVersion,
  transcribeExtras,
  transcribeLetterOnly,
  updateLetter,
  updateAiNotes,
  updateExtraContent,
  updatePhotoDescription,
  type UpdateLetterInput,
} from '../../../services/letter-operations.js';
import { resetLetterForProcessing } from '../../../services/letters.js';
import { executeRetagForLetter } from '../../../services/metadata-update.js';
import { checkNoteAutoResolutions } from '../../../services/note-resolution.js';
import { requestBackgroundWorkerRun } from '../../../services/processing-queue.js';
import { addAliasToCanonicalPerson } from '../../../services/entities/persons.js';
import { syncLetterParticipantsFromMetadata } from '../../../services/entities/participant-sync.js';
import { getAbsoluteStoragePath } from '../../../services/storage.js';
import {
  runEntityExtractionOnly,
  runMetadataExtractionV2,
  type ExtractionOptions,
  type MetadataRunOutcome,
} from '../../../pipeline/metadataV2.js';
import {
  buildHumanMetadataJobPatch,
  buildHumanMetadataNotesPatch,
  claimMetadataAfterTranscriptConfirmation,
  claimRequestedMetadata,
  observeMetadataState,
  observedMetadataRevisionConditions,
} from '../../../services/letter/metadata-job.js';
import { buildMetadataDocumentProjectionPatch } from '../../../services/letter/metadata-projection.js';
import { AppError, BadRequestError, NotFoundError } from '../../../utils/response-helpers.js';
import { isPlaceholderValue } from '../../../utils/placeholders.js';
import {
  addNoteSchema,
  confirmTranscriptSchema,
  reExtractSchema,
  retagMetadataSchema,
  toggleFlagSchema,
  updateIdentitySchema,
  updateLetterSchema,
  updateNoteStatusSchema,
  versionBodySchema,
} from './shared.js';
import {
  getUserId,
  parseOrThrow,
  requireFieldType,
  requireLetter,
  requireLetterDto,
  requirePositiveInt,
} from './helpers.js';

const router = Router();

type ObservedTranscript = Pick<
  Awaited<ReturnType<typeof requireLetter>>,
  'workflow' | 'transcriptionStatus' | 'transcriptionText'
>;

function observedTranscriptConditions(letterId: string, letter: ObservedTranscript) {
  return [
    eq(letters.id, letterId),
    eq(letters.workflow, letter.workflow),
    eq(letters.transcriptionStatus, letter.transcriptionStatus),
    letter.transcriptionText === null
      ? isNull(letters.transcriptionText)
      : eq(letters.transcriptionText, letter.transcriptionText),
  ];
}

function requireCompletedMetadataRun(outcome: MetadataRunOutcome): void {
  if (outcome.kind === 'completed') return;

  throw new AppError(
    409,
    `Metadata extraction did not complete because the run was ${outcome.kind.replace('_', ' ')}`,
  );
}

router.patch('/:letterId/flag', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { flagged } = parseOrThrow(toggleFlagSchema, req.body, 'Invalid request body');
    await requireLetter(letterId);

    await db.update(letters).set({
      flagged,
      flaggedAt: flagged ? new Date() : null,
      flaggedBy: flagged ? getUserId(req) : null,
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, flagged }, 'Letter flag toggled');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/process', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    await requireLetter(letterId);
    if (!await resetLetterForProcessing(letterId)) {
      throw new AppError(409, 'Cannot reprocess a letter while another job is running');
    }
    await requestBackgroundWorkerRun('letter:process');
    res.json({ message: 'Letter enqueued for processing', letterId });
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const updates = parseOrThrow(updateLetterSchema, req.body, 'Invalid request body');

    const updated = await updateLetter(letterId, updates as UpdateLetterInput, getUserId(req));
    if (!updated) throw new NotFoundError('Letter not found');

    const fieldTriggers: Array<[string | undefined | null, string]> = [
      [updates.sender, 'sender'],
      [updates.recipient, 'recipient'],
      [updates.locationWritten, 'locationWritten'],
      [updates.extractedDate, 'extractedDate'],
      [updates.transcriptionText, 'transcriptionText'],
    ];
    for (const [value, field] of fieldTriggers) {
      if (value !== undefined) {
        checkNoteAutoResolutions(letterId, field).catch(err =>
          req.log.warn({ letterId, field, err }, 'Note auto-resolution failed'));
      }
    }

    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/confirm-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { confirmedSender, confirmedRecipient } = confirmTranscriptSchema.parse(req.body ?? {});
    const letter = await requireLetter(letterId);
    if (letter.workflow !== 'TRANSCRIBED') {
      throw new BadRequestError('Letter must be in TRANSCRIBED state', { currentState: letter.workflow });
    }
    if (letter.transcriptionStatus === 'RUNNING') {
      throw new BadRequestError('Transcription is already in progress');
    }

    const confirmWhileTranscriptionIsIdle = async () => {
      const confirmationResult = await db.update(letters).set({
        transcriptConfirmedAt: new Date(),
        transcriptConfirmedBy: getUserId(req),
        updatedAt: new Date(),
      }).where(and(
        ...observedTranscriptConditions(letterId, letter),
      )).returning({ id: letters.id });

      if (confirmationResult.length === 0) {
        throw new AppError(409, 'Transcript changed before confirmation; reload and try again');
      }
    };

    // Trigger extraction if status is PENDING or FAILED (e.g. cleared by admin).
    // Skip only if already RUNNING or SUCCESS to avoid double-processing.
    const shouldExtract = letter.type === 'L'
      && (letter.metadataStatus === 'PENDING' || letter.metadataStatus === 'FAILED');
    if (shouldExtract && !letter.transcriptionText?.trim()) {
      throw new BadRequestError('Letter must have a transcription before extracting metadata');
    }
    if (shouldExtract && letter.entityExtractionStatus === 'RUNNING') {
      throw new BadRequestError('Entity extraction is already in progress');
    }

    if (shouldExtract) {
      const claim = await claimMetadataAfterTranscriptConfirmation(
        letterId,
        observeMetadataState(letter),
        getUserId(req),
      );

      if (claim) {
        const extractionOptions: ExtractionOptions = {};
        if (confirmedSender) extractionOptions.confirmedSender = confirmedSender;
        if (confirmedRecipient) extractionOptions.confirmedRecipient = confirmedRecipient;
        requireCompletedMetadataRun(
          await runMetadataExtractionV2(
            letterId,
            Object.keys(extractionOptions).length > 0 ? extractionOptions : undefined,
            claim,
          ),
        );
      } else {
        // A metadata worker may have won the claim. Confirm only if a
        // transcription attempt did not win the same race.
        await confirmWhileTranscriptionIsIdle();
        req.log.info({ letterId }, 'Metadata job already claimed by worker — skipping extraction');
      }
    } else {
      await confirmWhileTranscriptionIsIdle();
      req.log.info(
        { letterId, metadataStatus: letter.metadataStatus },
        'Skipping metadata extraction — status is not PENDING or FAILED',
      );
    }
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { confirmedSender, confirmedRecipient } = confirmTranscriptSchema.parse(req.body ?? {});
    const letter = await requireLetter(letterId);
    if (!letter.transcriptConfirmedAt) {
      throw new BadRequestError('Transcript must be confirmed before regenerating metadata');
    }
    if (letter.transcriptionStatus === 'RUNNING') {
      throw new BadRequestError('Transcription is already in progress');
    }
    if (letter.metadataStatus === 'RUNNING') {
      throw new BadRequestError('Metadata extraction is already in progress');
    }
    if (letter.entityExtractionStatus === 'RUNNING') {
      throw new BadRequestError('Entity extraction is already in progress');
    }
    if (letter.type !== 'L') {
      throw new BadRequestError('Metadata extraction is only available for letters');
    }
    if (!letter.transcriptionText?.trim()) {
      throw new BadRequestError('Letter must have a transcription before extracting metadata');
    }

    const claim = await claimRequestedMetadata(
      letterId,
      observeMetadataState(letter),
    );
    if (!claim) {
      throw new BadRequestError('Letter processing state changed; try again');
    }

    const extractionOptions: ExtractionOptions = {
      previousAiSender: letter.sender ?? undefined,
      previousAiRecipient: letter.recipient ?? undefined,
    };
    if (confirmedSender) extractionOptions.confirmedSender = confirmedSender;
    if (confirmedRecipient) extractionOptions.confirmedRecipient = confirmedRecipient;
    requireCompletedMetadataRun(
      await runMetadataExtractionV2(letterId, extractionOptions, claim),
    );
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-entities', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await requireLetter(letterId);
    if (!letter.transcriptionText) {
      throw new BadRequestError('Letter must have a transcription before extracting entities');
    }
    if (letter.transcriptionStatus === 'RUNNING') {
      throw new BadRequestError('Transcription is already in progress');
    }
    if (letter.entityExtractionStatus === 'RUNNING') {
      throw new BadRequestError('Entity extraction is already in progress');
    }
    if (letter.metadataStatus === 'RUNNING') {
      throw new BadRequestError('Metadata extraction is already in progress');
    }
    if (letter.metadataStatus !== 'SUCCESS') {
      throw new BadRequestError('Metadata extraction must complete before extracting entities');
    }

    // Reset to PENDING so the atomic claim in runEntityExtractionOnly succeeds
    const resetResult = await db.update(letters).set({
      entityExtractionStatus: 'PENDING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionError: null,
      updatedAt: new Date(),
    }).where(and(
      ...observedTranscriptConditions(letterId, letter),
      eq(letters.entityExtractionStatus, letter.entityExtractionStatus),
      eq(letters.metadataStatus, letter.metadataStatus),
    )).returning({ id: letters.id });

    if (resetResult.length === 0) {
      throw new BadRequestError('Letter processing state changed; try again');
    }

    await runEntityExtractionOnly(letterId);
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/generate-reading-view', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await requireLetter(letterId);
    if (!letter.transcriptionText) {
      throw new BadRequestError('Letter must have a transcription before generating reading view');
    }

    const { generateAndSaveReadingView } = await import('../../../services/letter/readingView.js');
    await generateAndSaveReadingView(letterId);
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/re-extract', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { confirmedSender, confirmedRecipient, mode } = parseOrThrow(reExtractSchema, req.body, 'Invalid request body');

    const letter = await requireLetter(letterId);
    if (!letter.transcriptionText) {
      throw new BadRequestError('Letter must have a transcription before re-extraction');
    }
    if (letter.transcriptionStatus === 'RUNNING') {
      throw new BadRequestError('Transcription is already in progress');
    }

    const metadataV2 = letter.metadataV2Json as Record<string, unknown> | null;
    const senderObj = metadataV2?.sender as { name?: string | null } | undefined;
    const recipientObj = metadataV2?.recipient as { name?: string | null } | undefined;

    const extractionOptions: ExtractionOptions = {
      confirmedSender,
      confirmedRecipient,
      previousAiSender: senderObj?.name ?? letter.sender ?? undefined,
      previousAiRecipient: recipientObj?.name ?? letter.recipient ?? undefined,
    };

    req.log.info(
      { letterId, mode, confirmedSender, confirmedRecipient },
      'Starting re-extraction with corrections',
    );

    if (mode === 'full' || mode === 'metadata_only') {
      if (letter.metadataStatus === 'RUNNING') {
        throw new BadRequestError('Metadata extraction is already in progress');
      }
      if (letter.entityExtractionStatus === 'RUNNING') {
        throw new BadRequestError('Entity extraction is already in progress');
      }
      if (letter.type !== 'L') {
        throw new BadRequestError('Metadata extraction is only available for letters');
      }
      const claim = await claimRequestedMetadata(
        letterId,
        observeMetadataState(letter),
      );
      if (!claim) {
        throw new BadRequestError('Letter processing state changed; try again');
      }

      requireCompletedMetadataRun(
        await runMetadataExtractionV2(letterId, extractionOptions, claim),
      );
    } else if (mode === 'entities_only') {
      if (letter.entityExtractionStatus === 'RUNNING') {
        throw new BadRequestError('Entity extraction is already in progress');
      }
      if (letter.metadataStatus === 'RUNNING') {
        throw new BadRequestError('Metadata extraction is already in progress');
      }
      if (letter.metadataStatus !== 'SUCCESS') {
        throw new BadRequestError('Metadata extraction must complete before extracting entities');
      }
      const resetResult = await db.update(letters).set({
        entityExtractionStatus: 'PENDING',
        entityExtractionRunId: null,
        entityExtractionRunRevision: null,
        entityExtractionError: null,
        updatedAt: new Date(),
      }).where(and(
        ...observedTranscriptConditions(letterId, letter),
        eq(letters.entityExtractionStatus, letter.entityExtractionStatus),
        eq(letters.metadataStatus, letter.metadataStatus),
      )).returning({ id: letters.id });

      if (resetResult.length === 0) {
        throw new BadRequestError('Letter processing state changed; try again');
      }

      await runEntityExtractionOnly(letterId, extractionOptions);
    }

    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.patch('/:letterId/identity', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { sender: newSender, recipient: newRecipient } = parseOrThrow(updateIdentitySchema, req.body, 'Invalid request body');

    if (newSender === undefined && newRecipient === undefined) {
      throw new BadRequestError('At least one of sender or recipient must be provided');
    }

    const letter = await requireLetter(letterId);
    const senderValue = newSender === undefined ? undefined : newSender || null;
    const recipientValue = newRecipient === undefined ? undefined : newRecipient || null;
    const senderChanged = senderValue !== undefined && senderValue !== letter.sender;
    const recipientChanged = recipientValue !== undefined && recipientValue !== letter.recipient;

    // Autosave and repeated form submissions commonly send the value already
    // on screen. A no-op must not revoke an AI owner or demote reviewed data.
    if (!senderChanged && !recipientChanged) {
      res.json(await requireLetterDto(letterId));
      return;
    }

    // Save name fields immediately
    const dbUpdates: Record<string, unknown> = {
      ...buildHumanMetadataJobPatch(),
      updatedAt: new Date(),
    };
    if (senderChanged) dbUpdates.sender = senderValue;
    if (recipientChanged) dbUpdates.recipient = recipientValue;

    Object.assign(dbUpdates, buildMetadataDocumentProjectionPatch(letter, {
      ...(senderChanged ? { sender: senderValue } : {}),
      ...(recipientChanged ? { recipient: recipientValue } : {}),
    }));

    const aliasesToPreserve = await db.transaction(async (tx) => {
      const identityUpdated = await tx
        .update(letters)
        .set(dbUpdates)
        .where(and(...observedMetadataRevisionConditions(letterId, letter)))
        .returning({ id: letters.id });
      if (identityUpdated.length === 0) {
        throw new AppError(409, 'Metadata changed before identity could be saved; reload and try again');
      }

      const candidates: Array<{
        personId: string;
        canonicalName: string;
        role: 'sender' | 'recipient';
      }> = [];
      const captureAliasCandidate = async (
        role: 'sender' | 'recipient',
        newName: string,
      ) => {
        const linked = await tx.query.letterPersons.findFirst({
          where: and(eq(letterPersons.letterId, letterId), eq(letterPersons.role, role)),
        });
        if (!linked) return;

        const person = await tx.query.canonicalPersons.findFirst({
          where: eq(canonicalPersons.id, linked.personId),
        });
        if (
          person
          && person.canonicalName.toLowerCase() !== newName.toLowerCase()
        ) {
          candidates.push({
            personId: linked.personId,
            canonicalName: person.canonicalName,
            role,
          });
        }
      };

      // Capture the old linked people before participant synchronization can
      // replace their role links. Alias writes remain a best-effort follow-up.
      if (senderChanged && senderValue && letter.sender && !isPlaceholderValue(letter.sender)) {
        await captureAliasCandidate('sender', senderValue);
      }
      if (recipientChanged && recipientValue && letter.recipient && !isPlaceholderValue(letter.recipient)) {
        await captureAliasCandidate('recipient', recipientValue);
      }

      await syncLetterParticipantsFromMetadata({
        letterId,
        sender: senderChanged ? senderValue : undefined,
        recipient: recipientChanged ? recipientValue : undefined,
        database: tx,
      });

      return candidates;
    });

    req.log.info({ letterId, senderValue, recipientValue, senderChanged, recipientChanged }, 'Identity update completed');

    if (senderChanged && senderValue) {
      checkNoteAutoResolutions(letterId, 'sender').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for sender'));
    }
    if (recipientChanged && recipientValue) {
      checkNoteAutoResolutions(letterId, 'recipient').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for recipient'));
    }

    await Promise.all(
      aliasesToPreserve.map(({ personId, canonicalName, role }) =>
        addAliasToCanonicalPerson(personId, canonicalName).catch(err =>
          req.log.warn({ letterId, role, err }, `Failed to add old ${role} as alias`)),
      ),
    );

    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/retag', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const change = parseOrThrow(retagMetadataSchema, req.body, 'Invalid request body');

    await requireLetter(letterId);
    const result = await executeRetagForLetter(letterId, change);

    req.log.info({ letterId, change, result }, 'Metadata re-tag request completed');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.get('/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const fieldType = requireFieldType(req.query.fieldType);
    await requireLetter(letterId);
    const versions = await getVersions(letterId, fieldType);
    res.json({ versions: versions || [] });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    await requireLetter(letterId);
    const versionInput = parseOrThrow(versionBodySchema, req.body, 'Invalid request body');
    const result = await createVersion(letterId, versionInput);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/versions/:versionNumber/restore', async (req, res, next) => {
  try {
    const { letterId, versionNumber } = req.params;
    const fieldType = requireFieldType(req.query.fieldType);
    const vn = requirePositiveInt(versionNumber);
    const result = await restoreVersion(letterId, vn, fieldType);
    if (!result) throw new NotFoundError('Letter or version not found');

    res.json(await requireLetterDto(letterId, 'Letter not found after restore'));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-transcription', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const includeExtras = req.query.includeExtras === 'true';
    const result = await regenerateTranscription(letterId, includeExtras);
    if (!result) throw new NotFoundError('Letter not found');

    res.json({
      letter: await requireLetterDto(letterId, 'Failed to fetch updated letter', 500),
      regenerated: {
        mainTranscript: result.mainTranscript,
        extras: result.extras,
        extrasCount: result.extrasCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/transcribe-letter', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await transcribeLetterOnly(letterId);
    if (!result) throw new NotFoundError('Letter not found');

    res.json({
      letter: await requireLetterDto(letterId, 'Failed to fetch updated letter', 500),
      transcribed: {
        pageCount: result.pageCount,
        textLength: result.textLength,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/transcribe-extras', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await transcribeExtras(letterId);
    if (!result) throw new NotFoundError('Letter not found');

    res.json({
      letter: await requireLetterDto(letterId, 'Failed to fetch updated letter', 500),
      transcribedCount: result.transcribedCount,
      extraContentStatus: result.extraContentStatus,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/describe-photo', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { photoDescriptionContext } = (req.body ?? {}) as {
      photoDescriptionContext?: string | null;
    };
    const result = await describePhoto(letterId, photoDescriptionContext ?? null);
    if (!result) throw new NotFoundError('Letter not found');

    res.json({
      letter: await requireLetterDto(letterId, 'Failed to fetch updated letter', 500),
      describedCount: result.describedCount,
      photoDescriptionStatus: result.photoDescriptionStatus,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { extraContent, extraContentTranscript } = (req.body ?? {}) as {
      extraContent?: string | null;
      extraContentTranscript?: string | null;
    };
    const nextExtraContent =
      extraContent !== undefined ? extraContent : extraContentTranscript;
    if (nextExtraContent === undefined) {
      throw new BadRequestError('extraContent field required');
    }

    const result = await updateExtraContent(letterId, nextExtraContent);
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/photo-description', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { photoDescription, photoDescriptionContext } = (req.body ?? {}) as {
      photoDescription?: string | null;
      photoDescriptionContext?: string | null;
    };

    if (photoDescription === undefined) {
      throw new BadRequestError('photoDescription field required');
    }

    const result = await updatePhotoDescription(letterId, {
      photoDescription,
      photoDescriptionContext,
    });
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/ai-notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await updateAiNotes(letterId, req.body?.aiNotes ?? []);
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const noteInput = parseOrThrow(addNoteSchema, req.body, 'Invalid request body');
    const letter = await requireLetter(letterId);

    const existingNotes: StructuredNote[] = Array.isArray(letter.aiNotes)
      ? (letter.aiNotes as StructuredNote[])
      : [];

    const newNote: StructuredNote = {
      id: crypto.randomUUID(),
      content: noteInput.content,
      category: noteInput.category as NoteCategory,
      priority: noteInput.priority as NotePriority,
      status: 'open',
      resolves_when: null,
      resolved_at: null,
      resolved_by: null,
      source: 'admin',
    };

    const noteAdded = await db
      .update(letters)
      .set({
        aiNotes: [...existingNotes, newNote],
        ...buildHumanMetadataNotesPatch(),
        updatedAt: new Date(),
      })
      .where(and(...observedMetadataRevisionConditions(letterId, letter)))
      .returning({ id: letters.id });
    if (noteAdded.length === 0) {
      throw new AppError(409, 'Metadata changed before the note could be added; reload and try again');
    }

    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.patch('/:letterId/notes/:noteId', async (req, res, next) => {
  try {
    const { letterId, noteId } = req.params;
    const { status } = parseOrThrow(updateNoteStatusSchema, req.body, 'Invalid request body');
    const letter = await requireLetter(letterId);

    const existingNotes: StructuredNote[] = Array.isArray(letter.aiNotes)
      ? (letter.aiNotes as StructuredNote[])
      : [];

    const noteIndex = existingNotes.findIndex(n => n.id === noteId);
    if (noteIndex === -1) throw new NotFoundError('Note not found');

    existingNotes[noteIndex] = {
      ...existingNotes[noteIndex],
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: getUserId(req),
    };

    const noteUpdated = await db
      .update(letters)
      .set({
        aiNotes: existingNotes,
        ...buildHumanMetadataNotesPatch(),
        updatedAt: new Date(),
      })
      .where(and(...observedMetadataRevisionConditions(letterId, letter)))
      .returning({ id: letters.id });
    if (noteUpdated.length === 0) {
      throw new AppError(409, 'Metadata changed before the note could be updated; reload and try again');
    }
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await requireLetter(letterId);

    const group = await db.select({ id: letters.id }).from(letters).where(
      and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
      )
    );
    const groupIds = group.map(r => r.id);

    let totalFiles = 0;
    for (const id of groupIds) {
      const pages = await db.select({
        storagePath: letterPages.storagePath,
      }).from(letterPages).where(eq(letterPages.letterId, id));

      for (const page of pages) {
        const absPath = getAbsoluteStoragePath(page.storagePath);
        await unlink(absPath).catch(() => {
        });
        totalFiles++;
      }

      await db.delete(letters).where(eq(letters.id, id));
    }

    req.log.info({ letterId, groupSize: groupIds.length, filesDeleted: totalFiles }, 'Letter group deleted');
    res.json({ message: 'Letter deleted successfully', letterId, deletedCount: groupIds.length });
  } catch (error) {
    next(error);
  }
});

// Save manually edited line segments for a page
router.patch('/pages/:pageId/line-segments', async (req, res, next) => {
  try {
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, req.params.pageId),
    });
    if (!page) throw new NotFoundError('Page not found');

    const { lineSegments } = req.body;
    if (!Array.isArray(lineSegments)) {
      throw new BadRequestError('lineSegments must be an array');
    }

    await savePageLineSegments(req.params.pageId, lineSegments);
    req.log.info({ pageId: req.params.pageId, segmentCount: lineSegments.length }, 'Line segments updated manually');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/pages/:pageId/line-segments', async (req, res, next) => {
  try {
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, req.params.pageId),
      columns: { lineSegments: true },
    });

    if (!page) throw new NotFoundError('Page not found');

    res.json({ lineSegments: Array.isArray(page.lineSegments) ? page.lineSegments : [] });
  } catch (error) {
    next(error);
  }
});

// Update segment trust state for a page
router.patch('/pages/:pageId/segment-trust', async (req, res, next) => {
  try {
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, req.params.pageId),
    });
    if (!page) throw new NotFoundError('Page not found');

    const { trustState } = req.body;
    if (trustState !== 'unverified' && trustState !== 'trusted') {
      throw new BadRequestError('trustState must be "unverified" or "trusted"');
    }

    await db.update(letterPages)
      .set({ segmentTrustState: trustState, updatedAt: new Date() })
      .where(eq(letterPages.id, req.params.pageId));

    req.log.info({ pageId: req.params.pageId, trustState }, 'Segment trust state updated');
    res.json({ ok: true, trustState });
  } catch (error) {
    next(error);
  }
});

// Bulk update segment trust state for all pages of a letter
router.patch('/:letterId/segment-trust', async (req, res, next) => {
  try {
    const { trustState } = req.body;
    if (trustState !== 'unverified' && trustState !== 'trusted') {
      throw new BadRequestError('trustState must be "unverified" or "trusted"');
    }

    const pages = await db.query.letterPages.findMany({
      where: eq(letterPages.letterId, req.params.letterId),
      columns: { id: true },
    });
    if (pages.length === 0) throw new NotFoundError('No pages found for letter');

    await db.update(letterPages)
      .set({ segmentTrustState: trustState, updatedAt: new Date() })
      .where(eq(letterPages.letterId, req.params.letterId));

    req.log.info({ letterId: req.params.letterId, trustState, pageCount: pages.length }, 'Segment trust state updated for all pages');
    res.json({ ok: true, trustState, pageCount: pages.length });
  } catch (error) {
    next(error);
  }
});

export default router;
