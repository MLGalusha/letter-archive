import { and, eq, inArray } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { checkExtraContentForText, transcribeExtraContent, transcribeImage } from '../../ai/openai.js';
import { runTranscription } from '../../pipeline/processor.js';
import { detectAndStoreLinesForPages } from '../line-finder.js';
import { getAbsoluteStoragePath } from '../storage.js';
import {
  contentStatusValues,
  getDocumentTypeFromCode,
  log,
  type TranscribeExtrasResult,
  type TranscribeLetterOnlyResult,
  type TranscriptionRegenerateResult,
} from './shared.js';
import { getLetterById } from '../letters.js';

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

  if (letter.type !== 'L') {
    const err = new Error('Can only regenerate transcription for letter type (L)') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  if (letter.pages.length === 0) {
    const err = new Error('Letter has no pages to transcribe') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  log.info({ letterId, includeExtras }, 'Starting transcription regeneration');

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
            documentType: docType,
          });

          if (!checkResult.hasTranscribableText) continue;

          const transcription = await transcribeExtraContent({
            filePath,
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

  if (letter.type !== 'L') {
    const err = new Error('Can only transcribe letter type (L)') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const pages = letter.pages;
  if (pages.length === 0) {
    const err = new Error('Letter has no pages to transcribe') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  log.info({ letterId }, 'Starting letter-only transcription');

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

  for (const page of pages) {
    const absolutePath = getAbsoluteStoragePath(page.storagePath);

    const result = await transcribeImage({
      filePath: absolutePath,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        pageNumber: page.pageNumber,
        totalPages: pages.length,
      },
    });

    pageTranscriptions.push(result.text);
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
