import { eq } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { log } from './shared.js';

export async function verifyTranscript(letterId: string): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    transcriptStatus: 'VERIFIED',
    transcriptVerifiedAt: new Date(),
    transcriptVerifiedBy: 'admin',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, previousStatus: existingLetter.transcriptStatus }, 'Transcript verified');
  return { previousStatus: existingLetter.transcriptStatus };
}

export async function unverifyTranscript(letterId: string): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.transcriptStatus !== 'VERIFIED') {
    const err = new Error('Transcript is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.transcriptStatus;
    throw err;
  }

  await db.update(letters).set({
    transcriptStatus: 'EDITED',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId }, 'Transcript verification removed');
  return true;
}

export async function verifyMetadata(letterId: string): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    metadataContentStatus: 'VERIFIED',
    metadataVerifiedAt: new Date(),
    metadataVerifiedBy: 'admin',
    reviewedAt: new Date(),
    reviewedBy: 'admin',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, previousStatus: existingLetter.metadataContentStatus }, 'Metadata verified');
  return { previousStatus: existingLetter.metadataContentStatus };
}

export async function unverifyMetadata(letterId: string): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.metadataContentStatus !== 'VERIFIED') {
    const err = new Error('Metadata is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.metadataContentStatus;
    throw err;
  }

  await db.update(letters).set({
    metadataContentStatus: 'EDITED',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId }, 'Metadata verification removed');
  return true;
}

export async function verifyExtraContent(letterId: string): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    extraContentStatus: 'VERIFIED',
    extraContentVerifiedAt: new Date(),
    extraContentVerifiedBy: 'admin',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, previousStatus: existingLetter.extraContentStatus }, 'Extra content verified');
  return { previousStatus: existingLetter.extraContentStatus };
}

export async function unverifyExtraContent(letterId: string): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.extraContentStatus !== 'VERIFIED') {
    const err = new Error('Extra content is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.extraContentStatus;
    throw err;
  }

  await db.update(letters).set({
    extraContentStatus: 'EDITED',
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId }, 'Extra content verification removed');
  return true;
}
