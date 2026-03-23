import { unlink } from 'node:fs/promises';
import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, letterPages, letters } from '../../../db/index.js';
import type { StructuredNote, NoteCategory, NotePriority } from '../../../ai/schemas/metadataV2.js';
import { detectAndStorePageLines } from '../../../services/line-finder.js';
import {
  buildLetterUpdates,
  createVersion,
  getVersions,
  regenerateTranscription,
  restoreVersion,
  transcribeExtras,
  transcribeLetterOnly,
  updateAiNotes,
  updateExtraContent,
  type UpdateLetterInput,
} from '../../../services/letter-operations.js';
import { getLetterById, resetLetterForProcessing } from '../../../services/letters.js';
import { propagateName, propagatePlaceholderReplacement } from '../../../services/name-propagation.js';
import { checkNoteAutoResolutions } from '../../../services/note-resolution.js';
import { getAbsoluteStoragePath } from '../../../services/storage.js';
import { runEntityExtractionOnly, runMetadataExtractionV2, type ExtractionOptions } from '../../../pipeline/metadataV2.js';
import { isPlaceholderValue } from '../../../utils/placeholders.js';
import { fetchLetterWithRelatedAndTransform } from '../../../services/letter-queries.js';
import {
  addNoteSchema,
  reExtractSchema,
  toggleFlagSchema,
  updateIdentitySchema,
  updateLetterSchema,
  updateNoteStatusSchema,
  versionBodySchema,
} from './shared.js';

const router = Router();

router.patch('/:letterId/flag', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = toggleFlagSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { flagged } = parseResult.data;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    await db.update(letters).set({
      flagged,
      flaggedAt: flagged ? new Date() : null,
      flaggedBy: flagged ? 'admin' : null,
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, flagged }, 'Letter flag toggled');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/process', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    await resetLetterForProcessing(letterId);
    res.json({ message: 'Letter enqueued for processing', letterId });
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = updateLetterSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const result = await buildLetterUpdates(letterId, parseResult.data as UpdateLetterInput);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    await db.update(letters).set(result.dbUpdates).where(eq(letters.id, letterId));

    req.log.info({ letterId, workflowChange: result.workflowChange }, 'Letter updated');

    const fieldTriggers: Array<[string | undefined | null, string]> = [
      [parseResult.data.sender, 'sender'],
      [parseResult.data.recipient, 'recipient'],
      [parseResult.data.locationWritten, 'locationWritten'],
      [parseResult.data.extractedDateConfidence, 'extractedDateConfidence'],
      [parseResult.data.extractedDate, 'extractedDate'],
      [parseResult.data.transcriptionText, 'transcriptionText'],
    ];
    for (const [value, field] of fieldTriggers) {
      if (value !== undefined) {
        checkNoteAutoResolutions(letterId, field).catch(err =>
          req.log.warn({ letterId, field, err }, 'Note auto-resolution failed'));
      }
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/confirm-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    if (letter.workflow !== 'TRANSCRIBED') {
      res.status(400).json({ error: 'Letter must be in TRANSCRIBED state', currentState: letter.workflow });
      return;
    }
    await db.update(letters).set({
      transcriptConfirmedAt: new Date(),
      transcriptConfirmedBy: 'admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await runMetadataExtractionV2(letterId);

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    if (!letter.transcriptConfirmedAt) {
      res.status(400).json({ error: 'Transcript must be confirmed before regenerating metadata' });
      return;
    }
    if (letter.metadataStatus === 'RUNNING') {
      res.status(400).json({ error: 'Metadata extraction is already in progress' });
      return;
    }
    await db.update(letters).set({
      metadataAttemptCount: 0,
      metadataError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await runMetadataExtractionV2(letterId);

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-entities', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    if (!letter.transcriptionText) {
      res.status(400).json({ error: 'Letter must have a transcription before extracting entities' });
      return;
    }
    if (letter.entityExtractionStatus === 'RUNNING') {
      res.status(400).json({ error: 'Entity extraction is already in progress' });
      return;
    }
    await runEntityExtractionOnly(letterId);

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/re-extract', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = reExtractSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { confirmedSender, confirmedRecipient, mode } = parseResult.data;

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (!letter.transcriptionText) {
      res.status(400).json({ error: 'Letter must have a transcription before re-extraction' });
      return;
    }

    const metadataV2 = letter.metadataV2Json as Record<string, unknown> | null;
    const senderObj = metadataV2?.sender as { name?: string | null } | undefined;
    const recipientObj = metadataV2?.recipient as { name?: string | null } | undefined;

    const extractionOptions: ExtractionOptions = {
      confirmedSender: confirmedSender,
      confirmedRecipient: confirmedRecipient,
      previousAiSender: senderObj?.name ?? letter.sender ?? undefined,
      previousAiRecipient: recipientObj?.name ?? letter.recipient ?? undefined,
    };

    req.log.info(
      { letterId, mode, confirmedSender, confirmedRecipient },
      'Starting re-extraction with corrections',
    );

    if (mode === 'full') {
      await db.update(letters).set({
        metadataAttemptCount: 0,
        metadataError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      await runMetadataExtractionV2(letterId, extractionOptions);
    } else if (mode === 'metadata_only') {
      await db.update(letters).set({
        metadataAttemptCount: 0,
        metadataError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      await runMetadataExtractionV2(letterId, extractionOptions);
    } else if (mode === 'entities_only') {
      await runEntityExtractionOnly(letterId, extractionOptions);
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.patch('/:letterId/identity', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = updateIdentitySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { sender: newSender, recipient: newRecipient } = parseResult.data;

    if (newSender === undefined && newRecipient === undefined) {
      res.status(400).json({ error: 'At least one of sender or recipient must be provided' });
      return;
    }

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const updatePaths: string[] = [];

    if (newSender !== undefined) {
      const oldSender = letter.sender;

      if ((isPlaceholderValue(oldSender) || !oldSender) && newSender) {
        try {
          await propagatePlaceholderReplacement({ letterId, field: 'sender', newName: newSender });
          updatePaths.push('sender:placeholder-replaced');
        } catch (err) {
          req.log.warn({ letterId, err }, 'Placeholder replacement failed for sender, falling back to simple update');
          await db.update(letters).set({ sender: newSender, updatedAt: new Date() }).where(eq(letters.id, letterId));
          updatePaths.push('sender:simple-fallback');
        }
      } else if (oldSender && newSender) {
        if (oldSender !== newSender) {
          try {
            await propagateName({ letterId, field: 'sender', oldName: oldSender, newName: newSender });
            updatePaths.push('sender:propagated');
          } catch (err) {
            req.log.warn({ letterId, err }, 'Name propagation failed for sender, falling back to simple update');
            await db.update(letters).set({ sender: newSender, updatedAt: new Date() }).where(eq(letters.id, letterId));
            updatePaths.push('sender:simple-fallback');
          }
        }
      } else if (oldSender && !newSender) {
        await db.update(letters).set({ sender: null, updatedAt: new Date() }).where(eq(letters.id, letterId));
        updatePaths.push('sender:cleared');
      }
    }

    if (newRecipient !== undefined) {
      const oldRecipient = letter.recipient;

      if ((isPlaceholderValue(oldRecipient) || !oldRecipient) && newRecipient) {
        try {
          await propagatePlaceholderReplacement({ letterId, field: 'recipient', newName: newRecipient });
          updatePaths.push('recipient:placeholder-replaced');
        } catch (err) {
          req.log.warn({ letterId, err }, 'Placeholder replacement failed for recipient, falling back to simple update');
          await db.update(letters).set({ recipient: newRecipient, updatedAt: new Date() }).where(eq(letters.id, letterId));
          updatePaths.push('recipient:simple-fallback');
        }
      } else if (oldRecipient && newRecipient) {
        if (oldRecipient !== newRecipient) {
          try {
            await propagateName({ letterId, field: 'recipient', oldName: oldRecipient, newName: newRecipient });
            updatePaths.push('recipient:propagated');
          } catch (err) {
            req.log.warn({ letterId, err }, 'Name propagation failed for recipient, falling back to simple update');
            await db.update(letters).set({ recipient: newRecipient, updatedAt: new Date() }).where(eq(letters.id, letterId));
            updatePaths.push('recipient:simple-fallback');
          }
        }
      } else if (oldRecipient && !newRecipient) {
        await db.update(letters).set({ recipient: null, updatedAt: new Date() }).where(eq(letters.id, letterId));
        updatePaths.push('recipient:cleared');
      }
    }

    req.log.info({ letterId, newSender, newRecipient, updatePaths }, 'Smart identity update completed');

    if (newSender !== undefined && newSender) {
      checkNoteAutoResolutions(letterId, 'sender').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for sender'));
    }
    if (newRecipient !== undefined && newRecipient) {
      checkNoteAutoResolutions(letterId, 'recipient').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for recipient'));
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.get('/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const fieldType = req.query.fieldType as string;
    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const versions = await getVersions(letterId, fieldType as 'transcript' | 'metadata');
    res.json({ versions: versions || [] });
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const parseResult = versionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await createVersion(letterId, parseResult.data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/versions/:versionNumber/restore', async (req, res, next) => {
  try {
    const { letterId, versionNumber } = req.params;
    const fieldType = req.query.fieldType as string;
    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }
    const vn = parseInt(versionNumber, 10);
    if (isNaN(vn) || vn < 1) {
      res.status(400).json({ error: 'Invalid version number' });
      return;
    }
    const result = await restoreVersion(letterId, vn, fieldType as 'transcript' | 'metadata');
    if (!result) {
      res.status(404).json({ error: 'Letter or version not found' });
      return;
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after restore' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/regenerate-transcription', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const includeExtras = req.query.includeExtras === 'true';
    const result = await regenerateTranscription(letterId, includeExtras);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json({
      letter: letterDTO,
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
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json({
      letter: letterDTO,
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
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json({
      letter: letterDTO,
      transcribedCount: result.transcribedCount,
      extraContentStatus: result.extraContentStatus,
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
      res.status(400).json({ error: 'extraContent field required' });
      return;
    }
    const result = await updateExtraContent(letterId, nextExtraContent);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/ai-notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { aiNotes } = req.body;
    const result = await updateAiNotes(letterId, aiNotes ?? []);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = addNoteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const existingNotes: StructuredNote[] = Array.isArray(letter.aiNotes)
      ? (letter.aiNotes as StructuredNote[])
      : [];

    const newNote: StructuredNote = {
      id: crypto.randomUUID(),
      content: parseResult.data.content,
      category: parseResult.data.category as NoteCategory,
      priority: parseResult.data.priority as NotePriority,
      status: 'open',
      resolves_when: null,
      resolved_at: null,
      resolved_by: null,
      source: 'admin',
    };

    const updatedNotes = [...existingNotes, newNote];
    await db.update(letters).set({ aiNotes: updatedNotes, updatedAt: new Date() }).where(eq(letters.id, letterId));

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.patch('/:letterId/notes/:noteId', async (req, res, next) => {
  try {
    const { letterId, noteId } = req.params;
    const parseResult = updateNoteStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const existingNotes: StructuredNote[] = Array.isArray(letter.aiNotes)
      ? (letter.aiNotes as StructuredNote[])
      : [];

    const noteIndex = existingNotes.findIndex(n => n.id === noteId);
    if (noteIndex === -1) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    existingNotes[noteIndex] = {
      ...existingNotes[noteIndex],
      status: parseResult.data.status,
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
    };

    await db.update(letters).set({ aiNotes: existingNotes, updatedAt: new Date() }).where(eq(letters.id, letterId));

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

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

router.post('/pages/:pageId/detect-lines', async (req, res, next) => {
  try {
    const { pageId } = req.params;

    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
    });

    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const onProgress = (label: string) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', label })}\n\n`);
    };

    const absolutePath = getAbsoluteStoragePath(page.storagePath);
    const result = await detectAndStorePageLines(pageId, absolutePath, undefined, onProgress);

    res.write(`data: ${JSON.stringify({
      type: 'result',
      lineSegments: result.lineSegments ?? (Array.isArray(page.lineSegments) ? page.lineSegments : []),
      ocrWordBoxes: result.ocrWordBoxes ?? (Array.isArray(page.ocrWordBoxes) ? page.ocrWordBoxes : null),
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
