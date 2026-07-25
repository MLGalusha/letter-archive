import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { buildHumanExtraContentJobPatch } from './extra-content-job.js';
import { generateAndSaveReadingView } from './readingView.js';
import {
  buildMetadataSourceInvalidationPatch,
  observedMetadataRevisionConditions,
} from './metadata-job.js';
import { log, observedTimestampMatches } from './shared.js';
import {
  assertCurrentPrimarySourceRevision,
  currentPrimarySourceRevisionCondition,
  SourceRevisionChangedError,
} from './source-revision.js';

function transcriptionTextCondition(transcriptionText: string | null) {
  return transcriptionText === null
    ? isNull(letters.transcriptionText)
    : eq(letters.transcriptionText, transcriptionText);
}

function photoDescriptionCondition(photoDescription: string | null) {
  return photoDescription === null
    ? isNull(letters.photoDescription)
    : eq(letters.photoDescription, photoDescription);
}

function transcriptionVerificationConflict(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 409;
  return error;
}

function metadataVerificationConflict(message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 409;
  return error;
}

async function assertSourceStillCurrent(
  letterId: string,
  expectedPrimarySourceRevision: number,
  message: string,
): Promise<void> {
  const latest = await getLetterById(letterId);
  if (!latest) return;
  assertCurrentPrimarySourceRevision(
    latest.primarySourceRevision,
    expectedPrimarySourceRevision,
    message,
  );
}

export async function verifyTranscript(
  letterId: string,
  expectedPrimarySourceRevision: number,
  userId: string = 'admin',
): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before its transcript could be verified; reload and try again',
  );

  const previousStatus = existingLetter.transcriptStatus;

  if (existingLetter.transcriptionStatus !== 'SUCCESS') {
    const error = new Error(
      'Transcription must be complete before its content can be verified',
    ) as Error & { status: number };
    error.status = 400;
    throw error;
  }

  const verified = await db
    .update(letters)
    .set({
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: new Date(),
      transcriptVerifiedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      eq(letters.transcriptionStatus, 'SUCCESS'),
      eq(letters.transcriptStatus, previousStatus),
      transcriptionTextCondition(existingLetter.transcriptionText),
    ))
    .returning({ id: letters.id });

  if (verified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Letter source changed before its transcript could be verified; reload and try again',
    );
    throw transcriptionVerificationConflict(
      'Transcript changed before it could be verified; review the latest transcript and try again',
    );
  }

  log.info({ letterId, previousStatus }, 'Transcript verified');

  // Auto-generate reading view on FIRST verification of letter-type documents only
  if (
    previousStatus !== 'VERIFIED'
    && !existingLetter.readingText
    && existingLetter.type === 'L'
  ) {
    try {
      if (
        await generateAndSaveReadingView(
          letterId,
          expectedPrimarySourceRevision,
        ) !== null
      ) {
        log.info({ letterId }, 'Auto-generated reading view on first verification');
      }
    } catch (err) {
      if (err instanceof SourceRevisionChangedError) throw err;
      log.warn({ letterId, err }, 'Failed to auto-generate reading view — user can trigger manually');
    }
  }

  return { previousStatus };
}

export async function unverifyTranscript(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before transcript verification could be removed; reload and try again',
  );

  if (existingLetter.transcriptStatus !== 'VERIFIED') {
    const err = new Error('Transcript is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.transcriptStatus;
    throw err;
  }

  const unverified = await db
    .update(letters)
    .set({
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptPublished: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      eq(letters.transcriptionStatus, existingLetter.transcriptionStatus),
      ne(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.transcriptStatus, 'VERIFIED'),
      transcriptionTextCondition(existingLetter.transcriptionText),
    ))
    .returning({ id: letters.id });

  if (unverified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Letter source changed before transcript verification could be removed; reload and try again',
    );
    throw transcriptionVerificationConflict(
      'Transcript changed before verification could be removed; refresh and try again',
    );
  }

  log.info({ letterId }, 'Transcript verification removed');
  return true;
}

export async function verifyMetadata(
  letterId: string,
  expectedPrimarySourceRevision: number,
  userId: string = 'admin',
): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before its metadata could be verified; reload and try again',
  );

  if (
    existingLetter.metadataStatus !== 'SUCCESS'
    || existingLetter.metadataContentStatus === 'EMPTY'
  ) {
    const error = new Error(
      'Metadata extraction must be complete and contain content before verification',
    ) as Error & { status: number };
    error.status = 400;
    throw error;
  }

  const verified = await db
    .update(letters)
    .set({
      metadataContentStatus: 'VERIFIED',
      metadataVerifiedAt: new Date(),
      metadataVerifiedBy: userId,
      reviewedAt: new Date(),
      reviewedBy: userId,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      ...observedMetadataRevisionConditions(letterId, existingLetter),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      eq(letters.metadataStatus, 'SUCCESS'),
      eq(letters.metadataContentStatus, existingLetter.metadataContentStatus),
    ))
    .returning({ id: letters.id });

  if (verified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Letter source changed before its metadata could be verified; reload and try again',
    );
    throw metadataVerificationConflict(
      'Metadata changed before it could be verified; review the latest metadata and try again',
    );
  }

  log.info({ letterId, previousStatus: existingLetter.metadataContentStatus }, 'Metadata verified');
  return { previousStatus: existingLetter.metadataContentStatus };
}

export async function unverifyMetadata(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before metadata verification could be removed; reload and try again',
  );

  if (existingLetter.metadataContentStatus !== 'VERIFIED') {
    const err = new Error('Metadata is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.metadataContentStatus;
    throw err;
  }

  const unverified = await db
    .update(letters)
    .set({
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      ...observedMetadataRevisionConditions(letterId, existingLetter),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      eq(letters.metadataStatus, existingLetter.metadataStatus),
      ne(letters.metadataStatus, 'RUNNING'),
      eq(letters.metadataContentStatus, 'VERIFIED'),
    ))
    .returning({ id: letters.id });

  if (unverified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Letter source changed before metadata verification could be removed; reload and try again',
    );
    throw metadataVerificationConflict(
      'Metadata changed before verification could be removed; refresh and try again',
    );
  }

  log.info({ letterId }, 'Metadata verification removed');
  return true;
}

export async function verifyExtraContent(
  letterId: string,
  expectedPrimarySourceRevision: number,
  userId: string = 'admin',
): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before extra content could be verified; reload and try again',
  );

  const verified = await db
    .update(letters)
    .set({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: new Date(),
      extraContentVerifiedBy: userId,
      ...buildHumanExtraContentJobPatch(),
      ...buildMetadataSourceInvalidationPatch(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      observedTimestampMatches(letters.updatedAt, existingLetter.updatedAt),
      eq(letters.extraContentStatus, existingLetter.extraContentStatus),
    ))
    .returning({ id: letters.id });

  if (verified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Letter source changed before extra content could be verified; reload and try again',
    );
    const error = new Error(
      'Extra content changed before it could be verified; review the latest content and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  log.info({ letterId, previousStatus: existingLetter.extraContentStatus }, 'Extra content verified');
  return { previousStatus: existingLetter.extraContentStatus };
}

export async function unverifyExtraContent(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Letter source changed before extra-content verification could be removed; reload and try again',
  );

  if (existingLetter.extraContentStatus !== 'VERIFIED') {
    const err = new Error('Extra content is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.extraContentStatus;
    throw err;
  }

  const unverified = await db
    .update(letters)
    .set({
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      ...buildHumanExtraContentJobPatch(),
      ...buildMetadataSourceInvalidationPatch(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      observedTimestampMatches(letters.updatedAt, existingLetter.updatedAt),
      eq(letters.extraContentStatus, 'VERIFIED'),
    ))
    .returning({ id: letters.id });

  if (unverified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Letter source changed before extra-content verification could be removed; reload and try again',
    );
    const error = new Error(
      'Extra content changed before verification could be removed; refresh and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  log.info({ letterId }, 'Extra content verification removed');
  return true;
}

export async function verifyPhotoDescription(
  letterId: string,
  expectedPrimarySourceRevision: number,
  userId: string = 'admin',
): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Photo source changed before its description could be verified; reload and try again',
  );

  const verified = await db
    .update(letters)
    .set({
      photoDescriptionStatus: 'VERIFIED',
      photoDescriptionVerifiedAt: new Date(),
      photoDescriptionVerifiedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      observedTimestampMatches(letters.updatedAt, existingLetter.updatedAt),
      eq(letters.photoDescriptionStatus, existingLetter.photoDescriptionStatus),
      photoDescriptionCondition(existingLetter.photoDescription),
    ))
    .returning({ id: letters.id });

  if (verified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Photo source changed before its description could be verified; reload and try again',
    );
    const error = new Error(
      'Photo description changed before it could be verified; review the latest description and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  log.info({ letterId, previousStatus: existingLetter.photoDescriptionStatus }, 'Photo description verified');
  return { previousStatus: existingLetter.photoDescriptionStatus };
}

export async function unverifyPhotoDescription(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;
  assertCurrentPrimarySourceRevision(
    existingLetter.primarySourceRevision,
    expectedPrimarySourceRevision,
    'Photo source changed before description verification could be removed; reload and try again',
  );

  if (existingLetter.photoDescriptionStatus !== 'VERIFIED') {
    const err = new Error('Photo description is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.photoDescriptionStatus;
    throw err;
  }

  const unverified = await db
    .update(letters)
    .set({
      photoDescriptionStatus: 'EDITED',
      photoDescriptionVerifiedAt: null,
      photoDescriptionVerifiedBy: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision),
      observedTimestampMatches(letters.updatedAt, existingLetter.updatedAt),
      eq(letters.photoDescriptionStatus, 'VERIFIED'),
      photoDescriptionCondition(existingLetter.photoDescription),
    ))
    .returning({ id: letters.id });

  if (unverified.length === 0) {
    await assertSourceStillCurrent(
      letterId,
      expectedPrimarySourceRevision,
      'Photo source changed before description verification could be removed; reload and try again',
    );
    const error = new Error(
      'Photo description changed before verification could be removed; refresh and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  log.info({ letterId }, 'Photo description verification removed');
  return true;
}
