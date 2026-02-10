/**
 * One-time script to bulk confirm all transcribed letters.
 * This allows the worker to process them with V2 metadata extraction.
 *
 * Usage: npx tsx scripts/bulk-confirm-transcripts.ts
 */

import 'dotenv/config';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { db, letters } from '../src/db/index.js';

async function main() {
  console.log('Finding transcribed letters without confirmation...');

  // Find all transcribed letters that haven't been confirmed
  const lettersToConfirm = await db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      isNotNull(letters.transcriptionText),
      isNull(letters.transcriptConfirmedAt),
      isNull(letters.deletedAt)
    ),
  });

  console.log(`Found ${lettersToConfirm.length} letters to confirm.`);

  if (lettersToConfirm.length === 0) {
    console.log('No letters need confirmation.');
    return;
  }

  // Confirm all of them
  const letterIds = lettersToConfirm.map((l) => l.id);

  for (const letter of lettersToConfirm) {
    await db.update(letters).set({
      transcriptConfirmedAt: new Date(),
      transcriptConfirmedBy: 'bulk-script',
      metadataStatus: 'PENDING', // Ensure worker picks it up
      updatedAt: new Date(),
    }).where(eq(letters.id, letter.id));

    console.log(`Confirmed: ${letter.id} (${letter.dateRaw})`);
  }

  console.log(`\nConfirmed ${letterIds.length} letters.`);
  console.log('The worker will now process them with V2 metadata extraction.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
