import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { PAGINATION } from '../../constants/pagination.js';
import {
  auditLog,
  db,
  canonicalPersons,
  letterPersons,
  letters,
  personRelationships,
  type AuditLog,
  type CanonicalPerson,
  type NewCanonicalPerson,
  type PersonRelationshipType,
} from '../../db/index.js';
import { buildHumanMetadataJobPatch } from '../letter/metadata-job.js';
import { buildStructuredMetadataSqlPatch } from '../letter/metadata-projection.js';
import {
  assertRestoredIds,
  assertSnapshotsUnchanged,
} from './merge-integrity.js';
import {
  chooseEntityMergeCollisionWinner,
  isCurrentlyTrustedMergeExtraction,
  type CommittedEntityExtraction,
} from './relationship-provenance.js';

export async function createCanonicalPerson(
  data: Omit<NewCanonicalPerson, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const [person] = await db
    .insert(canonicalPersons)
    .values(data)
    .returning({ id: canonicalPersons.id });
  return person.id;
}

export async function getCanonicalPersonById(
  id: string,
): Promise<CanonicalPerson | undefined> {
  return db.query.canonicalPersons.findFirst({
    where: eq(canonicalPersons.id, id),
  });
}

export async function getAllCanonicalPersons(): Promise<CanonicalPerson[]> {
  return db.query.canonicalPersons.findMany({
    orderBy: [sql`${canonicalPersons.canonicalName} asc`],
  });
}

function serializeDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

interface MergePersonSnapshot {
  id: string;
  canonicalName: string;
  aliases: string[];
  notes: string | null;
  biography: string | null;
  biographyStatus: CanonicalPerson['biographyStatus'];
  biographyVerifiedAt: string | null;
  biographyVerifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function serializePerson(person: CanonicalPerson): MergePersonSnapshot {
  return {
    id: person.id,
    canonicalName: person.canonicalName,
    aliases: person.aliases || [],
    notes: person.notes,
    biography: person.biography,
    biographyStatus: person.biographyStatus,
    biographyVerifiedAt: serializeDate(person.biographyVerifiedAt),
    biographyVerifiedBy: person.biographyVerifiedBy,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  };
}

interface MergePersonLinkSnapshot {
  id: string;
  letterId: string;
  personId: string;
  role: 'sender' | 'recipient' | 'mentioned';
  nameAsWritten: string | null;
  relationshipToSender: string | null;
  context: string | null;
  confidence: number;
  entityExtractionRevision: number | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

function serializePersonLink(link: {
  id: string;
  letterId: string;
  personId: string;
  role: 'sender' | 'recipient' | 'mentioned';
  nameAsWritten: string | null;
  relationshipToSender: string | null;
  context: string | null;
  confidence: number;
  entityExtractionRevision: number | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}): MergePersonLinkSnapshot {
  return {
    id: link.id,
    letterId: link.letterId,
    personId: link.personId,
    role: link.role,
    nameAsWritten: link.nameAsWritten,
    relationshipToSender: link.relationshipToSender,
    context: link.context,
    confidence: link.confidence,
    entityExtractionRevision: link.entityExtractionRevision,
    confirmedBy: link.confirmedBy,
    confirmedAt: serializeDate(link.confirmedAt),
    createdAt: link.createdAt.toISOString(),
  };
}

async function createPersonAuditEntry(input: {
  action: string;
  entityId: string;
  actor: string;
  changes: Record<string, unknown>;
}): Promise<string> {
  const [entry] = await db.insert(auditLog).values({
    action: input.action,
    entityType: 'person',
    entityId: input.entityId,
    userId: input.actor,
    changes: input.changes,
  }).returning({ id: auditLog.id });

  return entry.id;
}

interface MergeRelationshipSnapshot {
  id: string;
  personAId: string;
  personBId: string;
  relationshipType: string;
  notes: string | null;
  discoveredInLetterId: string | null;
  entityExtractionRevision: number | null;
  confidence: number;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function serializeRelationship(rel: {
  id: string;
  personAId: string;
  personBId: string;
  relationshipType: string;
  notes: string | null;
  discoveredInLetterId: string | null;
  entityExtractionRevision: number | null;
  confidence: number;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MergeRelationshipSnapshot {
  return {
    id: rel.id,
    personAId: rel.personAId,
    personBId: rel.personBId,
    relationshipType: rel.relationshipType,
    notes: rel.notes,
    discoveredInLetterId: rel.discoveredInLetterId,
    entityExtractionRevision: rel.entityExtractionRevision,
    confidence: rel.confidence,
    confirmedBy: rel.confirmedBy,
    confirmedAt: serializeDate(rel.confirmedAt),
    createdAt: rel.createdAt.toISOString(),
    updatedAt: rel.updatedAt.toISOString(),
  };
}

export async function updateCanonicalPerson(
  id: string,
  data: Partial<Pick<CanonicalPerson, 'canonicalName' | 'aliases' | 'notes'>>,
): Promise<void> {
  await db
    .update(canonicalPersons)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(canonicalPersons.id, id));
}

/**
 * Add an old name as an alias to a canonical person record.
 * Skips if the alias already exists or matches the current canonical name.
 */
export async function addAliasToCanonicalPerson(
  personId: string,
  alias: string,
): Promise<void> {
  const person = await getCanonicalPersonById(personId);
  if (!person) return;

  const normalizedAlias = alias.trim();
  if (!normalizedAlias) return;

  // Don't add if it matches the current canonical name
  if (normalizedAlias.toLowerCase() === person.canonicalName.toLowerCase()) return;

  // Don't add if already present
  const existing = person.aliases ?? [];
  if (existing.some(a => a.toLowerCase() === normalizedAlias.toLowerCase())) return;

  await db
    .update(canonicalPersons)
    .set({ aliases: [...existing, normalizedAlias], updatedAt: new Date() })
    .where(eq(canonicalPersons.id, personId));
}

export async function updateCanonicalPersonWithUndo(
  id: string,
  data: Partial<Pick<CanonicalPerson, 'canonicalName' | 'aliases' | 'notes'>>,
  actor: string = 'admin',
): Promise<{ undoActionId: string | null }> {
  const existing = await getCanonicalPersonById(id);
  if (!existing) {
    throw new Error('Person not found');
  }

  const before = {
    canonicalName: existing.canonicalName,
    aliases: existing.aliases || [],
    notes: existing.notes,
  };

  return db.transaction(async (tx) => {
    await tx.update(canonicalPersons).set({ ...data, updatedAt: new Date() }).where(eq(canonicalPersons.id, id));

    if (data.canonicalName && data.canonicalName !== existing.canonicalName) {
      await tx.update(letterPersons).set({ nameAsWritten: data.canonicalName }).where(eq(letterPersons.personId, id));

      const senderLetterRows = await tx
        .select({ letterId: letterPersons.letterId })
        .from(letterPersons)
        .where(and(eq(letterPersons.personId, id), eq(letterPersons.role, 'sender')));

      if (senderLetterRows.length > 0) {
        await tx.update(letters).set({
          sender: data.canonicalName,
          ...buildStructuredMetadataSqlPatch('sender', data.canonicalName),
          ...buildHumanMetadataJobPatch(),
          updatedAt: new Date(),
        }).where(
          inArray(letters.id, [...new Set(senderLetterRows.map((row) => row.letterId))]),
        );
      }

      const recipientLetterRows = await tx
        .select({ letterId: letterPersons.letterId })
        .from(letterPersons)
        .where(and(eq(letterPersons.personId, id), eq(letterPersons.role, 'recipient')));

      if (recipientLetterRows.length > 0) {
        await tx.update(letters).set({
          recipient: data.canonicalName,
          ...buildStructuredMetadataSqlPatch('recipient', data.canonicalName),
          ...buildHumanMetadataJobPatch(),
          updatedAt: new Date(),
        }).where(
          inArray(letters.id, [...new Set(recipientLetterRows.map((row) => row.letterId))]),
        );
      }
    }

    const updated = await tx.query.canonicalPersons.findFirst({
      where: eq(canonicalPersons.id, id),
    });
    if (!updated) {
      throw new Error('Person disappeared after update');
    }

    if (before.canonicalName === updated.canonicalName) {
      return { undoActionId: null };
    }

    const [auditEntry] = await tx.insert(auditLog).values({
      action: 'person.rename',
      entityType: 'person',
      entityId: id,
      userId: actor,
      changes: {
        before,
        after: {
          canonicalName: updated.canonicalName,
          aliases: updated.aliases || [],
          notes: updated.notes,
        },
      },
    }).returning({ id: auditLog.id });

    return { undoActionId: auditEntry.id };
  });
}

export async function mergePersons(keepId: string, mergeId: string): Promise<void> {
  await mergePersonsWithUndo(keepId, mergeId, 'admin', false);
}

export async function mergePersonsWithUndo(
  keepId: string,
  mergeId: string,
  actor: string = 'admin',
  trackUndo: boolean = true,
): Promise<{ undoActionId: string | null }> {
  if (keepId === mergeId) {
    throw new Error('Cannot merge a person into itself');
  }

  return db.transaction(async (tx) => {
    // Lock both canonical rows in stable order before snapshotting their links.
    // This serializes the merge with extraction's foreign-key key-share locks:
    // a committed extraction link is either included here or its insert fails
    // after this merge deletes the source canonical row.
    await tx.execute(sql`
      SELECT ${canonicalPersons.id}
      FROM ${canonicalPersons}
      WHERE ${canonicalPersons.id} IN (${keepId}, ${mergeId})
      ORDER BY ${canonicalPersons.id}
      FOR UPDATE
    `);

    const lockedPersons = await tx.query.canonicalPersons.findMany({
      where: inArray(canonicalPersons.id, [keepId, mergeId]),
    });
    const keepPerson = lockedPersons.find((person) => person.id === keepId);
    const mergePerson = lockedPersons.find((person) => person.id === mergeId);

    if (!keepPerson || !mergePerson) {
      throw new Error('Both persons must exist');
    }

    const keepBefore = serializePerson(keepPerson);
    const mergeBefore = serializePerson(mergePerson);

    // Existing child rows can be edited without touching their canonical FK.
    // Lock every possible source/collision row before reading any child state.
    await tx.execute(sql`
      SELECT ${letterPersons.id}
      FROM ${letterPersons}
      WHERE ${letterPersons.personId} IN (${keepId}, ${mergeId})
      ORDER BY ${letterPersons.id}
      FOR UPDATE
    `);
    await tx.execute(sql`
      SELECT ${personRelationships.id}
      FROM ${personRelationships}
      WHERE ${personRelationships.personAId} IN (${keepId}, ${mergeId})
         OR ${personRelationships.personBId} IN (${keepId}, ${mergeId})
      ORDER BY ${personRelationships.id}
      FOR UPDATE
    `);

    const mergeLinks = await tx.query.letterPersons.findMany({
      where: eq(letterPersons.personId, mergeId),
    });

    const mergeRelationships = await tx.query.personRelationships.findMany({
      where: or(
        eq(personRelationships.personAId, mergeId),
        eq(personRelationships.personBId, mergeId),
      ),
    });

    const combinedAliases = uniqueStrings([
      ...(keepPerson.aliases || []),
      mergePerson.canonicalName,
      ...(mergePerson.aliases || []),
    ]);
    const mergeTimestamp = new Date();

    await tx
      .update(canonicalPersons)
      .set({
        aliases: combinedAliases,
        updatedAt: mergeTimestamp,
      })
      .where(eq(canonicalPersons.id, keepId));
    const keepPostMerge = serializePerson({
      ...keepPerson,
      aliases: combinedAliases,
      updatedAt: mergeTimestamp,
    });

    const movedLinks: MergePersonLinkSnapshot[] = [];
    const retainedLinkIds = new Set<string>();
    const deletedDuplicateLinks: MergePersonLinkSnapshot[] = [];
    const mutatedExistingLinks: Array<{
      id: string;
      before: MergePersonLinkSnapshot;
    }> = [];
    const committedExtractionCache = new Map<
      string,
      CommittedEntityExtraction | null
    >();
    const getCommittedExtraction = async (
      letterId: string | null,
    ): Promise<CommittedEntityExtraction | null> => {
      if (!letterId) return null;
      if (committedExtractionCache.has(letterId)) {
        return committedExtractionCache.get(letterId) ?? null;
      }

      const committed = await tx.query.letters.findFirst({
        where: eq(letters.id, letterId),
        columns: {
          entityExtractionRevision: true,
          entityExtractionJson: true,
        },
      });
      const state = committed
        ? {
            entityExtractionRevision: committed.entityExtractionRevision,
            entityExtractionJson: committed.entityExtractionJson,
          }
        : null;
      committedExtractionCache.set(letterId, state);
      return state;
    };

    for (const link of mergeLinks) {
      const existingTarget = await tx.query.letterPersons.findFirst({
        where: and(
          eq(letterPersons.letterId, link.letterId),
          eq(letterPersons.personId, keepId),
          eq(letterPersons.role, link.role),
        ),
      });

      if (existingTarget) {
        retainedLinkIds.add(existingTarget.id);
        const committed = await getCommittedExtraction(link.letterId);
        const winner = chooseEntityMergeCollisionWinner(
          existingTarget,
          link,
          {
            existingIsCurrentExtraction: isCurrentlyTrustedMergeExtraction(
              existingTarget,
              committed,
            ),
            incomingIsCurrentExtraction: isCurrentlyTrustedMergeExtraction(
              link,
              committed,
            ),
          },
        );

        if (winner.id === link.id) {
          mutatedExistingLinks.push({
            id: existingTarget.id,
            before: serializePersonLink(existingTarget),
          });
          await tx.update(letterPersons).set({
            nameAsWritten: link.nameAsWritten,
            relationshipToSender: link.relationshipToSender,
            context: link.context,
            confidence: link.confidence,
            entityExtractionRevision: link.entityExtractionRevision,
            confirmedBy: link.confirmedBy,
            confirmedAt: link.confirmedAt,
          }).where(eq(letterPersons.id, existingTarget.id));
        }

        await tx.delete(letterPersons).where(eq(letterPersons.id, link.id));

        deletedDuplicateLinks.push(serializePersonLink(link));
        continue;
      }

      await tx.update(letterPersons).set({
        personId: keepId,
      }).where(eq(letterPersons.id, link.id));
      movedLinks.push(serializePersonLink(link));
      retainedLinkIds.add(link.id);
    }

    const movedRelationships: MergeRelationshipSnapshot[] = [];
    const retainedRelationshipIds = new Set<string>();
    const deletedRelationships: MergeRelationshipSnapshot[] = [];
    const mutatedExistingRelationships: Array<{
      id: string;
      before: MergeRelationshipSnapshot;
    }> = [];

    for (const rel of mergeRelationships) {
      const otherPersonId = rel.personAId === mergeId ? rel.personBId : rel.personAId;

      if (otherPersonId === keepId) {
        deletedRelationships.push(serializeRelationship(rel));
        await tx.delete(personRelationships).where(eq(personRelationships.id, rel.id));
        continue;
      }

      const [newA, newB] = [keepId, otherPersonId].sort();
      const existing = await tx.query.personRelationships.findFirst({
        where: and(
          eq(personRelationships.personAId, newA),
          eq(personRelationships.personBId, newB),
        ),
      });

      if (existing && existing.id !== rel.id) {
        retainedRelationshipIds.add(existing.id);
        const [existingCommitted, incomingCommitted] = await Promise.all([
          getCommittedExtraction(existing.discoveredInLetterId),
          getCommittedExtraction(rel.discoveredInLetterId),
        ]);
        const winner = chooseEntityMergeCollisionWinner(
          existing,
          rel,
          {
            existingIsCurrentExtraction: isCurrentlyTrustedMergeExtraction(
              existing,
              existingCommitted,
            ),
            incomingIsCurrentExtraction: isCurrentlyTrustedMergeExtraction(
              rel,
              incomingCommitted,
            ),
          },
        );

        if (winner.id === rel.id) {
          mutatedExistingRelationships.push({
            id: existing.id,
            before: serializeRelationship(existing),
          });

          await tx.update(personRelationships).set({
            relationshipType: rel.relationshipType,
            notes: rel.notes,
            discoveredInLetterId: rel.discoveredInLetterId,
            entityExtractionRevision: rel.entityExtractionRevision,
            confidence: rel.confidence,
            confirmedBy: rel.confirmedBy,
            confirmedAt: rel.confirmedAt,
            updatedAt: new Date(),
          }).where(eq(personRelationships.id, existing.id));
        }

        deletedRelationships.push(serializeRelationship(rel));
        await tx.delete(personRelationships).where(eq(personRelationships.id, rel.id));
        continue;
      }

      movedRelationships.push(serializeRelationship(rel));
      await tx.update(personRelationships).set({
        personAId: newA,
        personBId: newB,
        updatedAt: new Date(),
      }).where(eq(personRelationships.id, rel.id));
      retainedRelationshipIds.add(rel.id);
    }

    const retainedLinks = retainedLinkIds.size > 0
      ? await tx.query.letterPersons.findMany({
          where: inArray(letterPersons.id, [...retainedLinkIds]),
        })
      : [];
    assertRestoredIds(
      'post-merge person links',
      [...retainedLinkIds],
      retainedLinks,
    );
    const retainedLinksPostMerge = retainedLinks.map(serializePersonLink);

    const retainedRelationships = retainedRelationshipIds.size > 0
      ? await tx.query.personRelationships.findMany({
          where: inArray(
            personRelationships.id,
            [...retainedRelationshipIds],
          ),
        })
      : [];
    assertRestoredIds(
      'post-merge person relationships',
      [...retainedRelationshipIds],
      retainedRelationships,
    );
    const retainedRelationshipsPostMerge = retainedRelationships.map(
      serializeRelationship,
    );

    await tx.delete(canonicalPersons).where(eq(canonicalPersons.id, mergeId));

    if (!trackUndo) {
      return { undoActionId: null };
    }

    const [auditEntry] = await tx.insert(auditLog).values({
      action: 'person.merge',
      entityType: 'person',
      entityId: keepId,
      userId: actor,
      changes: {
        keepId,
        mergeId,
        keepBefore,
        keepPostMerge,
        mergeBefore,
        movedLinks,
        retainedLinksPostMerge,
        deletedDuplicateLinks,
        mutatedExistingLinks,
        movedRelationships,
        retainedRelationshipsPostMerge,
        deletedRelationships,
        mutatedExistingRelationships,
      },
    }).returning({ id: auditLog.id });

    return { undoActionId: auditEntry.id };
  });
}

async function getPersonAuditEntryForUndo(
  actionId: string,
  expectedAction: 'person.rename' | 'person.merge',
): Promise<AuditLog> {
  const entry = await db.query.auditLog.findFirst({
    where: and(
      eq(auditLog.id, actionId),
      eq(auditLog.entityType, 'person'),
      eq(auditLog.action, expectedAction),
    ),
  });

  if (!entry) {
    throw new Error('Undo action not found');
  }

  const existingUndo = await db.execute<{ id: string }>(sql`
    SELECT id
    FROM audit_log
    WHERE action = 'undo'
      AND changes ->> 'targetActionId' = ${actionId}
    LIMIT 1
  `);

  const undoRows = Array.isArray(existingUndo)
    ? existingUndo
    : (existingUndo as { rows?: Array<{ id: string }> }).rows ?? [];

  if (undoRows.length > 0) {
    throw new Error('This action was already undone');
  }

  return entry;
}

export async function undoPersonRename(actionId: string, actor: string = 'admin'): Promise<void> {
  const entry = await getPersonAuditEntryForUndo(actionId, 'person.rename');
  const changes = (entry.changes || {}) as {
    before?: {
      canonicalName?: string;
      aliases?: string[];
      notes?: string | null;
    };
  };

  if (!entry.entityId || !changes.before?.canonicalName) {
    throw new Error('Undo payload is missing required rename data');
  }

  const entityId = entry.entityId;
  const beforeData = changes.before;

  await db.transaction(async (tx) => {
    await tx.update(canonicalPersons).set({
      canonicalName: beforeData.canonicalName!,
      aliases: beforeData.aliases || [],
      notes: beforeData.notes ?? null,
      updatedAt: new Date(),
    }).where(eq(canonicalPersons.id, entityId));

    await tx.update(letterPersons).set({ nameAsWritten: beforeData.canonicalName! }).where(eq(letterPersons.personId, entityId));

    const senderLetterRows = await tx
      .select({ letterId: letterPersons.letterId })
      .from(letterPersons)
      .where(and(eq(letterPersons.personId, entityId), eq(letterPersons.role, 'sender')));

    if (senderLetterRows.length > 0) {
      await tx.update(letters).set({
        sender: beforeData.canonicalName!,
        ...buildStructuredMetadataSqlPatch('sender', beforeData.canonicalName!),
        ...buildHumanMetadataJobPatch(),
        updatedAt: new Date(),
      }).where(
        inArray(letters.id, [...new Set(senderLetterRows.map((row) => row.letterId))]),
      );
    }

    const recipientLetterRows = await tx
      .select({ letterId: letterPersons.letterId })
      .from(letterPersons)
      .where(and(eq(letterPersons.personId, entityId), eq(letterPersons.role, 'recipient')));

    if (recipientLetterRows.length > 0) {
      await tx.update(letters).set({
        recipient: beforeData.canonicalName!,
        ...buildStructuredMetadataSqlPatch('recipient', beforeData.canonicalName!),
        ...buildHumanMetadataJobPatch(),
        updatedAt: new Date(),
      }).where(
        inArray(letters.id, [...new Set(recipientLetterRows.map((row) => row.letterId))]),
      );
    }

    await tx.insert(auditLog).values({
      action: 'undo',
      entityType: 'person',
      entityId,
      userId: actor,
      changes: {
        targetActionId: actionId,
        targetAction: 'person.rename',
      },
    });
  });
}

export async function undoPersonMerge(actionId: string, actor: string = 'admin'): Promise<void> {
  const entry = await getPersonAuditEntryForUndo(actionId, 'person.merge');
  const changes = (entry.changes || {}) as {
    keepId?: string;
    mergeId?: string;
    keepBefore?: MergePersonSnapshot;
    keepPostMerge?: MergePersonSnapshot;
    mergeBefore?: MergePersonSnapshot;
    movedLinks?: MergePersonLinkSnapshot[];
    retainedLinksPostMerge?: MergePersonLinkSnapshot[];
    deletedDuplicateLinks?: MergePersonLinkSnapshot[];
    mutatedExistingLinks?: Array<{
      id: string;
      before: MergePersonLinkSnapshot;
    }>;
    movedRelationships?: MergeRelationshipSnapshot[];
    retainedRelationshipsPostMerge?: MergeRelationshipSnapshot[];
    deletedRelationships?: MergeRelationshipSnapshot[];
    mutatedExistingRelationships?: Array<{
      id: string;
      before: MergeRelationshipSnapshot;
    }>;
  };

  if (
    !changes.keepId ||
    !changes.mergeBefore?.id ||
    !changes.mergeBefore.canonicalName ||
    !changes.keepBefore ||
    !changes.keepPostMerge ||
    !changes.movedLinks ||
    !changes.retainedLinksPostMerge ||
    !changes.retainedRelationshipsPostMerge
  ) {
    throw new Error('Undo payload is missing required merge integrity data');
  }

  // Extract narrowed values so TypeScript preserves types inside transaction callback
  const keepId = changes.keepId;
  const mergeBefore = changes.mergeBefore;
  const keepBefore = changes.keepBefore;
  const keepPostMerge = changes.keepPostMerge;
  const movedLinks = changes.movedLinks;
  const retainedLinksPostMerge = changes.retainedLinksPostMerge;
  const retainedRelationshipsPostMerge = changes.retainedRelationshipsPostMerge;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT ${canonicalPersons.id}
      FROM ${canonicalPersons}
      WHERE ${canonicalPersons.id} = ${keepId}
      FOR UPDATE
    `);
    for (
      const linkId of retainedLinksPostMerge
        .map((link) => link.id)
        .sort()
    ) {
      await tx.execute(sql`
        SELECT ${letterPersons.id}
        FROM ${letterPersons}
        WHERE ${letterPersons.id} = ${linkId}
        FOR UPDATE
      `);
    }
    for (
      const relationshipId of retainedRelationshipsPostMerge
        .map((relationship) => relationship.id)
        .sort()
    ) {
      await tx.execute(sql`
        SELECT ${personRelationships.id}
        FROM ${personRelationships}
        WHERE ${personRelationships.id} = ${relationshipId}
        FOR UPDATE
      `);
    }

    const currentKeep = await tx.query.canonicalPersons.findMany({
      where: eq(canonicalPersons.id, keepId),
    });
    assertSnapshotsUnchanged(
      'Retained person',
      [keepPostMerge],
      currentKeep.map(serializePerson),
    );

    const currentLinks = retainedLinksPostMerge.length > 0
      ? await tx.query.letterPersons.findMany({
          where: inArray(
            letterPersons.id,
            retainedLinksPostMerge.map((link) => link.id),
          ),
        })
      : [];
    assertSnapshotsUnchanged(
      'Retained person links',
      retainedLinksPostMerge,
      currentLinks.map(serializePersonLink),
    );

    const currentRelationships = retainedRelationshipsPostMerge.length > 0
      ? await tx.query.personRelationships.findMany({
          where: inArray(
            personRelationships.id,
            retainedRelationshipsPostMerge.map(
              (relationship) => relationship.id,
            ),
          ),
        })
      : [];
    assertSnapshotsUnchanged(
      'Retained person relationships',
      retainedRelationshipsPostMerge,
      currentRelationships.map(serializeRelationship),
    );

    const restoredMergePerson = await tx
      .insert(canonicalPersons)
      .values({
        id: mergeBefore.id!,
        canonicalName: mergeBefore.canonicalName!,
        aliases: mergeBefore.aliases || [],
        notes: mergeBefore.notes ?? null,
        biography: mergeBefore.biography ?? null,
        biographyStatus: (mergeBefore.biographyStatus as CanonicalPerson['biographyStatus']) ?? 'EMPTY',
        biographyVerifiedAt: mergeBefore.biographyVerifiedAt
          ? new Date(mergeBefore.biographyVerifiedAt)
          : null,
        biographyVerifiedBy: mergeBefore.biographyVerifiedBy ?? null,
        createdAt: mergeBefore.createdAt
          ? new Date(mergeBefore.createdAt)
          : new Date(),
        updatedAt: mergeBefore.updatedAt
          ? new Date(mergeBefore.updatedAt)
          : new Date(),
      })
      .returning({ id: canonicalPersons.id });
    assertRestoredIds('merged person', [mergeBefore.id!], restoredMergePerson);

    const restoredKeepPerson = await tx
      .update(canonicalPersons)
      .set({
        aliases: keepBefore.aliases || [],
        updatedAt: new Date(),
      })
      .where(eq(canonicalPersons.id, keepId))
      .returning({ id: canonicalPersons.id });
    assertRestoredIds('retained person', [keepId], restoredKeepPerson);

    const movedLinkIds = movedLinks.map((link) => link.id);
    if (movedLinkIds.length > 0) {
      const restoredLinks = await tx
        .update(letterPersons)
        .set({ personId: mergeBefore.id! })
        .where(inArray(letterPersons.id, movedLinkIds))
        .returning({ id: letterPersons.id });
      assertRestoredIds('moved person links', movedLinkIds, restoredLinks);
    }

    for (const link of changes.mutatedExistingLinks || []) {
      const restoredLink = await tx
        .update(letterPersons)
        .set({
          nameAsWritten: link.before.nameAsWritten,
          relationshipToSender: link.before.relationshipToSender,
          context: link.before.context,
          confidence: link.before.confidence,
          entityExtractionRevision: link.before.entityExtractionRevision ?? null,
          confirmedBy: link.before.confirmedBy,
          confirmedAt: link.before.confirmedAt
            ? new Date(link.before.confirmedAt)
            : null,
        })
        .where(eq(letterPersons.id, link.id))
        .returning({ id: letterPersons.id });
      assertRestoredIds('mutated person link', [link.id], restoredLink);
    }

    for (const dupLink of changes.deletedDuplicateLinks || []) {
      const restoredLink = await tx.insert(letterPersons).values({
        id: dupLink.id,
        letterId: dupLink.letterId,
        personId: dupLink.personId,
        role: dupLink.role,
        nameAsWritten: dupLink.nameAsWritten,
        relationshipToSender: dupLink.relationshipToSender,
        context: dupLink.context,
        confidence: dupLink.confidence,
        entityExtractionRevision: dupLink.entityExtractionRevision ?? null,
        confirmedBy: dupLink.confirmedBy,
        confirmedAt: dupLink.confirmedAt ? new Date(dupLink.confirmedAt) : null,
        createdAt: new Date(dupLink.createdAt),
      }).returning({ id: letterPersons.id });
      assertRestoredIds('deleted person link', [dupLink.id], restoredLink);
    }

    for (const rel of changes.movedRelationships || []) {
      const restoredRelationship = await tx.update(personRelationships).set({
        personAId: rel.personAId,
        personBId: rel.personBId,
        updatedAt: new Date(rel.updatedAt),
      }).where(eq(personRelationships.id, rel.id)).returning({
        id: personRelationships.id,
      });
      assertRestoredIds('moved person relationship', [rel.id], restoredRelationship);
    }

    for (const rel of changes.mutatedExistingRelationships || []) {
      const restoredRelationship = await tx.update(personRelationships).set({
        relationshipType: rel.before.relationshipType as PersonRelationshipType,
        notes: rel.before.notes,
        discoveredInLetterId: rel.before.discoveredInLetterId,
        entityExtractionRevision: rel.before.entityExtractionRevision ?? null,
        confidence: rel.before.confidence,
        confirmedBy: rel.before.confirmedBy,
        confirmedAt: rel.before.confirmedAt ? new Date(rel.before.confirmedAt) : null,
        updatedAt: new Date(rel.before.updatedAt),
      }).where(eq(personRelationships.id, rel.id)).returning({
        id: personRelationships.id,
      });
      assertRestoredIds('mutated person relationship', [rel.id], restoredRelationship);
    }

    for (const rel of changes.deletedRelationships || []) {
      const restoredRelationship = await tx.insert(personRelationships).values({
        id: rel.id,
        personAId: rel.personAId,
        personBId: rel.personBId,
        relationshipType: rel.relationshipType as PersonRelationshipType,
        notes: rel.notes,
        discoveredInLetterId: rel.discoveredInLetterId,
        entityExtractionRevision: rel.entityExtractionRevision ?? null,
        confidence: rel.confidence,
        confirmedBy: rel.confirmedBy,
        confirmedAt: rel.confirmedAt ? new Date(rel.confirmedAt) : null,
        createdAt: new Date(rel.createdAt),
        updatedAt: new Date(rel.updatedAt),
      }).returning({ id: personRelationships.id });
      assertRestoredIds('deleted person relationship', [rel.id], restoredRelationship);
    }

    await tx.insert(auditLog).values({
      action: 'undo',
      entityType: 'person',
      entityId: keepId,
      userId: actor,
      changes: {
        targetActionId: actionId,
        targetAction: 'person.merge',
      },
    });
  });
}

export async function getAllPersonsWithCounts(): Promise<
  {
    id: string;
    canonicalName: string;
    aliases: string[] | null;
    letterCount: number;
  }[]
> {
  const results = await db
    .select({
      id: canonicalPersons.id,
      canonicalName: canonicalPersons.canonicalName,
      aliases: canonicalPersons.aliases,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})`,
    })
    .from(canonicalPersons)
    .leftJoin(letterPersons, eq(canonicalPersons.id, letterPersons.personId))
    .groupBy(canonicalPersons.id, canonicalPersons.canonicalName, canonicalPersons.aliases)
    .orderBy(desc(sql`COUNT(DISTINCT ${letterPersons.letterId})`));

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases,
    letterCount: Number(r.letterCount),
  }));
}

export interface DuplicateSuggestion {
  entityAId: string;
  entityAName: string;
  entityALetterCount: number;
  entityAAliases: string[];
  entityBId: string;
  entityBName: string;
  entityBLetterCount: number;
  entityBAliases: string[];
  similarity: number;
}

function getRows<T>(results: unknown): T[] {
  if (Array.isArray(results)) {
    return results as T[];
  }
  return ((results as { rows?: T[] }).rows ?? []) as T[];
}

export async function findPotentialDuplicatePersons(
  limit: number = PAGINATION.ENTITY_PAGE_SIZE,
): Promise<DuplicateSuggestion[]> {
  const results = await db.execute<{
    entity_a_id: string;
    entity_a_name: string;
    entity_a_letter_count: number;
    entity_a_aliases: string[] | null;
    entity_b_id: string;
    entity_b_name: string;
    entity_b_letter_count: number;
    entity_b_aliases: string[] | null;
    similarity_score: number;
  }>(sql`
    WITH person_letter_counts AS (
      SELECT
        cp.id,
        cp.canonical_name,
        cp.aliases,
        COUNT(DISTINCT lp.letter_id) as letter_count
      FROM canonical_persons cp
      LEFT JOIN letter_persons lp ON cp.id = lp.person_id
      GROUP BY cp.id, cp.canonical_name, cp.aliases
    )
    SELECT
      a.id as entity_a_id,
      a.canonical_name as entity_a_name,
      a.letter_count::int as entity_a_letter_count,
      a.aliases as entity_a_aliases,
      b.id as entity_b_id,
      b.canonical_name as entity_b_name,
      b.letter_count::int as entity_b_letter_count,
      b.aliases as entity_b_aliases,
      similarity(a.canonical_name, b.canonical_name) as similarity_score
    FROM person_letter_counts a
    CROSS JOIN person_letter_counts b
    WHERE a.id < b.id
      AND similarity(a.canonical_name, b.canonical_name) >= 0.50
      AND similarity(a.canonical_name, b.canonical_name) < 1.0
    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  return getRows<{
    entity_a_id: string;
    entity_a_name: string;
    entity_a_letter_count: number;
    entity_a_aliases: string[] | null;
    entity_b_id: string;
    entity_b_name: string;
    entity_b_letter_count: number;
    entity_b_aliases: string[] | null;
    similarity_score: number;
  }>(results).map((row) => ({
    entityAId: row.entity_a_id,
    entityAName: row.entity_a_name,
    entityALetterCount: Number(row.entity_a_letter_count),
    entityAAliases: row.entity_a_aliases || [],
    entityBId: row.entity_b_id,
    entityBName: row.entity_b_name,
    entityBLetterCount: Number(row.entity_b_letter_count),
    entityBAliases: row.entity_b_aliases || [],
    similarity: Math.round(row.similarity_score * 100),
  }));
}

export async function bulkMergePersons(
  keepId: string,
  mergeIds: string[],
): Promise<void> {
  const keepPerson = await getCanonicalPersonById(keepId);
  if (!keepPerson) {
    throw new Error('Master person not found');
  }

  const idsToMerge = mergeIds.filter((id) => id !== keepId);
  if (idsToMerge.length === 0) {
    throw new Error('No persons to merge');
  }

  for (const mergeId of idsToMerge) {
    const mergePerson = await getCanonicalPersonById(mergeId);
    if (mergePerson) {
      await mergePersons(keepId, mergeId);
    }
  }
}

export interface PersonDetailsForMerge {
  id: string;
  canonicalName: string;
  aliases: string[];
  notes: string | null;
  letterCount: number;
  senderCount: number;
  recipientCount: number;
  mentionedCount: number;
  relationshipCount: number;
  biography: string | null;
  biographyStatus: string | null;
}

export interface SameNamePersonCandidate {
  id: string;
  canonicalName: string;
  aliases: string[];
  letterCount: number;
}

export async function getPersonDetailsForMerge(
  id: string,
): Promise<PersonDetailsForMerge | null> {
  const person = await getCanonicalPersonById(id);
  if (!person) return null;

  const roleCountsResult = await db
    .select({
      role: letterPersons.role,
      count: sql<number>`COUNT(*)`,
    })
    .from(letterPersons)
    .where(eq(letterPersons.personId, id))
    .groupBy(letterPersons.role);

  const roleCounts = {
    sender: 0,
    recipient: 0,
    mentioned: 0,
  };

  for (const r of roleCountsResult) {
    if (r.role === 'sender') roleCounts.sender = Number(r.count);
    else if (r.role === 'recipient') roleCounts.recipient = Number(r.count);
    else if (r.role === 'mentioned') roleCounts.mentioned = Number(r.count);
  }

  const relationshipsResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(personRelationships)
    .where(
      or(
        eq(personRelationships.personAId, id),
        eq(personRelationships.personBId, id),
      ),
    );

  const relationshipCount = Number(relationshipsResult[0]?.count || 0);

  return {
    id: person.id,
    canonicalName: person.canonicalName,
    aliases: person.aliases || [],
    notes: person.notes,
    letterCount: roleCounts.sender + roleCounts.recipient + roleCounts.mentioned,
    senderCount: roleCounts.sender,
    recipientCount: roleCounts.recipient,
    mentionedCount: roleCounts.mentioned,
    relationshipCount,
    biography: person.biography,
    biographyStatus: person.biographyStatus,
  };
}

export async function getSameNamePersonCandidates(
  id: string,
): Promise<SameNamePersonCandidate[]> {
  const person = await getCanonicalPersonById(id);
  if (!person) {
    return [];
  }

  const matches = await db
    .select({
      id: canonicalPersons.id,
      canonicalName: canonicalPersons.canonicalName,
      aliases: canonicalPersons.aliases,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})`,
    })
    .from(canonicalPersons)
    .leftJoin(letterPersons, eq(canonicalPersons.id, letterPersons.personId))
    .where(
      and(
        eq(canonicalPersons.canonicalName, person.canonicalName),
        sql`${canonicalPersons.id} <> ${id}`,
      ),
    )
    .groupBy(canonicalPersons.id, canonicalPersons.canonicalName, canonicalPersons.aliases)
    .orderBy(desc(sql`COUNT(DISTINCT ${letterPersons.letterId})`));

  return matches.map((row) => ({
    id: row.id,
    canonicalName: row.canonicalName,
    aliases: row.aliases || [],
    letterCount: Number(row.letterCount),
  }));
}
