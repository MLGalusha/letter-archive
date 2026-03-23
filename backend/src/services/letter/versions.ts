import { and, eq, sql } from 'drizzle-orm';
import { TIMING } from '../../constants/timing.js';
import { db, letters, letterVersions } from '../../db/index.js';
import { getLetterById } from '../letters.js';
import { syncLetterParticipantsFromMetadata } from '../entities/participant-sync.js';
import { log, type VersionInput, type VersionResult } from './shared.js';

export async function getVersions(
  letterId: string,
  fieldType: 'transcript' | 'metadata',
): Promise<Array<{ versionNumber: number; content: unknown; source: string; createdAt: string }> | null> {
  const letter = await getLetterById(letterId);
  if (!letter) return null;

  const versions = await db.query.letterVersions.findMany({
    where: and(
      eq(letterVersions.letterId, letterId),
      eq(letterVersions.fieldType, fieldType),
    ),
    orderBy: (v, { desc }) => [desc(v.versionNumber)],
  });

  return versions.map(v => ({
    versionNumber: v.versionNumber,
    content: v.content,
    source: v.source,
    createdAt: v.createdAt.toISOString(),
  }));
}

export async function createVersion(
  letterId: string,
  input: VersionInput,
): Promise<VersionResult | null> {
  const letter = await getLetterById(letterId);
  if (!letter) return null;

  const { fieldType, content, source } = input;

  return db.transaction(async (tx) => {
    const existingVersions = await tx.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
      limit: 1,
    });

    const nextVersionNumber = existingVersions.length > 0
      ? existingVersions[0].versionNumber + 1
      : 1;

    const [newVersion] = await tx.insert(letterVersions).values({
      letterId,
      fieldType,
      versionNumber: nextVersionNumber,
      content: typeof content === 'string' ? { text: content } : content,
      source,
    }).returning();

    log.debug({ letterId, fieldType, versionNumber: nextVersionNumber }, 'Version created');

    const cutoff = new Date(Date.now() - TIMING.RECENT_CUTOFF_MS).toISOString();
    await tx.delete(letterVersions).where(
      and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        sql`${letterVersions.createdAt} < ${cutoff}`,
        sql`${letterVersions.versionNumber} > 1`,
      ),
    );

    return {
      versionNumber: newVersion.versionNumber,
      createdAt: newVersion.createdAt.toISOString(),
    };
  });
}

export async function restoreVersion(
  letterId: string,
  versionNumber: number,
  fieldType: 'transcript' | 'metadata',
): Promise<boolean | null> {
  const letter = await getLetterById(letterId);
  if (!letter) return null;

  const version = await db.query.letterVersions.findFirst({
    where: and(
      eq(letterVersions.letterId, letterId),
      eq(letterVersions.fieldType, fieldType),
      eq(letterVersions.versionNumber, versionNumber),
    ),
  });

  if (!version) return false;

  const content = version.content as Record<string, unknown>;

  if (fieldType === 'transcript') {
    await db.update(letters).set({
      transcriptionText: (content.text as string) || '',
      transcriptStatus: 'EDITED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else {
    await db.update(letters).set({
      sender: (content.sender as string) || null,
      recipient: (content.recipient as string) || null,
      locationWritten: (content.locationWritten as string) || null,
      hook: (content.hook as string) || null,
      summary: (content.summary as string) || null,
      metadataContentStatus: 'EDITED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await syncLetterParticipantsFromMetadata({
      letterId,
      sender: (content.sender as string) || null,
      recipient: (content.recipient as string) || null,
    });
  }

  log.info({ letterId, fieldType, restoredVersion: versionNumber }, 'Version restored');
  return true;
}
