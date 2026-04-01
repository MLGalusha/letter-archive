/**
 * One-time backfill: populate width/height on letter_pages rows that are missing them.
 *
 * Uses sharp().metadata() — reads only image headers, very fast.
 *
 * Run locally:  npx tsx src/cli/backfill-dimensions.ts
 * Run in prod:  deployed as Cloud Run Job (see deploy/cloudrun/backend-backfill-dimensions-job.yaml)
 */

import 'dotenv/config';
import { eq, isNull, or } from 'drizzle-orm';
import sharp from 'sharp';
import { db, letterPages } from '../db/index.js';
import { getAbsoluteStoragePath } from '../services/storage.js';

async function backfillDimensions() {
  console.log('Starting image dimensions backfill...\n');

  const pages = await db.query.letterPages.findMany({
    where: or(isNull(letterPages.width), isNull(letterPages.height)),
  });

  console.log(`Found ${pages.length} pages missing dimensions\n`);

  let updated = 0;
  let errors = 0;

  for (const page of pages) {
    try {
      const absolutePath = getAbsoluteStoragePath(page.storagePath);
      const metadata = await sharp(absolutePath).metadata();

      if (metadata.width && metadata.height) {
        await db
          .update(letterPages)
          .set({ width: metadata.width, height: metadata.height })
          .where(eq(letterPages.id, page.id));
        updated++;
        if (updated % 50 === 0) {
          console.log(`  Progress: ${updated}/${pages.length} updated`);
        }
      } else {
        console.warn(`  Page ${page.id.slice(0, 8)}...: No dimensions in metadata`);
        errors++;
      }
    } catch (err) {
      console.error(`  Page ${page.id.slice(0, 8)}... (${page.originalFilename}): ${err}`);
      errors++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);
  process.exit(0);
}

backfillDimensions();
