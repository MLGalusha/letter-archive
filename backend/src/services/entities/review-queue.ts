import { and, desc, eq, sql } from 'drizzle-orm';
import { db, entityReviewQueue, type EntityReviewItem } from '../../db/index.js';

export async function addToReviewQueue(data: {
  entityType: 'person' | 'place';
  extractedText: string;
  letterId: string;
  suggestedEntityId?: string;
  context?: string;
  confidence: number;
}): Promise<void> {
  await db.insert(entityReviewQueue).values({
    entityType: data.entityType,
    extractedText: data.extractedText,
    letterId: data.letterId,
    suggestedEntityId: data.suggestedEntityId,
    context: data.context,
    confidence: data.confidence,
    status: 'pending',
  });
}

export async function getPendingReviewItems(
  entityType?: 'person' | 'place',
): Promise<EntityReviewItem[]> {
  const conditions = [eq(entityReviewQueue.status, 'pending')];
  if (entityType) {
    conditions.push(eq(entityReviewQueue.entityType, entityType));
  }

  return db.query.entityReviewQueue.findMany({
    where: and(...conditions),
    orderBy: [desc(entityReviewQueue.confidence)],
  });
}

export async function resolveReviewItem(
  id: string,
  resolution: {
    status: 'confirmed' | 'rejected' | 'new_entity';
    reviewedBy: string;
  },
): Promise<void> {
  await db
    .update(entityReviewQueue)
    .set({
      status: resolution.status,
      reviewedBy: resolution.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(eq(entityReviewQueue.id, id));
}

export async function getReviewQueueStats(): Promise<{
  pending: { persons: number; places: number };
  resolved: { confirmed: number; rejected: number; newEntity: number };
}> {
  const results = await db
    .select({
      entityType: entityReviewQueue.entityType,
      status: entityReviewQueue.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(entityReviewQueue)
    .groupBy(entityReviewQueue.entityType, entityReviewQueue.status);

  const stats = {
    pending: { persons: 0, places: 0 },
    resolved: { confirmed: 0, rejected: 0, newEntity: 0 },
  };

  for (const r of results) {
    if (r.status === 'pending') {
      if (r.entityType === 'person') stats.pending.persons = Number(r.count);
      else stats.pending.places = Number(r.count);
    } else if (r.status === 'confirmed') {
      stats.resolved.confirmed += Number(r.count);
    } else if (r.status === 'rejected') {
      stats.resolved.rejected += Number(r.count);
    } else if (r.status === 'new_entity') {
      stats.resolved.newEntity += Number(r.count);
    }
  }

  return stats;
}
