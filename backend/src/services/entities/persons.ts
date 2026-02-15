import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
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

async function rewritePersonNameReferences(personId: string, canonicalName: string): Promise<void> {
  await db.update(letterPersons).set({ nameAsWritten: canonicalName }).where(eq(letterPersons.personId, personId));

  const senderLetterRows = await db
    .select({ letterId: letterPersons.letterId })
    .from(letterPersons)
    .where(and(eq(letterPersons.personId, personId), eq(letterPersons.role, 'sender')));

  if (senderLetterRows.length > 0) {
    await db.update(letters).set({
      sender: canonicalName,
      updatedAt: new Date(),
    }).where(
      inArray(
        letters.id,
        [...new Set(senderLetterRows.map((row) => row.letterId))],
      ),
    );
  }

  const recipientLetterRows = await db
    .select({ letterId: letterPersons.letterId })
    .from(letterPersons)
    .where(and(eq(letterPersons.personId, personId), eq(letterPersons.role, 'recipient')));

  if (recipientLetterRows.length > 0) {
    await db.update(letters).set({
      recipient: canonicalName,
      updatedAt: new Date(),
    }).where(
      inArray(
        letters.id,
        [...new Set(recipientLetterRows.map((row) => row.letterId))],
      ),
    );
  }
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

  await updateCanonicalPerson(id, data);

  if (data.canonicalName && data.canonicalName !== existing.canonicalName) {
    await rewritePersonNameReferences(id, data.canonicalName);
  }

  const updated = await getCanonicalPersonById(id);
  if (!updated) {
    throw new Error('Person disappeared after update');
  }

  if (before.canonicalName === updated.canonicalName) {
    return { undoActionId: null };
  }

  const undoActionId = await createPersonAuditEntry({
    action: 'person.rename',
    entityId: id,
    actor,
    changes: {
      before,
      after: {
        canonicalName: updated.canonicalName,
        aliases: updated.aliases || [],
        notes: updated.notes,
      },
    },
  });

  return { undoActionId };
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
  const keepPerson = await getCanonicalPersonById(keepId);
  const mergePerson = await getCanonicalPersonById(mergeId);

  if (!keepPerson || !mergePerson) {
    throw new Error('Both persons must exist');
  }
  if (keepId === mergeId) {
    throw new Error('Cannot merge a person into itself');
  }

  const keepBefore = {
    canonicalName: keepPerson.canonicalName,
    aliases: keepPerson.aliases || [],
    notes: keepPerson.notes,
    biography: keepPerson.biography,
    biographyStatus: keepPerson.biographyStatus,
    biographyVerifiedAt: serializeDate(keepPerson.biographyVerifiedAt),
    biographyVerifiedBy: keepPerson.biographyVerifiedBy,
  };

  const mergeBefore = {
    id: mergePerson.id,
    canonicalName: mergePerson.canonicalName,
    aliases: mergePerson.aliases || [],
    notes: mergePerson.notes,
    biography: mergePerson.biography,
    biographyStatus: mergePerson.biographyStatus,
    biographyVerifiedAt: serializeDate(mergePerson.biographyVerifiedAt),
    biographyVerifiedBy: mergePerson.biographyVerifiedBy,
    createdAt: mergePerson.createdAt.toISOString(),
    updatedAt: mergePerson.updatedAt.toISOString(),
  };

  const mergeLinks = await db.query.letterPersons.findMany({
    where: eq(letterPersons.personId, mergeId),
  });

  const mergeRelationships = await db.query.personRelationships.findMany({
    where: or(
      eq(personRelationships.personAId, mergeId),
      eq(personRelationships.personBId, mergeId),
    ),
  });

  const combinedAliases = [
    ...(keepPerson.aliases || []),
    mergePerson.canonicalName,
    ...(mergePerson.aliases || []),
  ];

  await updateCanonicalPerson(keepId, { aliases: uniqueStrings(combinedAliases) });

  const movedLinkIds: string[] = [];
  const deletedDuplicateLinks = [];

  for (const link of mergeLinks) {
    const existingTarget = await db.query.letterPersons.findFirst({
      where: and(
        eq(letterPersons.letterId, link.letterId),
        eq(letterPersons.personId, keepId),
        eq(letterPersons.role, link.role),
      ),
    });

    if (existingTarget) {
      const mergedContext = uniqueStrings([
        existingTarget.context,
        link.context,
      ]).join(' | ') || null;

      await db.update(letterPersons).set({
        confidence: Math.max(existingTarget.confidence, link.confidence),
        context: mergedContext,
        relationshipToSender: existingTarget.relationshipToSender || link.relationshipToSender,
        nameAsWritten: existingTarget.nameAsWritten || link.nameAsWritten,
      }).where(eq(letterPersons.id, existingTarget.id));

      await db.delete(letterPersons).where(eq(letterPersons.id, link.id));

      deletedDuplicateLinks.push({
        ...link,
        createdAt: link.createdAt.toISOString(),
      });
      continue;
    }

    await db.update(letterPersons).set({
      personId: keepId,
    }).where(eq(letterPersons.id, link.id));
    movedLinkIds.push(link.id);
  }

  const movedRelationships: MergeRelationshipSnapshot[] = [];
  const deletedRelationships: MergeRelationshipSnapshot[] = [];
  const mutatedExistingRelationships: Array<{
    id: string;
    before: MergeRelationshipSnapshot;
  }> = [];

  for (const rel of mergeRelationships) {
    const otherPersonId = rel.personAId === mergeId ? rel.personBId : rel.personAId;

    if (otherPersonId === keepId) {
      deletedRelationships.push(serializeRelationship(rel));
      await db.delete(personRelationships).where(eq(personRelationships.id, rel.id));
      continue;
    }

    const [newA, newB] = [keepId, otherPersonId].sort();
    const existing = await db.query.personRelationships.findFirst({
      where: and(
        eq(personRelationships.personAId, newA),
        eq(personRelationships.personBId, newB),
      ),
    });

    if (existing && existing.id !== rel.id) {
      if (rel.confidence > existing.confidence) {
        mutatedExistingRelationships.push({
          id: existing.id,
          before: serializeRelationship(existing),
        });

        await db.update(personRelationships).set({
          relationshipType: rel.relationshipType,
          notes: rel.notes || existing.notes,
          discoveredInLetterId: rel.discoveredInLetterId || existing.discoveredInLetterId,
          confidence: rel.confidence,
          confirmedBy: rel.confirmedBy || existing.confirmedBy,
          confirmedAt: rel.confirmedAt || existing.confirmedAt,
          updatedAt: new Date(),
        }).where(eq(personRelationships.id, existing.id));
      }

      deletedRelationships.push(serializeRelationship(rel));
      await db.delete(personRelationships).where(eq(personRelationships.id, rel.id));
      continue;
    }

    movedRelationships.push(serializeRelationship(rel));
    await db.update(personRelationships).set({
      personAId: newA,
      personBId: newB,
      updatedAt: new Date(),
    }).where(eq(personRelationships.id, rel.id));
  }

  await db.delete(canonicalPersons).where(eq(canonicalPersons.id, mergeId));

  if (!trackUndo) {
    return { undoActionId: null };
  }

  const undoActionId = await createPersonAuditEntry({
    action: 'person.merge',
    entityId: keepId,
    actor,
    changes: {
      keepId,
      mergeId,
      keepBefore,
      mergeBefore,
      movedLinkIds,
      deletedDuplicateLinks,
      movedRelationships,
      deletedRelationships,
      mutatedExistingRelationships,
    },
  });

  return { undoActionId };
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

  await db.update(canonicalPersons).set({
    canonicalName: changes.before.canonicalName,
    aliases: changes.before.aliases || [],
    notes: changes.before.notes ?? null,
    updatedAt: new Date(),
  }).where(eq(canonicalPersons.id, entry.entityId));

  await rewritePersonNameReferences(entry.entityId, changes.before.canonicalName);

  await createPersonAuditEntry({
    action: 'undo',
    entityId: entry.entityId,
    actor,
    changes: {
      targetActionId: actionId,
      targetAction: 'person.rename',
    },
  });
}

export async function undoPersonMerge(actionId: string, actor: string = 'admin'): Promise<void> {
  const entry = await getPersonAuditEntryForUndo(actionId, 'person.merge');
  const changes = (entry.changes || {}) as {
    keepId?: string;
    mergeId?: string;
    keepBefore?: {
      canonicalName?: string;
      aliases?: string[];
      notes?: string | null;
      biography?: string | null;
      biographyStatus?: string | null;
      biographyVerifiedAt?: string | null;
      biographyVerifiedBy?: string | null;
    };
    mergeBefore?: {
      id?: string;
      canonicalName?: string;
      aliases?: string[];
      notes?: string | null;
      biography?: string | null;
      biographyStatus?: string | null;
      biographyVerifiedAt?: string | null;
      biographyVerifiedBy?: string | null;
      createdAt?: string;
      updatedAt?: string;
    };
    movedLinkIds?: string[];
    deletedDuplicateLinks?: Array<{
      id: string;
      letterId: string;
      personId: string;
      role: 'sender' | 'recipient' | 'mentioned';
      nameAsWritten: string | null;
      relationshipToSender: string | null;
      context: string | null;
      confidence: number;
      confirmedBy: string | null;
      confirmedAt: string | null;
      createdAt: string;
    }>;
    movedRelationships?: MergeRelationshipSnapshot[];
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
    !changes.keepBefore
  ) {
    throw new Error('Undo payload is missing required merge data');
  }

  const mergePersonExists = await getCanonicalPersonById(changes.mergeBefore.id);
  if (!mergePersonExists) {
    await db.insert(canonicalPersons).values({
      id: changes.mergeBefore.id,
      canonicalName: changes.mergeBefore.canonicalName,
      aliases: changes.mergeBefore.aliases || [],
      notes: changes.mergeBefore.notes ?? null,
      biography: changes.mergeBefore.biography ?? null,
      biographyStatus: (changes.mergeBefore.biographyStatus as CanonicalPerson['biographyStatus']) ?? 'EMPTY',
      biographyVerifiedAt: changes.mergeBefore.biographyVerifiedAt
        ? new Date(changes.mergeBefore.biographyVerifiedAt)
        : null,
      biographyVerifiedBy: changes.mergeBefore.biographyVerifiedBy ?? null,
      createdAt: changes.mergeBefore.createdAt
        ? new Date(changes.mergeBefore.createdAt)
        : new Date(),
      updatedAt: changes.mergeBefore.updatedAt
        ? new Date(changes.mergeBefore.updatedAt)
        : new Date(),
    });
  }

  await db.update(canonicalPersons).set({
    canonicalName: changes.keepBefore.canonicalName,
    aliases: changes.keepBefore.aliases || [],
    notes: changes.keepBefore.notes ?? null,
    biography: changes.keepBefore.biography ?? null,
    biographyStatus: (changes.keepBefore.biographyStatus as CanonicalPerson['biographyStatus']) ?? 'EMPTY',
    biographyVerifiedAt: changes.keepBefore.biographyVerifiedAt
      ? new Date(changes.keepBefore.biographyVerifiedAt)
      : null,
    biographyVerifiedBy: changes.keepBefore.biographyVerifiedBy ?? null,
    updatedAt: new Date(),
  }).where(eq(canonicalPersons.id, changes.keepId));

  const movedLinkIds = changes.movedLinkIds || [];
  if (movedLinkIds.length > 0) {
    await db.update(letterPersons).set({
      personId: changes.mergeBefore.id,
    }).where(inArray(letterPersons.id, movedLinkIds));
  }

  for (const dupLink of changes.deletedDuplicateLinks || []) {
    await db.insert(letterPersons).values({
      id: dupLink.id,
      letterId: dupLink.letterId,
      personId: dupLink.personId,
      role: dupLink.role,
      nameAsWritten: dupLink.nameAsWritten,
      relationshipToSender: dupLink.relationshipToSender,
      context: dupLink.context,
      confidence: dupLink.confidence,
      confirmedBy: dupLink.confirmedBy,
      confirmedAt: dupLink.confirmedAt ? new Date(dupLink.confirmedAt) : null,
      createdAt: new Date(dupLink.createdAt),
    }).onConflictDoNothing();
  }

  for (const rel of changes.movedRelationships || []) {
    await db.update(personRelationships).set({
      personAId: rel.personAId,
      personBId: rel.personBId,
      relationshipType: rel.relationshipType as PersonRelationshipType,
      notes: rel.notes,
      discoveredInLetterId: rel.discoveredInLetterId,
      confidence: rel.confidence,
      confirmedBy: rel.confirmedBy,
      confirmedAt: rel.confirmedAt ? new Date(rel.confirmedAt) : null,
      updatedAt: new Date(rel.updatedAt),
    }).where(eq(personRelationships.id, rel.id));
  }

  for (const rel of changes.mutatedExistingRelationships || []) {
    await db.update(personRelationships).set({
      personAId: rel.before.personAId,
      personBId: rel.before.personBId,
      relationshipType: rel.before.relationshipType as PersonRelationshipType,
      notes: rel.before.notes,
      discoveredInLetterId: rel.before.discoveredInLetterId,
      confidence: rel.before.confidence,
      confirmedBy: rel.before.confirmedBy,
      confirmedAt: rel.before.confirmedAt ? new Date(rel.before.confirmedAt) : null,
      updatedAt: new Date(rel.before.updatedAt),
    }).where(eq(personRelationships.id, rel.id));
  }

  for (const rel of changes.deletedRelationships || []) {
    await db.insert(personRelationships).values({
      id: rel.id,
      personAId: rel.personAId,
      personBId: rel.personBId,
      relationshipType: rel.relationshipType as PersonRelationshipType,
      notes: rel.notes,
      discoveredInLetterId: rel.discoveredInLetterId,
      confidence: rel.confidence,
      confirmedBy: rel.confirmedBy,
      confirmedAt: rel.confirmedAt ? new Date(rel.confirmedAt) : null,
      createdAt: new Date(rel.createdAt),
      updatedAt: new Date(rel.updatedAt),
    }).onConflictDoNothing();
  }

  await createPersonAuditEntry({
    action: 'undo',
    entityId: changes.keepId,
    actor,
    changes: {
      targetActionId: actionId,
      targetAction: 'person.merge',
    },
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
  limit: number = 20,
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
