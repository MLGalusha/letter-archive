import { unlink } from 'node:fs/promises';
import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, canonicalPersons, letterPages, letterPersons, letters } from '../../../db/index.js';
import type { StructuredNote, NoteCategory, NotePriority } from '../../../ai/schemas/metadataV2.js';
import { detectAndStorePageLines, savePageLineSegments } from '../../../services/line-finder.js';
import {
  buildLetterUpdates,
  createVersion,
  describePhoto,
  getVersions,
  regenerateTranscription,
  restoreVersion,
  transcribeExtras,
  transcribeLetterOnly,
  updateAiNotes,
  updateExtraContent,
  updatePhotoDescription,
  type UpdateLetterInput,
} from '../../../services/letter-operations.js';
import { resetLetterForProcessing } from '../../../services/letters.js';
import { executeRetagForLetter } from '../../../services/metadata-update.js';
import { checkNoteAutoResolutions } from '../../../services/note-resolution.js';
import { addAliasToCanonicalPerson } from '../../../services/entities/persons.js';
import { syncLetterParticipantsFromMetadata } from '../../../services/entities/participant-sync.js';
import { getAbsoluteStoragePath } from '../../../services/storage.js';
import { runEntityExtractionOnly, runMetadataExtractionV2, type ExtractionOptions } from '../../../pipeline/metadataV2.js';
import { BadRequestError, NotFoundError } from '../../../utils/response-helpers.js';
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
    await resetLetterForProcessing(letterId);
    res.json({ message: 'Letter enqueued for processing', letterId });
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const updates = parseOrThrow(updateLetterSchema, req.body, 'Invalid request body');

    const result = await buildLetterUpdates(letterId, updates as UpdateLetterInput, getUserId(req));
    if (!result) throw new NotFoundError('Letter not found');

    await db.update(letters).set(result.dbUpdates).where(eq(letters.id, letterId));

    req.log.info({ letterId, workflowChange: result.workflowChange }, 'Letter updated');

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

    await db.update(letters).set({
      transcriptConfirmedAt: new Date(),
      transcriptConfirmedBy: getUserId(req),
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Only trigger metadata extraction if status is PENDING (first-time flow).
    // Skip if metadata was previously cleared/failed/succeeded to avoid re-queuing.
    if (letter.metadataStatus === 'PENDING') {
      const extractionOptions: ExtractionOptions = {};
      if (confirmedSender) extractionOptions.confirmedSender = confirmedSender;
      if (confirmedRecipient) extractionOptions.confirmedRecipient = confirmedRecipient;
      await runMetadataExtractionV2(letterId, Object.keys(extractionOptions).length > 0 ? extractionOptions : undefined);
    } else {
      req.log.info(
        { letterId, metadataStatus: letter.metadataStatus },
        'Skipping metadata extraction — status is not PENDING',
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
    if (letter.metadataStatus === 'RUNNING') {
      throw new BadRequestError('Metadata extraction is already in progress');
    }

    // Reset status to PENDING so the atomic claim in runMetadataExtractionV2 succeeds
    await db.update(letters).set({
      metadataStatus: 'PENDING',
      metadataAttemptCount: 0,
      metadataError: null,
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    const extractionOptions: ExtractionOptions = {
      previousAiSender: letter.sender ?? undefined,
      previousAiRecipient: letter.recipient ?? undefined,
    };
    if (confirmedSender) extractionOptions.confirmedSender = confirmedSender;
    if (confirmedRecipient) extractionOptions.confirmedRecipient = confirmedRecipient;
    await runMetadataExtractionV2(letterId, extractionOptions);
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
    if (letter.entityExtractionStatus === 'RUNNING') {
      throw new BadRequestError('Entity extraction is already in progress');
    }

    // Reset to PENDING so the atomic claim in runEntityExtractionOnly succeeds
    await db.update(letters).set({
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await runEntityExtractionOnly(letterId);
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
      // Reset to PENDING so the atomic claim succeeds
      await db.update(letters).set({
        metadataStatus: 'PENDING',
        metadataAttemptCount: 0,
        metadataError: null,
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      await runMetadataExtractionV2(letterId, extractionOptions);
    } else if (mode === 'entities_only') {
      await db.update(letters).set({
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

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

    // Save name fields immediately
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (newSender !== undefined) dbUpdates.sender = newSender || null;
    if (newRecipient !== undefined) dbUpdates.recipient = newRecipient || null;

    // Also update metadataV2Json name fields
    if (letter.metadataV2Json && typeof letter.metadataV2Json === 'object') {
      const metadata = { ...(letter.metadataV2Json as Record<string, unknown>) };
      if (newSender !== undefined) metadata.sender = newSender || null;
      if (newRecipient !== undefined) metadata.recipient = newRecipient || null;
      dbUpdates.metadataV2Json = metadata;
      dbUpdates.metadataJson = metadata;
    }

    await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

    const oldSender = letter.sender;
    const oldRecipient = letter.recipient;
    const senderChanged = newSender !== undefined && newSender !== oldSender;
    const recipientChanged = newRecipient !== undefined && newRecipient !== oldRecipient;

    req.log.info({ letterId, newSender, newRecipient, senderChanged, recipientChanged }, 'Identity update completed');

    if (newSender !== undefined && newSender) {
      checkNoteAutoResolutions(letterId, 'sender').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for sender'));
    }
    if (newRecipient !== undefined && newRecipient) {
      checkNoteAutoResolutions(letterId, 'recipient').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for recipient'));
    }

    // Preserve old canonical name as alias when renaming
    // Uses the canonical person's name (not letter.sender which may be stale/intermediate)
    const aliasPromises: Promise<void>[] = [];
    async function preserveOldNameAsAlias(role: 'sender' | 'recipient', newName: string) {
      const linked = await db.query.letterPersons.findFirst({
        where: and(eq(letterPersons.letterId, letterId), eq(letterPersons.role, role)),
      });
      if (!linked) return;
      const person = await db.query.canonicalPersons.findFirst({
        where: eq(canonicalPersons.id, linked.personId),
      });
      if (!person) return;
      // Only add if the canonical name differs from the new name (the real rename)
      if (person.canonicalName.toLowerCase() !== newName.toLowerCase()) {
        await addAliasToCanonicalPerson(linked.personId, person.canonicalName);
      }
    }
    if (newSender !== undefined && newSender && letter.sender && letter.sender !== newSender && !isPlaceholderValue(letter.sender)) {
      aliasPromises.push(
        preserveOldNameAsAlias('sender', newSender).catch(err =>
          req.log.warn({ letterId, err }, 'Failed to add old sender as alias')),
      );
    }
    if (newRecipient !== undefined && newRecipient && letter.recipient && letter.recipient !== newRecipient && !isPlaceholderValue(letter.recipient)) {
      aliasPromises.push(
        preserveOldNameAsAlias('recipient', newRecipient).catch(err =>
          req.log.warn({ letterId, err }, 'Failed to add old recipient as alias')),
      );
    }
    await Promise.all(aliasPromises);

    // Sync participant links with the new names
    syncLetterParticipantsFromMetadata({
      letterId,
      sender: newSender ?? undefined,
      recipient: newRecipient ?? undefined,
    }).catch(err => req.log.warn({ letterId, err }, 'Participant sync failed after identity update'));

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

    await db.update(letters).set({
      aiNotes: [...existingNotes, newNote],
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

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

    await db.update(letters).set({ aiNotes: existingNotes, updatedAt: new Date() }).where(eq(letters.id, letterId));
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

router.post('/pages/:pageId/detect-lines', async (req, res, next) => {
  try {
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, req.params.pageId),
    });

    if (!page) throw new NotFoundError('Page not found');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const onProgress = (label: string) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', label })}\n\n`);
    };

    const absolutePath = getAbsoluteStoragePath(page.storagePath);
    const result = await detectAndStorePageLines(req.params.pageId, absolutePath, undefined, onProgress);

    res.write(`data: ${JSON.stringify({
      type: 'result',
      lineSegments: result.lineSegments ?? (Array.isArray(page.lineSegments) ? page.lineSegments : []),
    })}\n\n`);

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Detection failed' })}\n\n`);
      res.end();
    } else {
      next(error);
    }
  }
});

export default router;
