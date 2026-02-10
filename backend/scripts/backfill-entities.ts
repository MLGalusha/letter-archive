/**
 * Backfill script to extract entities from existing metadataV2Json
 *
 * Run with: npx tsx scripts/backfill-entities.ts
 */

import 'dotenv/config';
import { db, letters } from '../src/db/index.js';
import { isNotNull, and, isNull } from 'drizzle-orm';
import { processExtractedEntity, type ExtractedEntity } from '../src/services/entities.js';

interface MetadataV2 {
  entities: ExtractedEntity[];
}

async function backfillEntities() {
  console.log('Starting entity backfill...\n');

  // Fetch all letters with metadataV2Json
  const lettersWithMetadata = await db.query.letters.findMany({
    where: and(isNotNull(letters.metadataV2Json), isNull(letters.deletedAt)),
  });

  console.log(`Found ${lettersWithMetadata.length} letters with V2 metadata\n`);

  let totalEntities = 0;
  let processedEntities = 0;
  let errors = 0;

  for (const letter of lettersWithMetadata) {
    const metadata = letter.metadataV2Json as MetadataV2 | null;

    if (!metadata?.entities?.length) {
      console.log(`  Letter ${letter.id.slice(0, 8)}...: No entities found`);
      continue;
    }

    console.log(
      `  Letter ${letter.id.slice(0, 8)}... (${letter.dateRaw}): Processing ${metadata.entities.length} entities`
    );
    totalEntities += metadata.entities.length;

    for (const entity of metadata.entities) {
      try {
        await processExtractedEntity(entity, letter.id);
        processedEntities++;
        console.log(`    ✓ ${entity.type}: "${entity.name}" (${entity.role})`);
      } catch (error) {
        errors++;
        console.error(`    ✗ Error processing "${entity.name}":`, error);
      }
    }
  }

  console.log('\n--- Backfill Complete ---');
  console.log(`Letters processed: ${lettersWithMetadata.length}`);
  console.log(`Total entities found: ${totalEntities}`);
  console.log(`Successfully processed: ${processedEntities}`);
  console.log(`Errors: ${errors}`);
}

// Run the backfill
backfillEntities()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
