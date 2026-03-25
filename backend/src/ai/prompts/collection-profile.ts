export const COLLECTION_PROFILE_SYSTEM_PROMPT = `You are an expert archivist and storyteller creating a public-facing collection profile for a digitized collection of historical letters. Your goal is to make readers curious and eager to explore the collection.

<task>
Given the letters, people, and relationships in this collection, produce:
1. A narrative essay (~400-600 words) introducing the collection as a compelling story
2. A "start here" recommendation — the single best letter for a newcomer to read first
3. Reading paths — 3-5 thematic or chronological arcs through the collection
4. Gap analysis — significant gaps in the correspondence timeline worth noting
5. Thematic groupings — cross-cutting themes that appear across multiple letters
</task>

<guidelines>
- Base ALL content strictly on the provided letter data. Never fabricate names, events, dates, or details not in the source material.
- Write the narrative as an engaging curator, not a dry archivist. Use vivid language but stay factual.
- The narrative should: introduce the main correspondents, hint at the emotional arc, set historical context from the letters themselves, and make a reader want to explore further.
- For the "start here" letter, pick one that is both accessible and representative — ideally a letter that draws the reader in and introduces key characters.
- Reading paths should have evocative titles (e.g., "The War Years" not "Letters 1863-1865"). Each path should tell a sub-story.
- Gap analysis: only note gaps of 30+ days where the silence itself seems significant. Don't list every gap.
- Themes should be substantive (not generic like "daily life") and tie to specific letters.
- Reference letters by their IDs (provided in the data) so they can be linked.
</guidelines>

<output_format>
Return JSON with this exact structure:
{
  "narrative": "string (400-600 words, plain text with paragraph breaks as \\n\\n)",
  "startHereLetterId": "uuid of the recommended first letter",
  "startHereReason": "string (1-2 sentences explaining why this letter is the best starting point)",
  "readingPaths": [
    {
      "title": "string (evocative arc title)",
      "description": "string (2-3 sentences describing this narrative arc)",
      "letterIds": ["uuid", "uuid", "...in reading order"]
    }
  ],
  "gapAnalysis": [
    {
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "description": "string (1-2 sentences on why this gap is notable)"
    }
  ],
  "themes": [
    {
      "name": "string (theme name)",
      "description": "string (2-3 sentences)",
      "letterIds": ["uuid", "uuid", "..."]
    }
  ]
}
</output_format>`;

export interface CollectionProfileLetterInput {
  id: string;
  date: string;
  sender: string | null;
  recipient: string | null;
  summary: string | null;
  hook: string | null;
  emotionalTone: string | null;
  primaryTopics: string[] | null;
  locationWritten: string | null;
}

export interface CollectionProfilePersonInput {
  name: string;
  biography: string | null;
  letterCount: number;
  senderCount: number;
  recipientCount: number;
}

export interface CollectionProfileRelationshipInput {
  personA: string;
  personB: string;
  type: string;
}

export function buildCollectionProfilePrompt(
  collection: { title: string | null; description: string | null },
  letters: CollectionProfileLetterInput[],
  people: CollectionProfilePersonInput[],
  relationships: CollectionProfileRelationshipInput[],
): string {
  const parts: string[] = [];

  // Collection context
  parts.push('<collection>');
  if (collection.title) parts.push(`Title: ${collection.title}`);
  if (collection.description) parts.push(`Description: ${collection.description}`);
  parts.push(`Total letters: ${letters.length}`);

  // Date range
  const dates = letters.map(l => l.date).filter(Boolean).sort();
  if (dates.length > 0) {
    parts.push(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  }
  parts.push('</collection>');

  // People
  if (people.length > 0) {
    parts.push('\n<key_people>');
    for (const person of people.slice(0, 20)) {
      let line = `- ${person.name} (${person.letterCount} letters`;
      if (person.senderCount > 0) line += `, ${person.senderCount} as sender`;
      if (person.recipientCount > 0) line += `, ${person.recipientCount} as recipient`;
      line += ')';
      if (person.biography) {
        // Truncate bio to keep prompt manageable
        const bio = person.biography.length > 200 ? person.biography.substring(0, 200) + '...' : person.biography;
        line += `\n  Bio: ${bio}`;
      }
      parts.push(line);
    }
    parts.push('</key_people>');
  }

  // Relationships
  if (relationships.length > 0) {
    parts.push('\n<relationships>');
    for (const rel of relationships.slice(0, 30)) {
      parts.push(`- ${rel.personA} <-> ${rel.personB}: ${rel.type}`);
    }
    parts.push('</relationships>');
  }

  // Letters (core data)
  parts.push('\n<letters>');
  for (const letter of letters) {
    let entry = `\n--- Letter ${letter.id} (${letter.date}) ---`;
    if (letter.sender) entry += `\nFrom: ${letter.sender}`;
    if (letter.recipient) entry += `\nTo: ${letter.recipient}`;
    if (letter.locationWritten) entry += `\nLocation: ${letter.locationWritten}`;
    if (letter.emotionalTone) entry += `\nTone: ${letter.emotionalTone}`;
    if (letter.primaryTopics?.length) entry += `\nTopics: ${letter.primaryTopics.join(', ')}`;
    if (letter.hook) entry += `\nHook: ${letter.hook}`;
    if (letter.summary) {
      // Truncate very long summaries
      const summary = letter.summary.length > 300 ? letter.summary.substring(0, 300) + '...' : letter.summary;
      entry += `\nSummary: ${summary}`;
    }
    parts.push(entry);
  }
  parts.push('</letters>');

  parts.push('\nGenerate a complete collection profile based on the above data. Return JSON only.');

  return parts.join('\n');
}
