import { and, eq, sql } from 'drizzle-orm';
import { TIMING } from '../../constants/timing.js';
import { db, letters, letterVersions } from '../../db/index.js';
import { syncLetterParticipantsFromMetadata } from '../entities/participant-sync.js';
import { log, type VersionInput, type VersionResult } from './shared.js';
import {
  buildHumanMetadataJobPatch,
  buildMetadataSourceInvalidationPatch,
  observedMetadataRevisionConditions,
} from './metadata-job.js';
import { buildMetadataDocumentProjectionPatch } from './metadata-projection.js';

export type CreateVersionOutcome =
  | { kind: 'created'; version: VersionResult }
  | { kind: 'letter_not_found' }
  | { kind: 'source_changed' }
  | { kind: 'content_changed' };

export type RestoreVersionOutcome =
  | { kind: 'restored' }
  | { kind: 'letter_not_found' }
  | { kind: 'version_not_found' }
  | { kind: 'source_changed' }
  | { kind: 'metadata_changed' };

export async function getVersions(
  letterId: string,
  fieldType: 'transcript' | 'metadata',
): Promise<Array<{ versionNumber: number; content: unknown; source: string; createdAt: string }> | null> {
  return db.transaction(async (tx) => {
    const letter = await tx.query.letters.findFirst({
      where: eq(letters.id, letterId),
      columns: { primarySourceRevision: true },
    });
    if (!letter) return null;

    const versions = await tx.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        eq(letterVersions.primarySourceRevision, letter.primarySourceRevision),
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
    });

    return versions.map(v => ({
      versionNumber: v.versionNumber,
      content: v.content,
      source: v.source,
      createdAt: v.createdAt.toISOString(),
    }));
  }, {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

interface VersionSourceState {
  transcriptionText: string | null;
  sender: string | null;
  recipient: string | null;
  locationWritten: string | null;
  hook: string | null;
  summary: string | null;
}

function metadataSnapshotValue(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function versionMatchesCurrentContent(
  letter: VersionSourceState,
  input: VersionInput,
): boolean {
  if (input.fieldType === 'transcript') {
    const snapshot = typeof input.content === 'string'
      ? input.content
      : input.content.text;
    return typeof snapshot === 'string' && snapshot === letter.transcriptionText;
  }

  if (
    typeof input.content !== 'object'
    || input.content === null
    || Array.isArray(input.content)
  ) {
    return false;
  }
  const snapshot = input.content;

  const fields = [
    ['sender', letter.sender],
    ['recipient', letter.recipient],
    ['locationWritten', letter.locationWritten],
    ['hook', letter.hook],
    ['summary', letter.summary],
  ] as const;

  return fields.every(([field, currentValue]) => {
    const snapshotValue = metadataSnapshotValue(snapshot[field]);
    return snapshotValue !== undefined && snapshotValue === currentValue;
  });
}

export async function createVersion(
  letterId: string,
  input: VersionInput,
): Promise<CreateVersionOutcome> {
  const {
    primarySourceRevision,
    fieldType,
    content,
    source,
  } = input;
  return db.transaction(async (tx) => {
    const [letter] = await tx
      .select({
        id: letters.id,
        primarySourceRevision: letters.primarySourceRevision,
        transcriptionText: letters.transcriptionText,
        sender: letters.sender,
        recipient: letters.recipient,
        locationWritten: letters.locationWritten,
        hook: letters.hook,
        summary: letters.summary,
      })
      .from(letters)
      .where(eq(letters.id, letterId))
      .for('update');
    if (!letter) return { kind: 'letter_not_found' };
    if (letter.primarySourceRevision !== primarySourceRevision) {
      return { kind: 'source_changed' };
    }
    if (!versionMatchesCurrentContent(letter, input)) {
      return { kind: 'content_changed' };
    }

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
      primarySourceRevision,
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
      kind: 'created',
      version: {
        versionNumber: newVersion.versionNumber,
        createdAt: newVersion.createdAt.toISOString(),
      },
    };
  });
}

export async function restoreVersion(
  letterId: string,
  versionNumber: number,
  fieldType: 'transcript' | 'metadata',
  expectedPrimarySourceRevision: number,
): Promise<RestoreVersionOutcome> {
  return db.transaction(async (tx) => {
    const [letter] = await tx
      .select()
      .from(letters)
      .where(eq(letters.id, letterId))
      .for('update');
    if (!letter) return { kind: 'letter_not_found' };
    if (letter.primarySourceRevision !== expectedPrimarySourceRevision) {
      return { kind: 'source_changed' };
    }

    const version = await tx.query.letterVersions.findFirst({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        eq(letterVersions.versionNumber, versionNumber),
      ),
    });
    if (!version) return { kind: 'version_not_found' };
    if (version.primarySourceRevision !== expectedPrimarySourceRevision) {
      return { kind: 'source_changed' };
    }

    const content = version.content as Record<string, unknown>;
    const sourceConditions = [
      ...observedMetadataRevisionConditions(letterId, letter),
      eq(letters.primarySourceRevision, expectedPrimarySourceRevision),
    ];

    if (fieldType === 'transcript') {
      const transcriptionText = (content.text as string) || '';
      const hasTranscription = transcriptionText.trim().length > 0;

      const restored = await tx
        .update(letters)
        .set({
          transcriptionText,
          transcriptionStatus: 'SUCCESS',
          transcriptionRunId: null,
          transcriptionLeaseExpiresAt: null,
          transcriptionLeaseRunId: null,
          transcriptionClaimKind: null,
          transcriptionError: null,
          transcriptStatus: hasTranscription ? 'EDITED' : 'EMPTY',
          transcriptVerifiedAt: null,
          transcriptVerifiedBy: null,
          transcriptConfirmedAt: null,
          transcriptConfirmedBy: null,
          ...buildMetadataSourceInvalidationPatch(),
          workflow: hasTranscription ? 'TRANSCRIBED' : 'UPLOADED',
          updatedAt: new Date(),
        })
        .where(and(...sourceConditions))
        .returning({ id: letters.id });
      if (restored.length === 0) return { kind: 'metadata_changed' };
    } else {
      const metadataValues = {
        sender: (content.sender as string) || null,
        recipient: (content.recipient as string) || null,
        locationWritten: (content.locationWritten as string) || null,
        hook: (content.hook as string) || null,
        summary: (content.summary as string) || null,
      };
      const restored = await tx
        .update(letters)
        .set({
          ...metadataValues,
          ...buildMetadataDocumentProjectionPatch(letter, metadataValues),
          ...buildHumanMetadataJobPatch(),
          updatedAt: new Date(),
        })
        .where(and(...sourceConditions))
        .returning({ id: letters.id });
      if (restored.length === 0) return { kind: 'metadata_changed' };

      await syncLetterParticipantsFromMetadata({
        letterId,
        sender: metadataValues.sender,
        recipient: metadataValues.recipient,
        database: tx,
      });
    }

    log.info({ letterId, fieldType, restoredVersion: versionNumber }, 'Version restored');
    return { kind: 'restored' };
  });
}
