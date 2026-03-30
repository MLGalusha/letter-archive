export const COLLECTION_PROFILE_SYSTEM_PROMPT = `You are an expert archivist and storyteller creating a public-facing collection profile for a digitized collection of historical letters. Your goal is to make readers curious and eager to explore the collection.

<task>
Given the letters and their extracted entity data, produce:
1. A hook — 1 sentence teaser (max 130 characters) that makes someone want to explore this collection (think museum exhibit subtitle)
2. A narrative essay (~400-600 words) introducing the collection as a compelling story
3. Correspondent profiles — for each sender and recipient, generate a hook (one-sentence teaser) and a short biography based on what the letters reveal about them
</task>

<guidelines>
- Base ALL content strictly on the provided letter data. Never fabricate names, events, dates, or details not in the source material.
- Write the narrative as an engaging curator, not a dry archivist. Use vivid language but stay factual.
- The narrative should: introduce the main correspondents, hint at the emotional arc, set historical context from the letters themselves, and make a reader want to explore further.
- Correspondent profiles: Only generate for real named people who appear as senders or recipients. Skip generic placeholders like "sender", "recipient", "unknown", "the writer", "the author". The hook should be a compelling one-sentence intro (max ~150 characters). The biography should be 2-5 sentences about the person's role and story as revealed in the letters.
</guidelines>

<output_format>
Return JSON with this exact structure:
{
  "hook": "string (1 sentence, max 130 characters — intriguing, concise, makes the reader want to explore)",
  "narrative": "string (400-600 words, plain text with paragraph breaks as \\n\\n)",
  "correspondents": [
    {
      "name": "string (exact sender or recipient name as it appears in the letter data)",
      "hook": "string (1 sentence, max ~150 characters — captures who they are in this collection)",
      "biography": "string (2-5 sentences about this person based on what the letters reveal)"
    }
  ]
}
</output_format>`;

export interface LetterPersonEntity {
  name: string;
  role: 'sender' | 'recipient';
  narrative: string | null;
  emotionalSignificance: string | null;
  details: Array<{ detail: string; category: string }>;
  quotes: Array<{ text: string; context: string }>;
  relationship: string | null;
}

export interface CollectionProfileLetterInput {
  id: string;
  date: string;
  sender: string | null;
  recipient: string | null;
  summary: string | null;
  hook: string | null;
  senderEntity: LetterPersonEntity | null;
  recipientEntity: LetterPersonEntity | null;
}

export function buildCollectionProfilePrompt(
  collection: { title: string | null; description: string | null },
  letters: CollectionProfileLetterInput[],
): string {
  const parts: string[] = [];

  // Collection context
  parts.push('<collection>');
  if (collection.title) parts.push(`Title: ${collection.title}`);
  if (collection.description) parts.push(`Description: ${collection.description}`);
  parts.push(`Total letters: ${letters.length}`);

  const dates = letters.map(l => l.date).filter(Boolean).sort();
  if (dates.length > 0) {
    parts.push(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  }
  parts.push('</collection>');

  // Letters with per-letter entity data for sender and recipient
  parts.push('\n<letters>');
  for (const letter of letters) {
    parts.push(`\n<letter id="${letter.id}" date="${letter.date}">`);
    if (letter.sender) parts.push(`  From: ${letter.sender}`);
    if (letter.recipient) parts.push(`  To: ${letter.recipient}`);
    if (letter.hook) parts.push(`  Hook: ${letter.hook}`);
    if (letter.summary) parts.push(`  Summary: ${letter.summary}`);

    if (letter.senderEntity) {
      parts.push(formatPersonEntity(letter.senderEntity));
    }

    if (letter.recipientEntity) {
      parts.push(formatPersonEntity(letter.recipientEntity));
    }

    parts.push('</letter>');
  }
  parts.push('</letters>');

  parts.push('\nGenerate a collection profile based on the above data. Return JSON only.');

  return parts.join('\n');
}

function formatPersonEntity(entity: LetterPersonEntity): string {
  const lines: string[] = [];
  lines.push(`  <${entity.role} name="${entity.name}">`);
  if (entity.narrative) lines.push(`    Description: ${entity.narrative}`);
  if (entity.emotionalSignificance) lines.push(`    Significance: ${entity.emotionalSignificance}`);
  if (entity.relationship) lines.push(`    Relationship: ${entity.relationship}`);
  if (entity.details.length > 0) {
    for (const d of entity.details) {
      lines.push(`    - [${d.category}] ${d.detail}`);
    }
  }
  if (entity.quotes.length > 0) {
    for (const q of entity.quotes.slice(0, 3)) {
      lines.push(`    > "${q.text}"`);
    }
  }
  lines.push(`  </${entity.role}>`);
  return lines.join('\n');
}
