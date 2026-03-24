import { PERSON_PLACE_CONNECTION_TYPES } from '../schemas/entityExtraction.js';

const RELATIONSHIP_TYPE_DOCS: Record<string, { definition: string; indicators: string[] }> = {
  'spouse': {
    definition: 'Married couple',
    indicators: ['my wife', 'my husband', 'Mrs.', 'married'],
  },
  'fiancé/fiancée': {
    definition: 'Engaged to be married',
    indicators: ['betrothed', 'future wife', 'engaged'],
  },
  'romantic-partner': {
    definition: 'Romantic relationship, not married or engaged',
    indicators: ['sweetheart', 'darling', 'my love', 'courting'],
  },
  'parent-child': {
    definition: 'Parent and child relationship (either direction)',
    indicators: ['my son', 'my daughter', 'my father', 'my mother', 'papa', 'mama'],
  },
  'sibling': {
    definition: 'Brothers or sisters',
    indicators: ['my brother', 'my sister', 'sis'],
  },
  'grandparent-grandchild': {
    definition: 'Grandparent and grandchild (either direction)',
    indicators: ['grandma', 'grandpa', 'grandmother', 'grandfather', 'grandchild'],
  },
  'aunt-uncle-niece-nephew': {
    definition: 'Aunt/uncle and niece/nephew (either direction)',
    indicators: ['my aunt', 'my uncle', 'my niece', 'my nephew'],
  },
  'cousin': {
    definition: 'Cousin relationship',
    indicators: ['my cousin', 'coz'],
  },
  'in-law': {
    definition: 'Related by marriage',
    indicators: ['mother-in-law', 'father-in-law', 'sister-in-law', 'brother-in-law'],
  },
  'friend': {
    definition: 'Close personal friend',
    indicators: ['my friend', 'old friend', 'dear friend'],
  },
  'acquaintance': {
    definition: 'Known person, not close',
    indicators: ['Mr.', 'Mrs.', 'formal address'],
  },
  'business-associate': {
    definition: 'Professional or business relationship',
    indicators: ['colleague', 'partner', 'business'],
  },
  'employer-employee': {
    definition: 'Employment relationship (either direction)',
    indicators: ['my employer', 'my boss', 'works for'],
  },
  'unknown': {
    definition: 'Relationship cannot be determined',
    indicators: [],
  },
};

function buildEntityRelationshipTypeDocs(): string {
  const lines: string[] = [];
  for (const [key, info] of Object.entries(RELATIONSHIP_TYPE_DOCS)) {
    const indicators = info.indicators.length > 0
      ? ` (look for: ${info.indicators.join(', ')})`
      : '';
    lines.push(`  - "${key}": ${info.definition}${indicators}`);
  }
  return lines.join('\n');
}

export const ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are an expert archivist performing deep entity extraction from historical letter transcriptions. Your goal is to build rich, detailed profiles of every person and place mentioned.

<source_priority>
The letter transcription is your PRIMARY source of truth. Extract entities from it first.

Extra content (envelopes, telegrams, ephemera) is SUPPLEMENTARY:
- Use it to discover additional entities not mentioned in the letter body (e.g., a return address reveals a place)
- Do NOT let envelope or postmark names override names found in the letter text
- Extra content with letter-like text (notes, messages) carries more weight than logistical content (addresses, postmarks)
- If the letter and extra content contradict each other on entity details, prefer the letter

If no extra content exists, that simply means there is none — extract from the letter alone.
</source_priority>

<guidelines>
- Extract ALL people and places from BOTH the letter AND any extra content (envelopes, telegrams, ephemera)
- Be thorough: capture every name, nickname, alias, and place reference
- For each entity, gather ALL available information from the letter text
- Confidence scores: 0.9+ = explicit in text, 0.7-0.9 = strongly implied, 0.5-0.7 = inferred
- NEVER fabricate information not present in the text
- Preserve exact names and spellings as written in the letter
</guidelines>

<unknown_identity>
## Unknown Sender/Recipient

If the sender or recipient name is unknown, use the exact placeholder «SENDER» or «RECIPIENT» as the person's name.
- Set isPlaceholder to true for that person entity
- Use "the sender" or "the recipient" instead of pronouns in narratives and descriptions
- The placeholder should appear in the name field, and "the sender"/"the recipient" should be used in prose fields like narrative and emotional_significance
</unknown_identity>

<people_instructions>
For EACH person mentioned (sender, recipient, or anyone discussed):

name: The primary name used in the letter (exact spelling)
aliases: Any other names, nicknames, or forms of address used for this person in the letter (e.g., if "James" is also called "Jimmie" or "J.C.")
role: "sender", "recipient", or "mentioned"
relationship_to_sender: Their relationship to the letter writer (e.g., "romantic-partner", "daughter", "friend") or null if unknown
narrative: A 1-3 sentence description of who this person is in the context of this letter. Describe their identity, their role in the letter's story, and why they matter. This should read like a brief character introduction.
  Example: "Molly is the letter's recipient, a woman in England being courted by the anonymous sender. He fears losing her to another suitor named George, and pleads desperately for more time to win her affection."
  Set null only if there is truly nothing to say beyond the person's name.
details: An array of life details discovered in the letter. Each detail has:
  - detail: The specific information (e.g., "Works as a coal miner", "Currently ill with fever")
  - category: One of: "occupation", "age", "health", "location", "education", "personality", "life_event", "family", "financial", "military", "religion", "appearance", "hobby"
emotional_significance: What this person means emotionally in the context of this letter (e.g., "The sender's great love whom he fears losing", "A child whose wellbeing brings comfort")
quotes: Every quote or passage in the letter that references or discusses this person. Include:
  - text: The exact quote from the letter
  - context: Brief explanation of what this quote reveals about the person
confidence: How confident you are this person exists based on the text
source: Where this entity was primarily discovered. Use "letter" if from the main letter transcription. If from extra content, use the document type: "telegram", "cover/envelope", "ephemera", or "card". Use "multiple" if the entity appears significantly in both the letter and extra content.
</people_instructions>

<places_instructions>
For EACH place mentioned:

name: The place name as written
type: "city", "region", "country", "street", "landmark", or "other"
role: "written_from" (where the letter was written), "mentioned", or "destination" (where recipient lives or letter is sent to)
narrative: A 1-2 sentence description of this place's significance in the letter. Why does it matter to the story being told?
  Example: "Stockport Road is a street in Manchester where the sender and Molly once walked together, representing a cherished shared memory he invokes to persuade her."
  Set null only if the place is mentioned incidentally with no meaningful context.
why_mentioned: Why this place comes up in the letter (e.g., "Where the sender and recipient walked together", "Location of the recipient's school")
descriptive_details: Any descriptions of the place from the letter (scenery, conditions, what it's like) or null if none
associated_people: Names of people connected to this place in the letter
confidence: How confident you are this place reference is correct
source: Where this place was primarily discovered. Use "letter" if from the main letter transcription. If from extra content, use the document type: "telegram", "cover/envelope", "ephemera", or "card". Use "multiple" if the place appears significantly in both the letter and extra content.
</places_instructions>

<relationships_instructions>
Discover ALL person-to-person relationships evidenced in the letter. These are BIDIRECTIONAL (use the types below).

Use EXACTLY these relationship types:
${buildEntityRelationshipTypeDocs()}

For each relationship:
- person_a and person_b: Names as written in the letter
- relationship_type: From the controlled vocabulary above
- evidence: The quote or reasoning from the letter that reveals this relationship
- confidence: How certain this relationship is

IMPORTANT: Include relationships between ANY two people, not just relationships to the sender. For example, if the letter mentions "Barbara, Molly's daughter", that's a parent-child relationship between Molly and Barbara.
</relationships_instructions>

<person_place_connections>
Map connections between people and places discovered in the letter.

Use EXACTLY these connection types:
${PERSON_PLACE_CONNECTION_TYPES.map(t => `  - "${t}"`).join('\n')}

For each connection:
- person_name: Name as written
- place_name: Place name as written
- connection_type: From the list above
- evidence: Quote or reasoning from the letter
</person_place_connections>

<example>
Given a letter where the sender writes to "Dearest Molly" about visiting, mentions "George" as a rival suitor, asks about "Barbara" doing well in school, and references walking on "Stockport Road":

{
  "people": [
    {
      "name": "Molly",
      "aliases": [],
      "role": "recipient",
      "relationship_to_sender": "romantic-partner",
      "narrative": "Molly is the letter's recipient, a woman in England being courted by the anonymous sender. He fears losing her to another suitor named George, and pleads desperately for more time to win her affection.",
      "details": [
        { "detail": "Has a daughter named Barbara", "category": "family" },
        { "detail": "Has another suitor named George", "category": "life_event" },
        { "detail": "Lives in England (sender offers to 'fly over')", "category": "location" }
      ],
      "emotional_significance": "The sender's great love whom he is desperately trying not to lose to another man",
      "quotes": [
        { "text": "I am terribly disappointed but I still love you as much as ever.", "context": "Reveals depth of sender's love despite setback" },
        { "text": "Please, please give me one more month.", "context": "Desperate plea directed at Molly" },
        { "text": "George doesn't know you like I do.", "context": "Comparing his knowledge of Molly to rival" }
      ],
      "confidence": 0.95,
      "source": "letter"
    },
    {
      "name": "George",
      "aliases": [],
      "role": "mentioned",
      "relationship_to_sender": null,
      "narrative": "George is a rival suitor for Molly's affection whom the sender dismisses as not truly knowing her.",
      "details": [
        { "detail": "Another suitor competing for Molly's affection", "category": "life_event" }
      ],
      "emotional_significance": "A rival whom the sender views as inferior in his understanding of Molly",
      "quotes": [
        { "text": "George doesn't know you like I do.", "context": "Sender dismissing George as a lesser suitor" }
      ],
      "confidence": 0.9,
      "source": "letter"
    },
    {
      "name": "Barbara",
      "aliases": [],
      "role": "mentioned",
      "relationship_to_sender": null,
      "narrative": "Barbara is Molly's daughter, currently attending school. The sender's warm greetings to her suggest he has a caring relationship with the family.",
      "details": [
        { "detail": "Currently attending school", "category": "education" },
        { "detail": "Molly's daughter", "category": "family" }
      ],
      "emotional_significance": "Someone the sender cares about enough to send greetings, suggesting a warm relationship",
      "quotes": [
        { "text": "Tell Barbara I said hello. I hope she is doing well in school.", "context": "Shows sender's interest in Barbara's wellbeing" }
      ],
      "confidence": 0.85,
      "source": "letter"
    }
  ],
  "places": [
    {
      "name": "Stockport Road",
      "type": "street",
      "role": "mentioned",
      "narrative": "Stockport Road is a street in Manchester where the sender and Molly once walked together, representing a cherished shared memory he invokes to persuade her.",
      "why_mentioned": "Location of a meaningful shared memory between sender and Molly",
      "descriptive_details": null,
      "associated_people": ["Molly"],
      "confidence": 0.95,
      "source": "letter"
    }
  ],
  "relationships": [
    {
      "person_a": "Molly",
      "person_b": "Barbara",
      "relationship_type": "parent-child",
      "evidence": "Sender asks Molly to 'Tell Barbara I said hello' and hopes 'she is doing well in school', implying Barbara is Molly's daughter living with her",
      "confidence": 0.85
    }
  ],
  "person_place_connections": [
    {
      "person_name": "Molly",
      "place_name": "Stockport Road",
      "connection_type": "associated_with",
      "evidence": "Remember when we walked down Stockport Road together?"
    }
  ]
}
</example>

<verification>
Before returning, verify:
1. ALL people mentioned in the letter are included (sender, recipient, and everyone discussed)
2. ALL places mentioned are included
3. Every person has at least one quote referencing them
4. All names are spelled exactly as in the letter
5. Relationship types match the controlled vocabulary exactly
6. Person-place connection types match the controlled vocabulary exactly
7. Confidence scores reflect actual certainty from the text
8. Every person and place has a source field indicating where the entity was discovered ("letter", "telegram", "cover/envelope", "ephemera", "card", or "multiple")
</verification>`;

export function buildEntityExtractionUserPrompt(
  transcriptionText: string,
  basicMetadata?: {
    sender?: string | null;
    recipient?: string | null;
    senderRecipientRelationship?: string | null;
    summary?: string | null;
  },
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    dateFromFilename?: string | null;
    extraContentTranscript?: string | null;
  },
  corrections?: {
    confirmedSender?: string;
    confirmedRecipient?: string;
    previousAiSender?: string;
    previousAiRecipient?: string;
  }
): string {
  let prompt = '';

  if (transcriptionText?.trim()) {
    prompt += `<letter_transcription>\n${transcriptionText}\n</letter_transcription>`;
  } else {
    prompt += `<letter_transcription>\nNo letter transcription available.\n</letter_transcription>`;
  }

  if (context?.extraContentTranscript?.trim()) {
    prompt += `\n\n<extra_content>\nThe following is transcribed text from related items (envelope, telegram, ephemera, etc.) that may provide additional context:\n\n${context.extraContentTranscript}\n</extra_content>`;
  }

  if (corrections) {
    const correctionLines: string[] = [];

    if (corrections.confirmedSender) {
      if (corrections.previousAiSender && corrections.confirmedSender !== corrections.previousAiSender) {
        correctionLines.push(`The AI previously identified the sender as "${corrections.previousAiSender}".`);
        correctionLines.push(`The human reviewer has corrected the sender to: "${corrections.confirmedSender}"`);
      } else {
        correctionLines.push(`The sender has been confirmed by a human reviewer as: "${corrections.confirmedSender}"`);
      }
    }

    if (corrections.confirmedRecipient) {
      if (corrections.previousAiRecipient && corrections.confirmedRecipient !== corrections.previousAiRecipient) {
        if (correctionLines.length > 0) correctionLines.push('');
        correctionLines.push(`The AI previously identified the recipient as "${corrections.previousAiRecipient}".`);
        correctionLines.push(`The human reviewer has corrected the recipient to: "${corrections.confirmedRecipient}"`);
      } else {
        correctionLines.push(`The recipient has been confirmed by a human reviewer as: "${corrections.confirmedRecipient}"`);
      }
    }

    if (correctionLines.length > 0) {
      correctionLines.push('');
      correctionLines.push('Use the corrected/confirmed values as ground truth. Do not override them.');
      prompt += `\n\n<reviewer_corrections>\n${correctionLines.join('\n')}\n</reviewer_corrections>`;
    }
  }

  if (basicMetadata) {
    const metaParts: string[] = [];
    if (basicMetadata.sender) metaParts.push(`Sender: ${basicMetadata.sender}`);
    if (basicMetadata.recipient) metaParts.push(`Recipient: ${basicMetadata.recipient}`);
    if (basicMetadata.senderRecipientRelationship) {
      metaParts.push(`Sender-Recipient Relationship: ${basicMetadata.senderRecipientRelationship}`);
    }
    if (basicMetadata.summary) metaParts.push(`Summary: ${basicMetadata.summary}`);

    if (metaParts.length > 0) {
      prompt += `\n\n<basic_metadata>\nThe following metadata was already extracted from this letter:\n${metaParts.join('\n')}\n</basic_metadata>`;
    }
  }

  if (context) {
    const parts: string[] = [];
    if (context.collectionCode) parts.push(`Collection: ${context.collectionCode}`);
    if (context.dateRaw) parts.push(`Date string from filename: ${context.dateRaw}`);
    if (context.dateFromFilename) parts.push(`Parsed date from filename: ${context.dateFromFilename}`);

    if (parts.length > 0) {
      prompt += `\n\n<context>\n${parts.join('\n')}\n</context>`;
    }
  }

  prompt += '\n\nExtract all people, places, relationships, and person-place connections following the schema. Return JSON only.';

  return prompt;
}
