import { and, eq } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { describePhoto as generatePhotoDescription } from '../../ai/openai.js';
import { runRequestedTranscription } from '../../pipeline/transcription.js';
import { getAbsoluteStoragePath } from '../storage.js';
import {
  contentStatusValues,
  log,
  type DescribePhotoResult,
  type TranscribeLetterOnlyResult,
  type TranscriptionRegenerateResult,
} from './shared.js';
import { getLetterById } from '../letters.js';
import { runRegeneratedExtraContent } from './extra-content.js';
import { buildHumanExtraContentJobPatch } from './extra-content-job.js';
import {
  buildMetadataSourceInvalidationPatch,
  observedMetadataRevisionConditions,
} from './metadata-job.js';

export { transcribeExtras } from './extra-content.js';

function statusError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

async function runDirectMainTranscription(
  letterId: string,
): Promise<TranscribeLetterOnlyResult | null> {
  const outcome = await runRequestedTranscription(letterId);

  switch (outcome.kind) {
    case 'completed':
      return {
        pageCount: outcome.pageCount,
        textLength: outcome.textLength,
      };
    case 'not_found':
      return null;
    case 'not_transcribable':
      throw statusError(`Cannot transcribe type '${outcome.type}'`, 400);
    case 'no_pages':
      throw statusError('Letter has no pages to transcribe', 400);
    case 'claim_lost':
      throw statusError('Transcription conflicted with another job update', 409);
    case 'superseded':
      throw statusError('Transcription was cancelled or superseded', 409);
  }
}

function buildLinkedLetterContext(letter: {
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  extractedDate?: string | null;
  hook?: string | null;
  summary?: string | null;
  transcriptionText?: string | null;
} | null): string | null {
  if (!letter) return null;

  const parts: string[] = [];

  if (letter.sender || letter.recipient) {
    const peopleSummary = [
      letter.sender ? `Sender: ${letter.sender}` : null,
      letter.recipient ? `Recipient: ${letter.recipient}` : null,
    ].filter(Boolean).join('\n');
    if (peopleSummary) {
      parts.push(peopleSummary);
    }
  }

  if (letter.locationWritten) {
    parts.push(`Location: ${letter.locationWritten}`);
  }

  if (letter.extractedDate) {
    parts.push(`Extracted date: ${letter.extractedDate}`);
  }

  if (letter.hook) {
    parts.push(`Hook: ${letter.hook}`);
  }

  if (letter.summary) {
    parts.push(`Summary: ${letter.summary}`);
  }

  if (letter.transcriptionText?.trim()) {
    const transcript = letter.transcriptionText.trim();
    const truncatedTranscript = transcript.length > 6000
      ? `${transcript.slice(0, 6000)}\n\n[Transcript truncated for prompt length]`
      : transcript;
    parts.push(`Related letter transcript:\n${truncatedTranscript}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

export async function regenerateTranscription(
  letterId: string,
  includeExtras: boolean,
): Promise<TranscriptionRegenerateResult | null> {
  const mainTranscription = await runDirectMainTranscription(letterId);
  if (!mainTranscription) return null;

  let extrasTranscribed = 0;

  if (includeExtras) {
    const extraJob = await runRegeneratedExtraContent(letterId);
    if (extraJob.kind === 'completed' || extraJob.kind === 'ineligible') {
      extrasTranscribed = extraJob.value;
    } else {
      const error = new Error(
        extraJob.kind === 'claim_lost'
          ? 'Extra content transcription conflicted with another job update'
          : 'Extra content transcription was cancelled or superseded',
      ) as Error & { status: number };
      error.status = 409;
      throw error;
    }
  }

  log.info({ letterId, includeExtras, extrasTranscribed }, 'Transcription regeneration completed');

  return {
    mainTranscript: true,
    extras: includeExtras,
    extrasCount: extrasTranscribed,
  };
}

export async function transcribeLetterOnly(
  letterId: string,
): Promise<TranscribeLetterOnlyResult | null> {
  return runDirectMainTranscription(letterId);
}

export async function updateExtraContent(
  letterId: string,
  extraContentTranscript: string | null,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  const hasContent = Boolean(extraContentTranscript?.trim());
  const updates: {
    extraContentTranscript: string | null;
    extraContentStatus: typeof contentStatusValues[number];
    extraContentVerifiedAt: null;
    extraContentVerifiedBy: null;
    updatedAt: Date;
  } & ReturnType<typeof buildHumanExtraContentJobPatch> = {
    extraContentTranscript: hasContent ? extraContentTranscript : null,
    extraContentStatus: hasContent ? 'EDITED' : 'EMPTY',
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
    ...buildHumanExtraContentJobPatch(),
    ...buildMetadataSourceInvalidationPatch(),
    updatedAt: new Date(),
  };

  const updated = await db
    .update(letters)
    .set(updates)
    .where(and(...observedMetadataRevisionConditions(letterId, existingLetter)))
    .returning({ id: letters.id });
  if (updated.length === 0) {
    throw statusError(
      'Letter content changed before extra content could be saved; reload and try again',
      409,
    );
  }

  log.debug(
    {
      letterId,
      previousStatus: existingLetter.extraContentStatus,
      newStatus: updates.extraContentStatus,
      hasContent,
    },
    'Extra content updated',
  );
  return true;
}

export async function describePhoto(
  letterId: string,
  reviewerContext: string | null = null,
): Promise<DescribePhotoResult | null> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  if (letter.type !== 'P') {
    const err = new Error(`Cannot describe type '${letter.type}' (only photo records are supported)`) as Error & { status: number };
    err.status = 400;
    throw err;
  }

  if (letter.pages.length === 0) {
    const err = new Error('Photo has no pages to describe') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const trimmedReviewerContext = reviewerContext?.trim() || null;

  const relatedLetter = await db.query.letters.findFirst({
    where: and(
      eq(letters.collectionId, letter.collectionId),
      eq(letters.dateRaw, letter.dateRaw),
      eq(letters.typeSequence, letter.typeSequence),
      eq(letters.type, 'L'),
    ),
  });
  const linkedLetterContext = buildLinkedLetterContext(relatedLetter ?? null);

  log.info(
    {
      letterId,
      pageCount: letter.pages.length,
      hasLinkedLetterContext: Boolean(linkedLetterContext),
      hasReviewerContext: Boolean(trimmedReviewerContext),
    },
    'Starting photo description',
  );

  const descriptions: string[] = [];

  for (const [index, page] of letter.pages.entries()) {
    const filePath = getAbsoluteStoragePath(page.storagePath);
    const description = await generatePhotoDescription({
      filePath,
      letterId,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        photoNumber: page.pageNumber || index + 1,
        totalPhotos: letter.pages.length,
        linkedLetterContext: linkedLetterContext || undefined,
        reviewerContext: trimmedReviewerContext,
      },
    });

    if (description.text.trim()) {
      descriptions.push(description.text.trim());
    }
  }

  const combinedDescription = descriptions.length <= 1
    ? (descriptions[0] || '')
    : descriptions
      .map((text, index) => `--- Photo ${index + 1} ---\n\n${text}`)
      .join('\n\n');

  const newStatus = combinedDescription ? 'AI_DRAFT' : 'EMPTY';

  await db.update(letters).set({
    photoDescription: combinedDescription || null,
    photoDescriptionStatus: newStatus,
    photoDescriptionVerifiedAt: null,
    photoDescriptionVerifiedBy: null,
    photoDescriptionContext: trimmedReviewerContext,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info(
    { letterId, describedCount: descriptions.length, status: newStatus },
    'Photo description completed',
  );

  return {
    describedCount: descriptions.length,
    photoDescriptionStatus: newStatus,
  };
}

export async function updatePhotoDescription(
  letterId: string,
  input: {
    photoDescription: string | null;
    photoDescriptionContext?: string | null;
  },
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.type !== 'P') {
    const err = new Error(`Cannot update photo description for type '${existingLetter.type}'`) as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const hasContent = Boolean(input.photoDescription?.trim());
  const updates: {
    photoDescription: string | null;
    photoDescriptionStatus: typeof contentStatusValues[number];
    photoDescriptionContext?: string | null;
    photoDescriptionVerifiedAt?: null;
    photoDescriptionVerifiedBy?: null;
    updatedAt: Date;
  } = {
    photoDescription: hasContent ? input.photoDescription : null,
    photoDescriptionStatus: existingLetter.photoDescriptionStatus,
    updatedAt: new Date(),
  };

  if (input.photoDescriptionContext !== undefined) {
    updates.photoDescriptionContext = input.photoDescriptionContext?.trim() || null;
  }

  if (!hasContent) {
    updates.photoDescriptionStatus = 'EMPTY';
    updates.photoDescriptionVerifiedAt = null;
    updates.photoDescriptionVerifiedBy = null;
  } else if (existingLetter.photoDescriptionStatus === 'VERIFIED') {
    updates.photoDescriptionStatus = 'EDITED';
    updates.photoDescriptionVerifiedAt = null;
    updates.photoDescriptionVerifiedBy = null;
  } else if (
    existingLetter.photoDescriptionStatus === 'AI_DRAFT' ||
    existingLetter.photoDescriptionStatus === 'EMPTY'
  ) {
    updates.photoDescriptionStatus = 'EDITED';
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));

  log.debug(
    {
      letterId,
      previousStatus: existingLetter.photoDescriptionStatus,
      newStatus: updates.photoDescriptionStatus,
      hasContent,
      contextUpdated: input.photoDescriptionContext !== undefined,
    },
    'Photo description updated',
  );
  return true;
}
