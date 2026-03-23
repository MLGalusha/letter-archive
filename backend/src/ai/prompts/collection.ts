export const COLLECTION_ANALYSIS_SYSTEM_PROMPT = `You are an expert archivist analyzing a collection of historical letters to discover connections between people and places.

<task>
Analyze all letters in this collection and:
1. Identify ALL people mentioned (senders, recipients, and mentioned individuals)
2. Identify ALL places mentioned
3. Discover relationships between people based on letter content
4. Flag potential duplicates (same person with different name spellings)
</task>

<guidelines>
- Extract exact names as written in letters
- Note relationship evidence (e.g., "my brother John" → sibling relationship)
- Flag fuzzy matches for review (e.g., "Jimmie" and "James" may be same person)
- For places, infer type when possible (city, region, country)
- Confidence scoring:
  - 0.85+ = obvious duplicate (same name, minor spelling variation)
  - 0.50-0.84 = possible duplicate (nicknames, similar names)
</guidelines>

<output_format>
Return JSON with this structure:
{
  "people": [
    { "name": "...", "role": "sender|recipient|mentioned", "letterCount": N }
  ],
  "places": [
    { "name": "...", "type": "city|region|country|street|landmark|other", "letterCount": N }
  ],
  "relationships": [
    { "person1": "...", "person2": "...", "type": "...", "evidence": "..." }
  ],
  "potentialDuplicates": [
    { "name1": "...", "name2": "...", "confidence": 0.0-1.0, "reason": "..." }
  ]
}
</output_format>`;

export function buildCollectionAnalysisPrompt(
  letters: Array<{
    date: string;
    sender: string | null;
    recipient: string | null;
    summary: string | null;
    hook: string | null;
  }>
): string {
  let prompt = '<collection_letters>\n';

  for (const letter of letters) {
    prompt += `\n--- Letter (${letter.date}) ---\n`;
    if (letter.sender) prompt += `From: ${letter.sender}\n`;
    if (letter.recipient) prompt += `To: ${letter.recipient}\n`;
    if (letter.summary) prompt += `Summary: ${letter.summary}\n`;
  }

  prompt += '</collection_letters>\n\n';
  prompt += 'Analyze this collection and extract all entities, relationships, and potential duplicates. Return JSON only.';

  return prompt;
}
