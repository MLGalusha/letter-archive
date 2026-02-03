import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters } from '../../db/index.js';
import { getLetterById, resetLetterForProcessing } from '../../services/letters.js';
import { transformLetterToDTO, type LetterWithRelations } from '../../dto/index.js';

const router = Router();

// Validation schema for letter updates
const updateLetterSchema = z.object({
  transcriptionText: z.string().optional(),
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
  locationWritten: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  extractedDate: z.string().nullable().optional(),
  extractedDateConfidence: z.enum(['exact', 'unknown', 'inferred']).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  visibility: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * POST /admin/letters/:letterId/process - Re-enqueue a letter for processing
 *
 * Resets the letter's status and allows the worker to pick it up again.
 */
router.post('/letters/:letterId/process', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const letter = await getLetterById(letterId);

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Reset for processing
    await resetLetterForProcessing(letterId);

    res.json({
      message: 'Letter enqueued for processing',
      letterId,
      note: 'The background worker will pick this up shortly.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/letters/:letterId - Update letter fields
 */
router.put('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Validate request body
    const parseResult = updateLetterSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const updates = parseResult.data;

    // Check letter exists
    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Build update object
    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.transcriptionText !== undefined) {
      dbUpdates.transcriptionText = updates.transcriptionText;
    }
    if (updates.sender !== undefined) {
      dbUpdates.sender = updates.sender;
    }
    if (updates.recipient !== undefined) {
      dbUpdates.recipient = updates.recipient;
    }
    if (updates.locationWritten !== undefined) {
      dbUpdates.locationWritten = updates.locationWritten;
    }
    if (updates.summary !== undefined) {
      dbUpdates.summary = updates.summary;
    }
    if (updates.extractedDate !== undefined) {
      dbUpdates.extractedDate = updates.extractedDate;
    }
    if (updates.notes !== undefined) {
      dbUpdates.notes = updates.notes;
    }
    if (updates.extractedDateConfidence !== undefined) {
      dbUpdates.extractedDateConfidence = updates.extractedDateConfidence;
    }
    if (updates.tags !== undefined) {
      dbUpdates.tags = updates.tags;
    }
    if (updates.visibility !== undefined) {
      dbUpdates.visibility = updates.visibility;
      // If publishing, mark as reviewed
      if (updates.visibility === 'PUBLISHED') {
        dbUpdates.reviewedAt = new Date();
        dbUpdates.reviewedBy = 'admin'; // TODO: Use actual user when auth is implemented
      }
    }

    // Workflow auto-transition based on content changes
    const currentWorkflow = existingLetter.workflow;

    // If admin adds transcription to an UPLOADED letter → TRANSCRIBED
    if (updates.transcriptionText !== undefined) {
      const hasTranscription = updates.transcriptionText && updates.transcriptionText.trim().length > 0;
      if (hasTranscription && currentWorkflow === 'UPLOADED') {
        dbUpdates.workflow = 'TRANSCRIBED';
      } else if (!hasTranscription && ['TRANSCRIBED', 'METADATA_DRAFTED', 'METADATA_EXTRACTING'].includes(currentWorkflow)) {
        // Admin cleared transcription → revert to UPLOADED
        dbUpdates.workflow = 'UPLOADED';
      }
    }

    // If admin adds any metadata to a TRANSCRIBED letter → METADATA_DRAFTED
    const hasMetadataUpdate = [
      updates.sender,
      updates.recipient,
      updates.locationWritten,
      updates.summary,
      updates.extractedDate,
    ].some((field) => field !== undefined && field !== null && field !== '');

    if (hasMetadataUpdate) {
      const workflowToCheck = (dbUpdates.workflow as string) || currentWorkflow;
      if (workflowToCheck === 'TRANSCRIBED') {
        dbUpdates.workflow = 'METADATA_DRAFTED';
      }
    }

    // Apply updates
    await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!updatedLetter) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/review - Mark letter as reviewed
 *
 * Sets workflow to REVIEWED and records review timestamp.
 * This is an admin sign-off indicating they don't need to revisit this letter.
 */
router.post('/letters/:letterId/review', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Set workflow to REVIEWED and record review timestamp
    await db.update(letters).set({
      workflow: 'REVIEWED',
      reviewedAt: new Date(),
      reviewedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!updatedLetter) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/letters/:letterId - Soft delete a letter
 */
router.delete('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Check letter exists
    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Soft delete
    await db.update(letters).set({
      deletedAt: new Date(),
      deletedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    res.json({ message: 'Letter deleted successfully', letterId });
  } catch (error) {
    next(error);
  }
});

export default router;
