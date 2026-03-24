import { and, eq, inArray } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { checkExtraContentForText, describePhoto as generatePhotoDescription, transcribeExtraContent, transcribeImage } from '../../ai/openai.js';
import { runTranscription } from '../../pipeline/processor.js';
import { detectAndStoreLinesForPages } from '../line-finder.js';
import { getAbsoluteStoragePath } from '../storage.js';
import {
  contentStatusValues,
  getDocumentTypeFromCode,
  isTranscribableType,
  log,
  type DescribePhotoResult,
  type TranscribeExtrasResult,
  type TranscribeLetterOnlyResult,
  type TranscriptionRegenerateResult,
} from './shared.js';
import { getLetterById } from '../letters.js';

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
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  if (!isTranscribableType(letter.type)) {
    const err = new Error(`Cannot transcribe type '${letter.type}' (only letter, telegram, cover, ephemera, card, article, diary supported)`) as Error & { status: number };
    err.status = 400;
    throw err;
  }

  if (letter.pages.length === 0) {
    const err = new Error('Letter has no pages to transcribe') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  log.info({ letterId, type: letter.type, includeExtras }, 'Starting transcription regeneration');

  await db.update(letters).set({
    workflow: 'UPLOADED',
    transcriptionStatus: 'PENDING',
    transcriptionError: null,
    transcriptionAttemptCount: 0,
    transcriptStatus: 'EMPTY',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  await runTranscription(letterId);

  await db.update(letters).set({
    transcriptStatus: 'AI_DRAFT',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  let extrasTranscribed = 0;

  if (includeExtras) {
    const relatedItems = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
        inArray(letters.type, ['T', 'C', 'E'])
      ),
      with: {
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
      orderBy: (l, { asc }) => [asc(l.type)],
    });

    if (relatedItems.length > 0) {
      const typeCounters: Record<string, number> = {};
      const transcriptions: { type: string; index: number; text: string }[] = [];

      for (const item of relatedItems) {
        const docType = getDocumentTypeFromCode(item.type);
        typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
        const typeIndex = typeCounters[item.type];

        for (const page of item.pages) {
          const filePath = getAbsoluteStoragePath(page.storagePath);

          const checkResult = await checkExtraContentForText({
            filePath,
            letterId,
            documentType: docType,
          });

          if (!checkResult.hasTranscribableText) continue;

          const transcription = await transcribeExtraContent({
            filePath,
            letterId,
            documentType: docType,
            context: {
              collectionCode: letter.collection.collectionCode,
              dateRaw: letter.dateRaw,
            },
          });

          if (transcription.text.trim()) {
            transcriptions.push({
              type: docType,
              index: typeIndex,
              text: transcription.text.trim(),
            });
            extrasTranscribed++;
          }
        }
      }

      let combinedExtraContent = '';
      if (transcriptions.length > 0) {
        combinedExtraContent = transcriptions
          .map((t) => {
            const header = `--- ${t.type.charAt(0).toUpperCase() + t.type.slice(1)} ${t.index} ---`;
            return `${header}\n\n${t.text}`;
          })
          .join('\n\n');
      }

      await db.update(letters).set({
        extraContentTranscript: combinedExtraContent || null,
        extraContentStatus: combinedExtraContent ? 'AI_DRAFT' : 'EMPTY',
        extraContentVerifiedAt: null,
        extraContentVerifiedBy: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
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
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  if (!isTranscribableType(letter.type)) {
    const err = new Error(`Cannot transcribe type '${letter.type}'`) as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const pages = letter.pages;
  if (pages.length === 0) {
    const err = new Error('Letter has no pages to transcribe') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  log.info({ letterId, type: letter.type }, 'Starting letter-only transcription');

  await db.update(letters).set({
    workflow: 'UPLOADED',
    transcriptionStatus: 'PENDING',
    transcriptionError: null,
    transcriptionAttemptCount: 0,
    transcriptStatus: 'EMPTY',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  const pageTranscriptions: string[] = [];

  if (letter.type === 'L') {
    // Standard letter transcription
    for (const page of pages) {
      const absolutePath = getAbsoluteStoragePath(page.storagePath);

      const result = await transcribeImage({
        filePath: absolutePath,
        letterId,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
          pageNumber: page.pageNumber,
          totalPages: pages.length,
        },
      });

      pageTranscriptions.push(result.text);
    }
  } else {
    // Non-letter type: use extra content transcription prompt
    const docType = getDocumentTypeFromCode(letter.type);
    for (const page of pages) {
      const absolutePath = getAbsoluteStoragePath(page.storagePath);

      const checkResult = await checkExtraContentForText({
        filePath: absolutePath,
        letterId,
        documentType: docType,
      });

      if (!checkResult.hasTranscribableText) continue;

      const result = await transcribeExtraContent({
        filePath: absolutePath,
        letterId,
        documentType: docType,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
        },
      });

      if (result.text.trim()) {
        pageTranscriptions.push(result.text.trim());
      }
    }
  }

  let combinedTranscription: string;
  if (pageTranscriptions.length === 1) {
    combinedTranscription = pageTranscriptions[0];
  } else {
    combinedTranscription = pageTranscriptions
      .map((text, i) => `--- Page ${i + 1} ---\n\n${text}`)
      .join('\n\n');
  }

  await db.update(letters).set({
    transcriptionText: combinedTranscription,
    transcriptionStatus: 'SUCCESS',
    transcriptionError: null,
    workflow: 'TRANSCRIBED',
    transcriptStatus: 'AI_DRAFT',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  try {
    await detectAndStoreLinesForPages(pages, getAbsoluteStoragePath);
  } catch (lineError) {
    log.warn({ letterId, err: lineError }, 'Failed to store line detection results after letter-only transcription');
  }

  log.info({ letterId, pageCount: pages.length }, 'Letter-only transcription completed');

  return {
    pageCount: pages.length,
    textLength: combinedTranscription.length,
  };
}

export async function transcribeExtras(letterId: string): Promise<TranscribeExtrasResult | null> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  const relatedItems = await db.query.letters.findMany({
    where: and(
      eq(letters.collectionId, letter.collectionId),
      eq(letters.dateRaw, letter.dateRaw),
      eq(letters.typeSequence, letter.typeSequence),
      inArray(letters.type, ['T', 'C', 'E'])
    ),
    with: {
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
    orderBy: (l, { asc }) => [asc(l.type)],
  });

  if (relatedItems.length === 0) {
    await db.update(letters).set({
      extraContentStatus: 'EMPTY',
      extraContentTranscript: null,
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    return {
      transcribedCount: 0,
      extraContentStatus: 'EMPTY',
      message: 'No extra content found to transcribe',
    };
  }

  log.info(
    { letterId, relatedCount: relatedItems.length, types: relatedItems.map(r => r.type) },
    'Starting extra content transcription',
  );

  const typeCounters: Record<string, number> = {};
  const transcriptions: { type: string; index: number; text: string }[] = [];

  for (const item of relatedItems) {
    const docType = getDocumentTypeFromCode(item.type);

    typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
    const typeIndex = typeCounters[item.type];

    for (const page of item.pages) {
      const filePath = getAbsoluteStoragePath(page.storagePath);

      const checkResult = await checkExtraContentForText({
        filePath,
        letterId,
        documentType: docType,
      });

      if (!checkResult.hasTranscribableText) {
        log.debug(
          { pageId: page.id, type: item.type, reason: checkResult.reason },
          'Skipping page - no transcribable text',
        );
        continue;
      }

      const transcription = await transcribeExtraContent({
        filePath,
        letterId,
        documentType: docType,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
        },
      });

      if (transcription.text && transcription.text.trim()) {
        transcriptions.push({
          type: item.type,
          index: typeIndex,
          text: transcription.text.trim(),
        });
      }
    }
  }

  let combinedTranscript = '';
  if (transcriptions.length > 0) {
    const typeTotals: Record<string, number> = {};
    for (const item of relatedItems) {
      typeTotals[item.type] = (typeTotals[item.type] || 0) + 1;
    }

    const parts: string[] = [];
    for (const t of transcriptions) {
      const docTypeName = getDocumentTypeFromCode(t.type);
      const displayName = docTypeName.charAt(0).toUpperCase() + docTypeName.slice(1);

      const label = typeTotals[t.type] > 1
        ? `--- ${displayName} ${t.index} ---`
        : `--- ${displayName} ---`;

      parts.push(`${label}\n\n${t.text}`);
    }

    combinedTranscript = parts.join('\n\n');
  }

  const newStatus = combinedTranscript ? 'AI_DRAFT' : 'EMPTY';
  await db.update(letters).set({
    extraContentTranscript: combinedTranscript || null,
    extraContentStatus: newStatus,
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info(
    { letterId, transcribedCount: transcriptions.length, status: newStatus },
    'Extra content transcription completed',
  );

  return {
    transcribedCount: transcriptions.length,
    extraContentStatus: newStatus,
  };
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
    extraContentVerifiedAt?: null;
    extraContentVerifiedBy?: null;
    updatedAt: Date;
  } = {
    extraContentTranscript: hasContent ? extraContentTranscript : null,
    extraContentStatus: existingLetter.extraContentStatus,
    updatedAt: new Date(),
  };

  if (!hasContent) {
    updates.extraContentStatus = 'EMPTY';
    updates.extraContentVerifiedAt = null;
    updates.extraContentVerifiedBy = null;
  } else if (existingLetter.extraContentStatus === 'VERIFIED') {
    updates.extraContentStatus = 'EDITED';
    updates.extraContentVerifiedAt = null;
    updates.extraContentVerifiedBy = null;
  } else if (
    existingLetter.extraContentStatus === 'AI_DRAFT' ||
    existingLetter.extraContentStatus === 'EMPTY'
  ) {
    updates.extraContentStatus = 'EDITED';
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));

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
