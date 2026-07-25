import { and, eq, sql } from 'drizzle-orm';
import { TIMING } from '../../constants/timing.js';
import { db, letters, letterVersions } from '../../db/index.js';
import { syncLetterParticipantsFromMetadata } from '../entities/participant-sync.js';
import { log, type VersionResult } from './shared.js';
import {
  buildHumanMetadataJobPatch,
  buildMetadataSourceInvalidationPatch,
  clearedTranscriptConfirmationIntent,
  observedMetadataRevisionConditions,
} from './metadata-job.js';
import { buildMetadataDocumentProjectionPatch } from './metadata-projection.js';
import {
  canonicalizeMetadataVersionContent,
  decodeMetadataVersionContent,
  decodeTranscriptVersionContent,
  metadataVersionMatchesCurrentContent,
  transcriptVersionMatchesCurrentContent,
  type MetadataVersionCandidateContent,
  type MetadataVersionContent,
  type TranscriptVersionCandidateContent,
  type TranscriptVersionContent,
} from './version-content.js';

interface VersionInputBase {
  primarySourceRevision: number;
  source: 'ai' | 'human';
}

export type VersionInput =
  | VersionInputBase & {
    fieldType: 'transcript';
    content: TranscriptVersionCandidateContent;
  }
  | VersionInputBase & {
    fieldType: 'metadata';
    content: MetadataVersionCandidateContent;
  };

export type CreateVersionOutcome =
  | { kind: 'created'; version: VersionResult }
  | { kind: 'letter_not_found' }
  | { kind: 'source_changed' }
  | { kind: 'content_changed' }
  | { kind: 'invalid_content' };

export type RestoreVersionOutcome =
  | { kind: 'restored' }
  | { kind: 'letter_not_found' }
  | { kind: 'version_not_found' }
  | { kind: 'source_changed' }
  | { kind: 'metadata_changed' }
  | { kind: 'invalid_content' };

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

export async function createVersion(
  letterId: string,
  input: VersionInput,
): Promise<CreateVersionOutcome> {
  const {
    primarySourceRevision,
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
        extractedDate: letters.extractedDate,
        locationWritten: letters.locationWritten,
        hook: letters.hook,
        summary: letters.summary,
        emotionalTone: letters.emotionalTone,
        senderRecipientRelationship: letters.senderRecipientRelationship,
        primaryTopics: letters.primaryTopics,
      })
      .from(letters)
      .where(eq(letters.id, letterId))
      .for('update');
    if (!letter) return { kind: 'letter_not_found' };
    if (letter.primarySourceRevision !== primarySourceRevision) {
      return { kind: 'source_changed' };
    }

    let canonicalContent: TranscriptVersionContent | MetadataVersionContent;
    if (input.fieldType === 'transcript') {
      const decoded = decodeTranscriptVersionContent(input.content);
      if (!decoded.ok) return { kind: 'invalid_content' };
      if (!transcriptVersionMatchesCurrentContent(
        letter.transcriptionText,
        decoded.content,
      )) {
        return { kind: 'content_changed' };
      }
      canonicalContent = decoded.content;
    } else {
      const decoded = decodeMetadataVersionContent(input.content);
      if (!decoded.ok) return { kind: 'invalid_content' };

      const currentContent: MetadataVersionContent = {
        sender: letter.sender,
        recipient: letter.recipient,
        extractedDate: letter.extractedDate,
        locationWritten: letter.locationWritten,
        hook: letter.hook,
        summary: letter.summary,
        emotionalTone: letter.emotionalTone,
        senderRecipientRelationship: letter.senderRecipientRelationship,
        primaryTopics: letter.primaryTopics,
      };
      if (!metadataVersionMatchesCurrentContent(
        currentContent,
        decoded.content,
      )) {
        return { kind: 'content_changed' };
      }
      canonicalContent = canonicalizeMetadataVersionContent(currentContent);
    }

    const existingVersions = await tx.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, input.fieldType),
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
      limit: 1,
    });

    const nextVersionNumber = existingVersions.length > 0
      ? existingVersions[0].versionNumber + 1
      : 1;

    const [newVersion] = await tx.insert(letterVersions).values({
      letterId,
      fieldType: input.fieldType,
      versionNumber: nextVersionNumber,
      content: canonicalContent,
      source,
      primarySourceRevision,
    }).returning();

    log.debug(
      { letterId, fieldType: input.fieldType, versionNumber: nextVersionNumber },
      'Version created',
    );

    const cutoff = new Date(Date.now() - TIMING.RECENT_CUTOFF_MS).toISOString();
    await tx.delete(letterVersions).where(
      and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, input.fieldType),
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

    const sourceConditions = [
      ...observedMetadataRevisionConditions(letterId, letter),
      eq(letters.primarySourceRevision, expectedPrimarySourceRevision),
    ];

    if (fieldType === 'transcript') {
      const decoded = decodeTranscriptVersionContent(version.content);
      if (!decoded.ok) return { kind: 'invalid_content' };

      const { text: transcriptionText } = decoded.content;
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
          ...clearedTranscriptConfirmationIntent(),
          ...buildMetadataSourceInvalidationPatch(),
          workflow: hasTranscription ? 'TRANSCRIBED' : 'UPLOADED',
          updatedAt: new Date(),
        })
        .where(and(...sourceConditions))
        .returning({ id: letters.id });
      if (restored.length === 0) return { kind: 'metadata_changed' };
    } else {
      const decoded = decodeMetadataVersionContent(version.content);
      if (!decoded.ok) return { kind: 'invalid_content' };

      const metadataValues = decoded.content;
      const metadataPatch: Record<string, unknown> = {
        ...metadataValues,
      };
      if (Object.hasOwn(metadataValues, 'primaryTopics')) {
        const topics = metadataValues.primaryTopics!;
        metadataPatch.primaryTopics = topics === null ? null : [...topics];
        metadataPatch.tags = topics === null ? null : [...topics];
      }

      const restored = await tx
        .update(letters)
        .set({
          ...metadataPatch,
          ...buildMetadataDocumentProjectionPatch(letter, metadataValues),
          ...buildHumanMetadataJobPatch(),
          updatedAt: new Date(),
        })
        .where(and(...sourceConditions))
        .returning({ id: letters.id });
      if (restored.length === 0) return { kind: 'metadata_changed' };

      const synchronizesParticipants = Object.hasOwn(metadataValues, 'sender')
        || Object.hasOwn(metadataValues, 'recipient')
        || Object.hasOwn(metadataValues, 'senderRecipientRelationship');
      if (synchronizesParticipants) {
        await syncLetterParticipantsFromMetadata({
          letterId,
          sender: Object.hasOwn(metadataValues, 'sender')
            ? metadataValues.sender
            : undefined,
          recipient: Object.hasOwn(metadataValues, 'recipient')
            ? metadataValues.recipient
            : undefined,
          relationshipType: Object.hasOwn(
            metadataValues,
            'senderRecipientRelationship',
          )
            ? metadataValues.senderRecipientRelationship
            : undefined,
          database: tx,
        });
      }
    }

    log.info({ letterId, fieldType, restoredVersion: versionNumber }, 'Version restored');
    return { kind: 'restored' };
  });
}
