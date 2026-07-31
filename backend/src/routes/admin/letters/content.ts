import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, canonicalPersons, letterPages, letterPersons, letters } from '../../../db/index.js';
import {
  getPageGeometryEnvelope,
  savePageLineSegments,
  updateLetterSegmentTrust,
  updatePageSegmentTrust,
  type PageGeometryMutationResult,
} from '../../../services/line-segments.js';
import {
  adaptKrakenNativePageLayoutV2,
} from '../../../services/kraken-page-layout-adapter.js';
import {
  savePageLayoutV2,
} from '../../../services/page-layout.js';
import {
  createPageGeometryProposalRepository,
  type SavePageGeometryProposalResult,
  type StoredPageGeometryProposal,
} from '../../../services/page-geometry-proposals.js';
import { validateStoredPageLayout } from '../../../services/stored-page-layout.js';
import {
  createVersion,
  describePhoto,
  getVersions,
  regenerateTranscription,
  restoreVersion,
  transcribeExtras,
  transcribeLetterOnly,
  updateLetter,
  updateExtraContent,
  updatePhotoDescription,
  type UpdateLetterInput,
} from '../../../services/letter-operations.js';
import {
  addAiNote,
  resolveAiNotesForChangedFields,
  updateAiNotes,
  updateAiNoteStatus,
} from '../../../services/letter/ai-notes.js';
import { resetLetterForProcessing } from '../../../services/letters.js';
import { executeRetagForLetter } from '../../../services/metadata-update.js';
import { requestBackgroundWorkerRun } from '../../../services/processing-queue.js';
import { addAliasToCanonicalPerson } from '../../../services/entities/persons.js';
import { syncLetterParticipantsFromMetadata } from '../../../services/entities/participant-sync.js';
import { deleteCorrespondenceGroup } from '../../../services/letter/correspondence-deletion.js';
import {
  runEntityExtractionOnly,
  runMetadataExtractionV2,
  type EntityExtractionRunOutcome,
  type ExtractionOptions,
  type MetadataRunOutcome,
} from '../../../pipeline/metadataV2.js';
import {
  buildHumanMetadataJobPatch,
  claimRequestedMetadata,
  observeMetadataState,
  observedMetadataRevisionConditions,
} from '../../../services/letter/metadata-job.js';
import { confirmTranscriptIntent } from '../../../services/letter/transcript-confirmation.js';
import { buildMetadataDocumentProjectionPatch } from '../../../services/letter/metadata-projection.js';
import {
  assertCurrentPrimarySourceRevision,
  sourceRevisionChanged,
} from '../../../services/letter/source-revision.js';
import { AppError, BadRequestError, NotFoundError } from '../../../utils/response-helpers.js';
import { isPlaceholderValue } from '../../../utils/placeholders.js';
import {
  addNoteSchema,
  confirmTranscriptSchema,
  extractionGuidanceSchema,
  reExtractSchema,
  replaceAiNotesSchema,
  restoreVersionBodySchema,
  retagMetadataSchema,
  saveKrakenPageLayoutSchema,
  saveLineSegmentsSchema,
  saveRotationGeometryProposalSchema,
  toggleFlagSchema,
  updateLetterSegmentTrustSchema,
  updatePageSegmentTrustSchema,
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
  requirePrimarySourceRevision,
} from './helpers.js';

const router = Router();
const pageGeometryProposalRepository =
  createPageGeometryProposalRepository();

function requireCompletedMetadataRun(outcome: MetadataRunOutcome): void {
  if (outcome.kind === 'completed') return;

  throw new AppError(
    409,
    `Metadata extraction did not complete because the run was ${outcome.kind.replace('_', ' ')}`,
  );
}

function requireCompletedEntityRun(outcome: EntityExtractionRunOutcome): void {
  if (outcome.kind === 'completed') return;

  throw new AppError(
    409,
    `Entity extraction did not complete because the run was ${outcome.kind.replace('_', ' ')}`,
  );
}

function hasOwnField(value: unknown, field: string): boolean {
  return typeof value === 'object'
    && value !== null
    && Object.hasOwn(value, field);
}

function requirePageSourceExpectation(body: unknown, message: string): void {
  if (
    !hasOwnField(body, 'primarySourceRevision')
    || !hasOwnField(body, 'sourceChecksum')
  ) {
    throw sourceRevisionChanged(message);
  }
}

const GEOMETRY_REVISION_CHANGED_ERROR_CODE = 'GEOMETRY_REVISION_CHANGED';
const LINE_SEGMENTS_CHANGED_ERROR_CODE = 'LINE_SEGMENTS_CHANGED';

function geometryRevisionChanged(message: string): AppError {
  return new AppError(
    409,
    message,
    undefined,
    GEOMETRY_REVISION_CHANGED_ERROR_CODE,
  );
}

function lineSegmentsChanged(message: string): AppError {
  return new AppError(
    409,
    message,
    undefined,
    LINE_SEGMENTS_CHANGED_ERROR_CODE,
  );
}

function requireGeometryExpectation(
  body: unknown,
  options: { checksum: boolean },
): void {
  if (
    !hasOwnField(body, 'expectedGeometryRevision')
    || (
      options.checksum
      && !hasOwnField(body, 'expectedGeometryChecksumSha256')
    )
  ) {
    throw geometryRevisionChanged(
      'Page geometry version is missing; reload before continuing',
    );
  }
}

function requireLineSegmentsExpectation(body: unknown): void {
  if (!hasOwnField(body, 'expectedLineSegmentsChecksumSha256')) {
    throw lineSegmentsChanged(
      'Page line-segment data version is missing; reload before continuing',
    );
  }
}

function requireSavedGeometry(
  result: PageGeometryMutationResult,
  sourceMessage: string,
): Extract<PageGeometryMutationResult, { kind: 'saved' }> {
  if (result.kind === 'saved') return result;
  if (result.kind === 'not-found') {
    throw new NotFoundError('Page not found');
  }
  if (result.kind === 'source-conflict') {
    throw sourceRevisionChanged(sourceMessage);
  }
  if (result.kind === 'invalid-transition') {
    throw new AppError(
      400,
      'Geometry provenance does not match the submitted shape change',
      result.issues,
      'GEOMETRY_PROVENANCE_INVALID',
    );
  }
  if (result.kind === 'projection-conflict') {
    throw lineSegmentsChanged(
      'Page line-segment data changed in another editor; reload the page before retrying',
    );
  }
  throw geometryRevisionChanged(
    'Page geometry changed in another editor; reload the page geometry and retry',
  );
}

function requireSavedGeometryProposal(
  result: SavePageGeometryProposalResult,
):
  | {
    kind: 'saved' | 'already-exists';
    value: StoredPageGeometryProposal;
  }
  | { kind: 'no-candidates' } {
  if (
    result.kind === 'saved'
    || result.kind === 'already-exists'
  ) {
    return result;
  }
  if (result.kind === 'no-candidates') return { kind: result.kind };
  if (result.kind === 'not-found') {
    throw new NotFoundError('Page not found');
  }
  if (result.kind === 'source-conflict') {
    throw sourceRevisionChanged(
      'Page source changed; reload before saving the rotation proposal',
    );
  }
  if (result.kind === 'geometry-conflict') {
    throw geometryRevisionChanged(
      'Page geometry changed; rerun rotation recovery against the current page',
    );
  }
  throw lineSegmentsChanged(
    'Page line-segment data changed; rerun rotation recovery against the current page',
  );
}

function requireLetterPageSourceExpectations(body: unknown): void {
  const pages = typeof body === 'object' && body !== null
    ? (body as { pages?: unknown }).pages
    : undefined;
  if (
    !hasOwnField(body, 'primarySourceRevision')
    || !hasOwnField(body, 'pages')
    || (
      Array.isArray(pages)
      && pages.some((page) => (
        !hasOwnField(page, 'sourceChecksum')
        || !hasOwnField(page, 'expectedGeometryRevision')
        || !hasOwnField(page, 'expectedGeometryChecksumSha256')
      ))
    )
  ) {
    throw sourceRevisionChanged(
      'Letter page source versions are missing; reload before updating segment trust',
    );
  }
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before reprocessing',
    );
    const letter = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      letter.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed; reload before reprocessing',
    );
    if (!await resetLetterForProcessing(letterId, primarySourceRevision)) {
      const latest = await requireLetter(letterId);
      assertCurrentPrimarySourceRevision(
        latest.primarySourceRevision ?? 0,
        primarySourceRevision,
        'Letter source changed; reload before reprocessing',
      );
      throw new AppError(
        409,
        'Cannot reprocess: the letter is not transcribable, has no pages, or another job is running',
      );
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
    if (updates.primarySourceRevision === undefined) {
      throw sourceRevisionChanged(
        'Letter source version is missing; reload before saving',
      );
    }

    const updated = await updateLetter(letterId, updates as UpdateLetterInput, getUserId(req));
    if (!updated) throw new NotFoundError('Letter not found');

    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/confirm-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before confirming its transcript',
    );
    const {
      transcriptDigest,
      confirmedSender,
      confirmedRecipient,
    } = parseOrThrow(
      confirmTranscriptSchema,
      req.body ?? {},
      'Invalid transcript confirmation',
    );
    const result = await confirmTranscriptIntent({
      letterId,
      expectedPrimarySourceRevision: primarySourceRevision,
      expectedTranscriptDigest: transcriptDigest,
      confirmedBy: getUserId(req),
      guidance: { confirmedSender, confirmedRecipient },
    });

    if (result.newlyQueued) {
      try {
        await requestBackgroundWorkerRun('transcript-confirmation');
      } catch (error) {
        req.log.warn(
          {
            letterId,
            confirmationId: result.receipt.confirmationId,
            err: error,
          },
          'Transcript confirmation queued; advisory worker wake failed',
        );
      }
    }

    let letter;
    try {
      const hydrated = await requireLetterDto(
        letterId,
        'Failed to fetch confirmed letter',
        500,
      );
      if (
        hydrated.primarySourceRevision
          === result.receipt.transcriptSource.primarySourceRevision
        && hydrated.transcriptConfirmationId
          === result.receipt.confirmationId
        && hydrated.transcriptConfirmedAt
      ) {
        letter = hydrated;
      }
    } catch (error) {
      req.log.warn(
        { letterId, confirmationId: result.receipt.confirmationId, err: error },
        'Transcript confirmation committed without Letter hydration',
      );
    }

    res.status(result.newlyQueued ? 202 : 200).json({
      receipt: result.receipt,
      ...(letter ? { letter } : {}),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before regenerating metadata',
    );
    const { confirmedSender, confirmedRecipient } = extractionGuidanceSchema.parse(req.body ?? {});
    const letter = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      letter.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed; reload before regenerating metadata',
    );
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
      primarySourceRevision,
    );
    if (!claim) {
      const latest = await requireLetter(letterId);
      assertCurrentPrimarySourceRevision(
        latest.primarySourceRevision ?? 0,
        primarySourceRevision,
        'Letter source changed before metadata extraction could start; reload and try again',
      );
      throw new BadRequestError('Letter processing state changed; try again');
    }

    const extractionOptions: ExtractionOptions = {
      previousAiSender: letter.sender ?? undefined,
      previousAiRecipient: letter.recipient ?? undefined,
    };
    if (confirmedSender) extractionOptions.confirmedSender = confirmedSender;
    if (confirmedRecipient) extractionOptions.confirmedRecipient = confirmedRecipient;
    const outcome = await runMetadataExtractionV2(
      letterId,
      extractionOptions,
      claim,
    );
    if (outcome.kind !== 'completed') {
      const latest = await requireLetter(letterId);
      assertCurrentPrimarySourceRevision(
        latest.primarySourceRevision ?? 0,
        primarySourceRevision,
        'Letter source changed during metadata extraction; reload and try again',
      );
    }
    requireCompletedMetadataRun(outcome);
    const latest = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      latest.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed during metadata extraction; reload and try again',
    );
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-entities', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before regenerating entities',
    );
    const letter = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      letter.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed; reload before regenerating entities',
    );
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

    const outcome = await runEntityExtractionOnly(letterId, {
      claimKind: 'REQUESTED',
      expectedPrimarySourceRevision: primarySourceRevision,
    });
    if (outcome.kind !== 'completed') {
      const latest = await requireLetter(letterId);
      assertCurrentPrimarySourceRevision(
        latest.primarySourceRevision ?? 0,
        primarySourceRevision,
        'Letter source changed during entity extraction; reload and try again',
      );
    }
    requireCompletedEntityRun(outcome);
    const latest = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      latest.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed during entity extraction; reload and try again',
    );
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/generate-reading-view', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before generating a reading view',
    );
    const letter = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      letter.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed; reload before generating a reading view',
    );
    if (!letter.transcriptionText) {
      throw new BadRequestError('Letter must have a transcription before generating reading view');
    }

    const { generateAndSaveReadingView } = await import('../../../services/letter/readingView.js');
    if (
      await generateAndSaveReadingView(
        letterId,
        primarySourceRevision,
      ) === null
    ) {
      throw new BadRequestError(
        'Letter transcription must be complete before generating a reading view',
      );
    }
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/re-extract', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before re-extracting content',
    );
    const { confirmedSender, confirmedRecipient, mode } = parseOrThrow(reExtractSchema, req.body, 'Invalid request body');

    const letter = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      letter.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed; reload before re-extracting content',
    );
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
      if (!letter.transcriptConfirmedAt) {
        throw new BadRequestError('Transcript must be confirmed before regenerating metadata');
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
      const claim = await claimRequestedMetadata(
        letterId,
        observeMetadataState(letter),
        primarySourceRevision,
      );
      if (!claim) {
        const latest = await requireLetter(letterId);
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          primarySourceRevision,
          'Letter source changed before metadata extraction could start; reload and try again',
        );
        throw new BadRequestError('Letter processing state changed; try again');
      }

      const outcome = await runMetadataExtractionV2(
        letterId,
        extractionOptions,
        claim,
      );
      if (outcome.kind !== 'completed') {
        const latest = await requireLetter(letterId);
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          primarySourceRevision,
          'Letter source changed during metadata extraction; reload and try again',
        );
      }
      requireCompletedMetadataRun(outcome);
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
      const outcome = await runEntityExtractionOnly(letterId, {
        ...extractionOptions,
        claimKind: 'REQUESTED',
        expectedPrimarySourceRevision: primarySourceRevision,
      });
      if (outcome.kind !== 'completed') {
        const latest = await requireLetter(letterId);
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          primarySourceRevision,
          'Letter source changed during entity extraction; reload and try again',
        );
      }
      requireCompletedEntityRun(outcome);
    }

    const latest = await requireLetter(letterId);
    assertCurrentPrimarySourceRevision(
      latest.primarySourceRevision ?? 0,
      primarySourceRevision,
      'Letter source changed during re-extraction; reload and try again',
    );
    res.json(await requireLetterDto(letterId, 'Failed to fetch updated letter', 500));
  } catch (error) {
    next(error);
  }
});

router.patch('/:letterId/identity', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before saving identity',
    );
    const {
      expectedSender,
      expectedRecipient,
      sender: newSender,
      recipient: newRecipient,
    } = parseOrThrow(updateIdentitySchema, req.body, 'Invalid request body');

    if (newSender === undefined && newRecipient === undefined) {
      throw new BadRequestError('At least one of sender or recipient must be provided');
    }

    const letter = await requireLetter(letterId);
    if (letter.primarySourceRevision !== primarySourceRevision) {
      throw sourceRevisionChanged('Letter source changed; reload before saving identity');
    }
    const senderValue = newSender === undefined ? undefined : newSender || null;
    const recipientValue = newRecipient === undefined ? undefined : newRecipient || null;
    const senderChanged = senderValue !== undefined && senderValue !== letter.sender;
    const recipientChanged = recipientValue !== undefined && recipientValue !== letter.recipient;

    if (
      (
        senderChanged
        && (
          !hasOwnField(req.body, 'expectedSender')
          || expectedSender !== letter.sender
        )
      )
      || (
        recipientChanged
        && (
          !hasOwnField(req.body, 'expectedRecipient')
          || expectedRecipient !== letter.recipient
        )
      )
    ) {
      throw new AppError(409, 'Letter identity changed; reload before saving names');
    }

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
    const noteAutoResolution = resolveAiNotesForChangedFields(
      letter.aiNotes,
      [
        ...(senderChanged && senderValue ? ['sender'] : []),
        ...(recipientChanged && recipientValue ? ['recipient'] : []),
      ],
    );
    if (noteAutoResolution) {
      dbUpdates.aiNotes = noteAutoResolution.notes;
    }

    let aliasesToPreserve: Array<{
      personId: string;
      canonicalName: string;
      role: 'sender' | 'recipient';
    }>;
    try {
      aliasesToPreserve = await db.transaction(async (tx) => {
        const identityUpdated = await tx
          .update(letters)
          .set(dbUpdates)
          .where(and(
            ...observedMetadataRevisionConditions(letterId, letter),
            eq(letters.primarySourceRevision, primarySourceRevision),
          ))
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
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) {
        const latest = await requireLetter(letterId);
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          primarySourceRevision,
          'Letter source changed before identity could be saved; reload and try again',
        );
      }
      throw error;
    }

    req.log.info({ letterId, senderValue, recipientValue, senderChanged, recipientChanged }, 'Identity update completed');
    if (noteAutoResolution) {
      req.log.info(
        { letterId, resolvedCount: noteAutoResolution.resolvedCount },
        'Auto-resolved AI notes with identity update',
      );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before updating metadata references',
    );
    const change = parseOrThrow(retagMetadataSchema, req.body, 'Invalid request body');

    const letter = await requireLetter(letterId);
    if (letter.primarySourceRevision !== primarySourceRevision) {
      throw sourceRevisionChanged('Letter source changed; reload before updating metadata references');
    }
    const result = await executeRetagForLetter(
      letterId,
      { ...change, primarySourceRevision },
    );
    if (
      result.reason === 'source_changed_before_ai'
      || result.reason === 'source_changed_before_save'
    ) {
      throw sourceRevisionChanged('Letter source changed; reload before updating metadata references');
    }
    if (
      result.reason === 'stale_before_ai'
      || result.reason === 'stale_before_save'
      || result.reason === 'revision_changed_before_save'
    ) {
      throw new AppError(409, 'Letter metadata changed; reload before updating its references');
    }

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
    const versions = await getVersions(letterId, fieldType);
    if (!versions) throw new NotFoundError('Letter not found');
    res.json({ versions });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before saving a version',
    );
    const versionInput = parseOrThrow(versionBodySchema, req.body, 'Invalid request body');
    const result = await createVersion(
      letterId,
      { ...versionInput, primarySourceRevision },
    );
    if (result.kind === 'letter_not_found') throw new NotFoundError('Letter not found');
    if (result.kind === 'source_changed') {
      throw sourceRevisionChanged('Letter source changed; reload before saving a version');
    }
    if (result.kind === 'content_changed') {
      throw new AppError(409, 'Letter content changed before its version could be saved');
    }
    if (result.kind === 'invalid_content') {
      throw new BadRequestError('Invalid version content');
    }
    res.json(result.version);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/versions/:versionNumber/restore', async (req, res, next) => {
  try {
    const { letterId, versionNumber } = req.params;
    const fieldType = requireFieldType(req.query.fieldType);
    const vn = requirePositiveInt(versionNumber);
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before restoring a version',
    );
    parseOrThrow(
      restoreVersionBodySchema,
      req.body,
      'Invalid request body',
    );
    const result = await restoreVersion(
      letterId,
      vn,
      fieldType,
      primarySourceRevision,
    );
    if (result.kind === 'letter_not_found' || result.kind === 'version_not_found') {
      throw new NotFoundError('Letter or version not found');
    }
    if (result.kind === 'source_changed') {
      throw sourceRevisionChanged('Letter source changed; reload before restoring a version');
    }
    if (result.kind === 'metadata_changed') {
      throw new AppError(409, 'Letter metadata changed; reload before restoring a version');
    }
    if (result.kind === 'invalid_content') {
      throw new AppError(
        409,
        'Stored version content is invalid and cannot be restored',
      );
    }

    res.json(await requireLetterDto(letterId, 'Letter not found after restore'));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-transcription', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before regenerating its transcription',
    );
    const includeExtras = req.query.includeExtras === 'true';
    const result = await regenerateTranscription(
      letterId,
      includeExtras,
      primarySourceRevision,
    );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before transcribing its pages',
    );
    const result = await transcribeLetterOnly(letterId, primarySourceRevision);
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before transcribing extra content',
    );
    const result = await transcribeExtras(letterId, primarySourceRevision);
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Photo source version is missing; reload before generating a description',
    );
    const { photoDescriptionContext } = (req.body ?? {}) as {
      photoDescriptionContext?: string | null;
    };
    const result = await describePhoto(
      letterId,
      photoDescriptionContext ?? null,
      primarySourceRevision,
    );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before saving extra content',
    );

    const result = await updateExtraContent(
      letterId,
      nextExtraContent,
      primarySourceRevision,
    );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Photo source version is missing; reload before saving its description',
    );

    const result = await updatePhotoDescription(letterId, {
      photoDescription,
      photoDescriptionContext,
    }, primarySourceRevision);
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/ai-notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before replacing notes',
    );
    const { aiNotes } = parseOrThrow(
      replaceAiNotesSchema,
      req.body,
      'Invalid request body',
    );
    const result = await updateAiNotes(
      letterId,
      aiNotes,
      primarySourceRevision,
    );
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before adding a note',
    );
    const noteInput = parseOrThrow(addNoteSchema, req.body, 'Invalid request body');
    const result = await addAiNote(
      letterId,
      noteInput,
      primarySourceRevision,
      getUserId(req),
    );
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.patch('/:letterId/notes/:noteId', async (req, res, next) => {
  try {
    const { letterId, noteId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before updating the note',
    );
    const { status } = parseOrThrow(
      updateNoteStatusSchema,
      req.body,
      'Invalid request body',
    );
    const result = await updateAiNoteStatus(
      letterId,
      noteId,
      status,
      primarySourceRevision,
      getUserId(req),
    );
    if (!result) throw new NotFoundError('Letter not found');
    res.json(await requireLetterDto(letterId));
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before deleting',
    );
    const result = await deleteCorrespondenceGroup(
      letterId,
      primarySourceRevision,
    );
    if (!result) throw new NotFoundError('Letter not found');

    req.log.info({
      letterId,
      groupSize: result.deletedCount,
      storageObjectsRemoved: result.removedStorageObjectCount,
      storageObjectsAlreadyMissing: result.alreadyMissingStoragePaths.length,
      retainedStorageObjects: result.retainedStoragePaths.length,
      storageCleanupFailures: result.cleanupFailedStoragePaths.length,
      collectionProfileInvalidated: result.collectionProfileInvalidated,
    }, 'Letter group deleted');
    res.json({
      message: 'Letter deleted successfully',
      letterId,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    next(error);
  }
});

// Persist Kraken's native PageLayout envelope without flattening baselines,
// regions, reading order, or provider provenance into editor rectangles.
router.patch('/pages/:pageId/page-layout/kraken', async (req, res, next) => {
  try {
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, req.params.pageId),
      columns: { id: true },
    });
    if (!page) throw new NotFoundError('Page not found');

    requirePageSourceExpectation(
      req.body,
      'Page source version is missing; reload before saving detected layout',
    );
    const body = parseOrThrow(
      saveKrakenPageLayoutSchema,
      req.body,
      'Invalid Kraken page-layout update',
    );
    const sourceChecksum = body.sourceChecksum.toLowerCase();

    if (
      body.nativePageLayout.source.original.sha256
      !== sourceChecksum
    ) {
      throw sourceRevisionChanged(
        'Detected layout belongs to a different page source; reload before retrying',
      );
    }
    const layout = adaptKrakenNativePageLayoutV2(body.nativePageLayout, {
      pageId: req.params.pageId,
      expectedSourceChecksumSha256: sourceChecksum,
      runId: body.runId,
    });

    const result = await savePageLayoutV2(
      req.params.pageId,
      layout,
      {
        primarySourceRevision: body.primarySourceRevision,
        sourceChecksum,
      },
    );
    if (!result.saved) {
      throw new AppError(
        409,
        'Page source changed or native layout evidence already exists; reload before saving detected layout',
        undefined,
        'PAGE_LAYOUT_WRITE_CONFLICT',
      );
    }

    req.log.info({
      pageId: req.params.pageId,
      layoutId: layout.layoutId,
      runId: layout.runId,
      lineCount: result.lineCount,
      projectionAction: result.projectionAction,
      modelChecksumSha256: layout.provenance.model.checksumSha256,
    }, 'Native Kraken page layout saved');
    res.json({
      ok: true,
      layoutId: layout.layoutId,
      pageLayoutChecksumSha256: result.checksumSha256,
      lineCount: result.lineCount,
      projectionAction: result.projectionAction,
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/pages/:pageId/geometry-proposals/rotation/current',
  async (req, res, next) => {
    try {
      const result = await pageGeometryProposalRepository.getCurrent(
        req.params.pageId,
      );
      if (result.kind === 'not-found') {
        throw new NotFoundError('Page not found');
      }
      if (result.kind === 'corrupt-current-geometry') {
        throw new AppError(
          500,
          'Current page geometry failed integrity validation',
          undefined,
          'CURRENT_PAGE_GEOMETRY_CORRUPT',
        );
      }
      if (result.kind === 'corrupt-current-source') {
        throw new AppError(
          500,
          'Current page source identity failed integrity validation',
          undefined,
          'CURRENT_PAGE_SOURCE_CORRUPT',
        );
      }
      if (result.kind === 'none') {
        res.json({ proposal: null });
        return;
      }

      res.json({
        proposal: {
          id: result.value.id,
          artifactChecksumSha256:
            result.value.artifactChecksumSha256,
          createdBy: result.value.createdBy,
          createdAt: result.value.createdAt.toISOString(),
          artifact: result.value.artifact,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Store sideways-text detections as immutable review proposals. This endpoint
// must never replace PageLayout or the editable line-segment projection.
router.patch(
  '/pages/:pageId/geometry-proposals/rotation',
  async (req, res, next) => {
    try {
      const page = await db.query.letterPages.findFirst({
        where: eq(letterPages.id, req.params.pageId),
        columns: { id: true },
      });
      if (!page) throw new NotFoundError('Page not found');

      const body = parseOrThrow(
        saveRotationGeometryProposalSchema,
        req.body,
        'Invalid rotation geometry proposal',
      );
      const sourceChecksumSha256 =
        body.source.sourceChecksumSha256.toLowerCase();
      if (
        body.nativePageLayout.source.original.sha256
        !== sourceChecksumSha256
      ) {
        throw sourceRevisionChanged(
          'Rotation proposal belongs to a different page source; rerun it against the current image',
        );
      }

      const layout = adaptKrakenNativePageLayoutV2(
        body.nativePageLayout,
        {
          pageId: req.params.pageId,
          expectedSourceChecksumSha256: sourceChecksumSha256,
          runId: body.runId,
        },
      );
      const result = requireSavedGeometryProposal(
        await pageGeometryProposalRepository.save({
          layout,
          expected: {
            primarySourceRevision:
              body.source.primarySourceRevision,
            sourceChecksumSha256,
            baseGeometryRevision:
              body.source.baseGeometryRevision,
            baseGeometryChecksumSha256:
              body.source.baseGeometryChecksumSha256,
            baseLineSegmentsChecksumSha256:
              body.source.baseLineSegmentsChecksumSha256,
          },
          actorId: getUserId(req),
        }),
      );

      if (result.kind === 'no-candidates') {
        req.log.info({
          pageId: req.params.pageId,
          runId: body.runId,
        }, 'Rotation recovery completed without proposal candidates');
        res.json({
          ok: true,
          status: result.kind,
          candidateCount: 0,
        });
        return;
      }

      req.log.info({
        pageId: req.params.pageId,
        proposalId: result.value.id,
        proposalStatus: result.kind,
        runId: body.runId,
        candidateCount: result.value.artifact.candidates.length,
        baseGeometryRevision:
          result.value.artifact.source.baseGeometryRevision,
      }, 'Immutable rotation geometry proposal stored');
      res.json({
        ok: true,
        status: result.kind,
        proposalId: result.value.id,
        artifactChecksumSha256:
          result.value.artifactChecksumSha256,
        candidateCount: result.value.artifact.candidates.length,
        createdAt: result.value.createdAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get('/pages/:pageId/page-layout', async (req, res, next) => {
  try {
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, req.params.pageId),
      columns: {
        id: true,
        checksumSha256: true,
        pageLayout: true,
        pageLayoutChecksumSha256: true,
      },
    });
    if (!page) throw new NotFoundError('Page not found');

    const validation = validateStoredPageLayout(page);
    if (validation.status === 'absent') {
      res.json({
        pageLayout: null,
        pageLayoutChecksumSha256: null,
      });
      return;
    }

    if (validation.status === 'invalid') {
      throw new AppError(
        500,
        `Stored page layout failed validation: ${validation.reason}`,
      );
    }

    res.json({
      pageLayout: validation.layout,
      pageLayoutChecksumSha256: validation.checksumSha256,
    });
  } catch (error) {
    next(error);
  }
});

// Save manually edited line segments for a page
router.patch('/pages/:pageId/line-segments', async (req, res, next) => {
  try {
    requirePageSourceExpectation(
      req.body,
      'Page source version is missing; reload before saving line segments',
    );
    requireGeometryExpectation(req.body, { checksum: false });
    requireLineSegmentsExpectation(req.body);
    const body = parseOrThrow(
      saveLineSegmentsSchema,
      req.body,
      'Invalid page line-segment update',
    );
    const result = await savePageLineSegments(
      req.params.pageId,
      body.lineSegments as Parameters<typeof savePageLineSegments>[1],
      {
        primarySourceRevision: body.primarySourceRevision,
        sourceChecksum: body.sourceChecksum,
        expectedGeometryRevision: body.expectedGeometryRevision,
        expectedLineSegmentsChecksumSha256:
          body.expectedLineSegmentsChecksumSha256,
      },
      getUserId(req),
    );
    const saved = requireSavedGeometry(
      result,
      'Page source changed; reload before saving line segments',
    );
    req.log.info({ pageId: req.params.pageId, segmentCount: body.lineSegments.length }, 'Line segments updated manually');
    res.json(saved.envelope);
  } catch (error) {
    next(error);
  }
});

router.get('/pages/:pageId/line-segments', async (req, res, next) => {
  try {
    let envelope;
    try {
      envelope = await getPageGeometryEnvelope(req.params.pageId);
    } catch (error) {
      throw new AppError(
        500,
        'Stored line segments failed schema validation',
        error,
        'STORED_LINE_SEGMENTS_INVALID',
      );
    }
    if (!envelope) throw new NotFoundError('Page not found');
    res.json(envelope);
  } catch (error) {
    next(error);
  }
});

// Update segment trust state for a page
router.patch('/pages/:pageId/segment-trust', async (req, res, next) => {
  try {
    requirePageSourceExpectation(
      req.body,
      'Page source version is missing; reload before updating segment trust',
    );
    requireGeometryExpectation(req.body, { checksum: true });
    const body = parseOrThrow(
      updatePageSegmentTrustSchema,
      req.body,
      'Invalid page segment-trust update',
    );
    const result = await updatePageSegmentTrust(
      req.params.pageId,
      body.trustState,
      {
        primarySourceRevision: body.primarySourceRevision,
        sourceChecksum: body.sourceChecksum,
        expectedGeometryRevision: body.expectedGeometryRevision,
        expectedGeometryChecksumSha256:
          body.expectedGeometryChecksumSha256,
      },
      getUserId(req),
    );
    const updated = requireSavedGeometry(
      result,
      'Page source changed; reload before updating segment trust',
    );

    req.log.info({ pageId: req.params.pageId, trustState: body.trustState }, 'Segment trust state updated');
    res.json(updated.envelope);
  } catch (error) {
    next(error);
  }
});

// Bulk update segment trust state for all pages of a letter
router.patch('/:letterId/segment-trust', async (req, res, next) => {
  try {
    requireLetterPageSourceExpectations(req.body);
    const body = parseOrThrow(
      updateLetterSegmentTrustSchema,
      req.body,
      'Invalid letter segment-trust update',
    );

    const pages = await db.query.letterPages.findMany({
      where: eq(letterPages.letterId, req.params.letterId),
      columns: { id: true },
    });
    if (pages.length === 0) throw new NotFoundError('No pages found for letter');

    const updated = await updateLetterSegmentTrust(
      req.params.letterId,
      body.trustState,
      body.primarySourceRevision,
      body.pages,
      getUserId(req),
    );
    if (!updated) {
      throw sourceRevisionChanged('Letter page sources changed; reload before updating segment trust');
    }

    req.log.info({ letterId: req.params.letterId, trustState: body.trustState, pageCount: pages.length }, 'Segment trust state updated for all pages');
    res.json({ ok: true, trustState: body.trustState, pageCount: pages.length });
  } catch (error) {
    next(error);
  }
});

export default router;
