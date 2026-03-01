/**
 * Backfill script to run Kraken line segmentation on all pages missing lineSegments.
 *
 * Run with: npx tsx scripts/backfill-line-segments.ts
 */

import 'dotenv/config';
import { db, letterPages } from '../src/db/index.js';
import { isNull } from 'drizzle-orm';
import { runKrakenSegmentation } from '../src/services/kraken.js';
import { storeLineSegments } from '../src/services/line-segments.js';
import { getAbsoluteStoragePath } from '../src/services/storage.js';

async function backfillLineSegments() {
  console.log('Starting line segments backfill...\n');

  const pages = await db.query.letterPages.findMany({
    where: isNull(letterPages.lineSegments),
    orderBy: (p, { asc }) => [asc(p.createdAt)],
  });

  console.log(`Found ${pages.length} pages without line segments\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const absolutePath = getAbsoluteStoragePath(page.storagePath);

    try {
      const segments = await runKrakenSegmentation(absolutePath);
      if (segments) {
        await storeLineSegments(page.id, segments);
        success++;
        console.log(`[${i + 1}/${pages.length}] Page ${page.id}: ${segments.length} lines`);
      } else {
        failed++;
        console.log(`[${i + 1}/${pages.length}] Page ${page.id}: segmentation returned null`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${i + 1}/${pages.length}] Page ${page.id}: FAILED - ${msg}`);
    }
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Total:   ${pages.length}`);

  process.exit(0);
}

backfillLineSegments().catch((err) => {
  console.error('Backfill script failed:', err);
  process.exit(1);
});
