/**
 * Detect letters that may have undetected special areas.
 *
 * Queries for letters with structured transcript data containing
 * margin-note or postscript role lines but no specialAreas defined.
 * These are candidates for re-transcription to detect special areas.
 *
 * Usage: npx tsx scripts/detect-special-area-candidates.ts
 */

import 'dotenv/config';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { db, letters } from '../src/db/index.js';
import type { StructuredTranscript } from '../src/ai/schemas/structuredTranscript.js';

async function main() {
  console.log('Scanning letters for special area candidates...\n');

  const candidates = await db.query.letters.findMany({
    where: and(
      eq(letters.type, 'L'),
      isNotNull(letters.transcriptionJson),
      isNull(letters.deletedAt),
    ),
    columns: {
      id: true,
      filenameBase: true,
      transcriptionJson: true,
    },
  });

  console.log(`Found ${candidates.length} letters with structured transcripts.\n`);

  const results: { id: string; filename: string; reason: string; lineCount: number }[] = [];

  for (const letter of candidates) {
    const transcript = letter.transcriptionJson as StructuredTranscript | null;
    if (!transcript?.pages) continue;

    // Check if any page already has specialAreas
    const hasAreas = transcript.pages.some(p => p.specialAreas && p.specialAreas.length > 0);
    if (hasAreas) continue;

    // Check for margin-note or postscript role lines
    let marginNoteCount = 0;
    let postscriptCount = 0;

    for (const page of transcript.pages) {
      for (const line of page.lines) {
        if (line.text === '') continue;
        if (line.role === 'margin-note') marginNoteCount++;
        if (line.role === 'postscript') postscriptCount++;
      }
    }

    if (marginNoteCount > 0) {
      results.push({
        id: letter.id,
        filename: letter.filenameBase ?? '(unknown)',
        reason: `${marginNoteCount} margin-note line(s)`,
        lineCount: marginNoteCount,
      });
    } else if (postscriptCount > 0) {
      results.push({
        id: letter.id,
        filename: letter.filenameBase ?? '(unknown)',
        reason: `${postscriptCount} postscript line(s)`,
        lineCount: postscriptCount,
      });
    }
  }

  // Sort by line count descending (most likely candidates first)
  results.sort((a, b) => b.lineCount - a.lineCount);

  if (results.length === 0) {
    console.log('No candidates found. All letters either have special areas or no margin-note/postscript lines.');
  } else {
    console.log(`Found ${results.length} candidate(s) for special area detection:\n`);
    for (const r of results) {
      console.log(`  ${r.filename}  (${r.id.slice(0, 8)}...)  — ${r.reason}`);
    }
    console.log(`\nRe-transcribe these letters to detect special areas.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
