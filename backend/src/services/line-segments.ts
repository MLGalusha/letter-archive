import { eq } from 'drizzle-orm';
import { db, letterPages } from '../db/index.js';
import type { LineSegment } from './kraken.js';

/**
 * Stores line segments for a letter page.
 */
export async function storeLineSegments(pageId: string, segments: LineSegment[]): Promise<void> {
  await db.update(letterPages).set({
    lineSegments: segments,
    updatedAt: new Date(),
  }).where(eq(letterPages.id, pageId));
}

/**
 * Retrieves line segments for a letter page.
 */
export async function getLineSegments(pageId: string): Promise<LineSegment[] | null> {
  const page = await db.query.letterPages.findFirst({
    where: eq(letterPages.id, pageId),
    columns: { lineSegments: true },
  });

  return (page?.lineSegments as LineSegment[] | null) ?? null;
}
