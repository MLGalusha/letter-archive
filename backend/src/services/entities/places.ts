import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  auditLog,
  db,
  canonicalPlaces,
  letterPlaces,
  letters,
  type AuditLog,
  type CanonicalPlace,
  type NewCanonicalPlace,
  type PlaceType,
} from '../../db/index.js';
import type { DuplicateSuggestion } from './persons.js';

export async function createCanonicalPlace(
  data: Omit<NewCanonicalPlace, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const [place] = await db
    .insert(canonicalPlaces)
    .values(data)
    .returning({ id: canonicalPlaces.id });
  return place.id;
}

export async function getCanonicalPlaceById(
  id: string,
): Promise<CanonicalPlace | undefined> {
  return db.query.canonicalPlaces.findFirst({
    where: eq(canonicalPlaces.id, id),
  });
}

export async function getAllCanonicalPlaces(): Promise<CanonicalPlace[]> {
  return db.query.canonicalPlaces.findMany({
    orderBy: [asc(canonicalPlaces.canonicalName)],
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

async function rewritePlaceNameReferences(placeId: string, canonicalName: string): Promise<void> {
  await db.update(letterPlaces).set({ nameAsWritten: canonicalName }).where(eq(letterPlaces.placeId, placeId));

  const writtenFromLetterRows = await db
    .select({ letterId: letterPlaces.letterId })
    .from(letterPlaces)
    .where(
      and(
        eq(letterPlaces.placeId, placeId),
        eq(letterPlaces.role, 'written_from'),
      ),
    );

  if (writtenFromLetterRows.length > 0) {
    await db.update(letters).set({
      locationWritten: canonicalName,
      updatedAt: new Date(),
    }).where(
      inArray(
        letters.id,
        [...new Set(writtenFromLetterRows.map((row) => row.letterId))],
      ),
    );
  }
}

async function createPlaceAuditEntry(input: {
  action: string;
  entityId: string;
  actor: string;
  changes: Record<string, unknown>;
}): Promise<string> {
  const [entry] = await db.insert(auditLog).values({
    action: input.action,
    entityType: 'place',
    entityId: input.entityId,
    userId: input.actor,
    changes: input.changes,
  }).returning({ id: auditLog.id });

  return entry.id;
}

export async function updateCanonicalPlace(
  id: string,
  data: Partial<
    Pick<CanonicalPlace, 'canonicalName' | 'aliases' | 'placeType' | 'notes'>
  >,
): Promise<void> {
  await db
    .update(canonicalPlaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(canonicalPlaces.id, id));
}

export async function updateCanonicalPlaceWithUndo(
  id: string,
  data: Partial<
    Pick<CanonicalPlace, 'canonicalName' | 'aliases' | 'placeType' | 'notes'>
  >,
  actor: string = 'admin',
): Promise<{ undoActionId: string | null }> {
  const existing = await getCanonicalPlaceById(id);
  if (!existing) {
    throw new Error('Place not found');
  }

  const before = {
    canonicalName: existing.canonicalName,
    aliases: existing.aliases || [],
    placeType: existing.placeType,
    notes: existing.notes,
  };

  await updateCanonicalPlace(id, data);

  if (data.canonicalName && data.canonicalName !== existing.canonicalName) {
    await rewritePlaceNameReferences(id, data.canonicalName);
  }

  const updated = await getCanonicalPlaceById(id);
  if (!updated) {
    throw new Error('Place disappeared after update');
  }

  if (before.canonicalName === updated.canonicalName) {
    return { undoActionId: null };
  }

  const undoActionId = await createPlaceAuditEntry({
    action: 'place.rename',
    entityId: id,
    actor,
    changes: {
      before,
      after: {
        canonicalName: updated.canonicalName,
        aliases: updated.aliases || [],
        placeType: updated.placeType,
        notes: updated.notes,
      },
    },
  });

  return { undoActionId };
}

export async function mergePlaces(keepId: string, mergeId: string): Promise<void> {
  await mergePlacesWithUndo(keepId, mergeId, 'admin', false);
}

export async function mergePlacesWithUndo(
  keepId: string,
  mergeId: string,
  actor: string = 'admin',
  trackUndo: boolean = true,
): Promise<{ undoActionId: string | null }> {
  const keepPlace = await getCanonicalPlaceById(keepId);
  const mergePlace = await getCanonicalPlaceById(mergeId);

  if (!keepPlace || !mergePlace) {
    throw new Error('Both places must exist');
  }
  if (keepId === mergeId) {
    throw new Error('Cannot merge a place into itself');
  }

  const keepBefore = {
    canonicalName: keepPlace.canonicalName,
    aliases: keepPlace.aliases || [],
    placeType: keepPlace.placeType,
    notes: keepPlace.notes,
  };

  const mergeBefore = {
    id: mergePlace.id,
    canonicalName: mergePlace.canonicalName,
    aliases: mergePlace.aliases || [],
    placeType: mergePlace.placeType,
    notes: mergePlace.notes,
    createdAt: mergePlace.createdAt.toISOString(),
    updatedAt: mergePlace.updatedAt.toISOString(),
  };

  const mergeLinks = await db.query.letterPlaces.findMany({
    where: eq(letterPlaces.placeId, mergeId),
  });

  const combinedAliases = [
    ...(keepPlace.aliases || []),
    mergePlace.canonicalName,
    ...(mergePlace.aliases || []),
  ];

  await updateCanonicalPlace(keepId, { aliases: uniqueStrings(combinedAliases) });

  const movedLinkIds: string[] = [];
  const deletedDuplicateLinks = [];

  for (const link of mergeLinks) {
    const existingTarget = await db.query.letterPlaces.findFirst({
      where: and(
        eq(letterPlaces.letterId, link.letterId),
        eq(letterPlaces.placeId, keepId),
        eq(letterPlaces.role, link.role),
      ),
    });

    if (existingTarget) {
      await db.update(letterPlaces).set({
        confidence: Math.max(existingTarget.confidence, link.confidence),
        context: uniqueStrings([existingTarget.context, link.context]).join(' | ') || null,
        nameAsWritten: existingTarget.nameAsWritten || link.nameAsWritten,
      }).where(eq(letterPlaces.id, existingTarget.id));

      await db.delete(letterPlaces).where(eq(letterPlaces.id, link.id));
      deletedDuplicateLinks.push({
        ...link,
        createdAt: link.createdAt.toISOString(),
      });
      continue;
    }

    await db.update(letterPlaces).set({
      placeId: keepId,
    }).where(eq(letterPlaces.id, link.id));
    movedLinkIds.push(link.id);
  }

  await db.delete(canonicalPlaces).where(eq(canonicalPlaces.id, mergeId));

  if (!trackUndo) {
    return { undoActionId: null };
  }

  const undoActionId = await createPlaceAuditEntry({
    action: 'place.merge',
    entityId: keepId,
    actor,
    changes: {
      keepId,
      mergeId,
      keepBefore,
      mergeBefore,
      movedLinkIds,
      deletedDuplicateLinks,
    },
  });

  return { undoActionId };
}

async function getPlaceAuditEntryForUndo(
  actionId: string,
  expectedAction: 'place.rename' | 'place.merge',
): Promise<AuditLog> {
  const entry = await db.query.auditLog.findFirst({
    where: and(
      eq(auditLog.id, actionId),
      eq(auditLog.entityType, 'place'),
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

export async function undoPlaceRename(actionId: string, actor: string = 'admin'): Promise<void> {
  const entry = await getPlaceAuditEntryForUndo(actionId, 'place.rename');
  const changes = (entry.changes || {}) as {
    before?: {
      canonicalName?: string;
      aliases?: string[];
      placeType?: PlaceType | null;
      notes?: string | null;
    };
  };

  if (!entry.entityId || !changes.before?.canonicalName) {
    throw new Error('Undo payload is missing required rename data');
  }

  await db.update(canonicalPlaces).set({
    canonicalName: changes.before.canonicalName,
    aliases: changes.before.aliases || [],
    placeType: changes.before.placeType ?? null,
    notes: changes.before.notes ?? null,
    updatedAt: new Date(),
  }).where(eq(canonicalPlaces.id, entry.entityId));

  await rewritePlaceNameReferences(entry.entityId, changes.before.canonicalName);

  await createPlaceAuditEntry({
    action: 'undo',
    entityId: entry.entityId,
    actor,
    changes: {
      targetActionId: actionId,
      targetAction: 'place.rename',
    },
  });
}

export async function undoPlaceMerge(actionId: string, actor: string = 'admin'): Promise<void> {
  const entry = await getPlaceAuditEntryForUndo(actionId, 'place.merge');
  const changes = (entry.changes || {}) as {
    keepId?: string;
    keepBefore?: {
      canonicalName?: string;
      aliases?: string[];
      placeType?: PlaceType | null;
      notes?: string | null;
    };
    mergeBefore?: {
      id?: string;
      canonicalName?: string;
      aliases?: string[];
      placeType?: PlaceType | null;
      notes?: string | null;
      createdAt?: string;
      updatedAt?: string;
    };
    movedLinkIds?: string[];
    deletedDuplicateLinks?: Array<{
      id: string;
      letterId: string;
      placeId: string;
      role: 'written_from' | 'mentioned' | 'destination';
      nameAsWritten: string | null;
      context: string | null;
      confidence: number;
      confirmedBy: string | null;
      confirmedAt: string | null;
      createdAt: string;
    }>;
  };

  if (
    !changes.keepId ||
    !changes.keepBefore ||
    !changes.mergeBefore?.id ||
    !changes.mergeBefore.canonicalName
  ) {
    throw new Error('Undo payload is missing required merge data');
  }

  const mergePlaceExists = await getCanonicalPlaceById(changes.mergeBefore.id);
  if (!mergePlaceExists) {
    await db.insert(canonicalPlaces).values({
      id: changes.mergeBefore.id,
      canonicalName: changes.mergeBefore.canonicalName,
      aliases: changes.mergeBefore.aliases || [],
      placeType: changes.mergeBefore.placeType ?? null,
      notes: changes.mergeBefore.notes ?? null,
      createdAt: changes.mergeBefore.createdAt
        ? new Date(changes.mergeBefore.createdAt)
        : new Date(),
      updatedAt: changes.mergeBefore.updatedAt
        ? new Date(changes.mergeBefore.updatedAt)
        : new Date(),
    });
  }

  await db.update(canonicalPlaces).set({
    canonicalName: changes.keepBefore.canonicalName,
    aliases: changes.keepBefore.aliases || [],
    placeType: changes.keepBefore.placeType ?? null,
    notes: changes.keepBefore.notes ?? null,
    updatedAt: new Date(),
  }).where(eq(canonicalPlaces.id, changes.keepId));

  const movedLinkIds = changes.movedLinkIds || [];
  if (movedLinkIds.length > 0) {
    await db.update(letterPlaces).set({
      placeId: changes.mergeBefore.id,
    }).where(inArray(letterPlaces.id, movedLinkIds));
  }

  for (const dupLink of changes.deletedDuplicateLinks || []) {
    await db.insert(letterPlaces).values({
      id: dupLink.id,
      letterId: dupLink.letterId,
      placeId: dupLink.placeId,
      role: dupLink.role,
      nameAsWritten: dupLink.nameAsWritten,
      context: dupLink.context,
      confidence: dupLink.confidence,
      confirmedBy: dupLink.confirmedBy,
      confirmedAt: dupLink.confirmedAt ? new Date(dupLink.confirmedAt) : null,
      createdAt: new Date(dupLink.createdAt),
    }).onConflictDoNothing();
  }

  await createPlaceAuditEntry({
    action: 'undo',
    entityId: changes.keepId,
    actor,
    changes: {
      targetActionId: actionId,
      targetAction: 'place.merge',
    },
  });
}

export async function getAllPlacesWithCounts(): Promise<
  {
    id: string;
    canonicalName: string;
    aliases: string[] | null;
    placeType: PlaceType | null;
    letterCount: number;
  }[]
> {
  const results = await db
    .select({
      id: canonicalPlaces.id,
      canonicalName: canonicalPlaces.canonicalName,
      aliases: canonicalPlaces.aliases,
      placeType: canonicalPlaces.placeType,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPlaces.letterId})`,
    })
    .from(canonicalPlaces)
    .leftJoin(letterPlaces, eq(canonicalPlaces.id, letterPlaces.placeId))
    .groupBy(
      canonicalPlaces.id,
      canonicalPlaces.canonicalName,
      canonicalPlaces.aliases,
      canonicalPlaces.placeType,
    )
    .orderBy(desc(sql`COUNT(DISTINCT ${letterPlaces.letterId})`));

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases,
    placeType: r.placeType,
    letterCount: Number(r.letterCount),
  }));
}

function getRows<T>(results: unknown): T[] {
  if (Array.isArray(results)) {
    return results as T[];
  }
  return ((results as { rows?: T[] }).rows ?? []) as T[];
}

export async function findPotentialDuplicatePlaces(
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
    WITH place_letter_counts AS (
      SELECT
        cp.id,
        cp.canonical_name,
        cp.aliases,
        COUNT(DISTINCT lp.letter_id) as letter_count
      FROM canonical_places cp
      LEFT JOIN letter_places lp ON cp.id = lp.place_id
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
    FROM place_letter_counts a
    CROSS JOIN place_letter_counts b
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

export async function bulkMergePlaces(
  keepId: string,
  mergeIds: string[],
): Promise<void> {
  const keepPlace = await getCanonicalPlaceById(keepId);
  if (!keepPlace) {
    throw new Error('Master place not found');
  }

  const idsToMerge = mergeIds.filter((id) => id !== keepId);
  if (idsToMerge.length === 0) {
    throw new Error('No places to merge');
  }

  for (const mergeId of idsToMerge) {
    const mergePlace = await getCanonicalPlaceById(mergeId);
    if (mergePlace) {
      await mergePlaces(keepId, mergeId);
    }
  }
}

export interface PlaceDetailsForMerge {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType: PlaceType | null;
  notes: string | null;
  letterCount: number;
  writtenFromCount: number;
  mentionedCount: number;
  destinationCount: number;
}

export async function getPlaceDetailsForMerge(
  id: string,
): Promise<PlaceDetailsForMerge | null> {
  const place = await getCanonicalPlaceById(id);
  if (!place) return null;

  const roleCountsResult = await db
    .select({
      role: letterPlaces.role,
      count: sql<number>`COUNT(*)`,
    })
    .from(letterPlaces)
    .where(eq(letterPlaces.placeId, id))
    .groupBy(letterPlaces.role);

  const roleCounts = {
    written_from: 0,
    mentioned: 0,
    destination: 0,
  };

  for (const r of roleCountsResult) {
    if (r.role === 'written_from') roleCounts.written_from = Number(r.count);
    else if (r.role === 'mentioned') roleCounts.mentioned = Number(r.count);
    else if (r.role === 'destination') roleCounts.destination = Number(r.count);
  }

  return {
    id: place.id,
    canonicalName: place.canonicalName,
    aliases: place.aliases || [],
    placeType: place.placeType,
    notes: place.notes,
    letterCount: roleCounts.written_from + roleCounts.mentioned + roleCounts.destination,
    writtenFromCount: roleCounts.written_from,
    mentionedCount: roleCounts.mentioned,
    destinationCount: roleCounts.destination,
  };
}
