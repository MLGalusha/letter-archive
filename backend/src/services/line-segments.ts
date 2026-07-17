import { eq } from 'drizzle-orm';
import { db, letterPages } from '../db/index.js';

export interface LineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
  words?: { text: string; bbox: [number, number, number, number] }[];
  boundary?: { x: number; y: number }[];
}

/** Persists line segments produced by the standalone local detection workflow. */
export async function savePageLineSegments(
  pageId: string,
  segments: LineSegment[],
): Promise<void> {
  await db
    .update(letterPages)
    .set({
      lineSegments: segments,
      updatedAt: new Date(),
    })
    .where(eq(letterPages.id, pageId));
}
