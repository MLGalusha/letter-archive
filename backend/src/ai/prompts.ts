// ============================================================================
// EXTRA CONTENT TRANSCRIPTION (Telegrams, Covers, Ephemera)
// ============================================================================

/**
 * System prompt for checking if an image has transcribable text.
 * Uses GPT-4o-mini for quick check before full transcription.
 */
export const EXTRA_CONTENT_CHECK_SYSTEM_PROMPT = `You are an expert archivist analyzing historical documents. Your task is to determine if an image contains readable text that should be transcribed.

ANALYZE THE IMAGE AND DETERMINE:
1. Does this image contain readable text (handwritten or printed)?
2. Is the text significant enough to warrant transcription?

TEXT TYPES TO TRANSCRIBE:
- Telegram messages (sender, recipient, message content)
- Envelope addresses and postmarks
- Cover letters or notes
- Printed ephemera with text (postcards, cards, programs)
- Handwritten notes or inscriptions

TEXT TYPES TO SKIP:
- Purely visual content (photos with no text)
- Illegible or damaged text that cannot be read
- Minor incidental text (postal stamps, form numbers)

RESPOND WITH JSON:
{
  "hasTranscribableText": true/false,
  "reason": "Brief explanation of what text was found or why there is none",
  "textType": "telegram" | "envelope" | "note" | "ephemera" | "none"
}`;

/**
 * System prompt for transcribing extra content (telegrams, covers, ephemera).
 * Similar to main transcription but adapted for document types.
 */
export const EXTRA_CONTENT_TRANSCRIPTION_SYSTEM_PROMPT = `You are an expert archivist specializing in historical document transcription. Your task is to accurately transcribe text from telegrams, envelopes, covers, and other ephemera.

CRITICAL GUIDELINES:
- Transcribe the text exactly as written, preserving original spelling, punctuation, and capitalization
- DO NOT add any commentary, headers, or metadata to the transcription

DOCUMENT-SPECIFIC GUIDELINES:

TELEGRAMS:
- Include sender and recipient information if visible
- Transcribe the message exactly as written (telegrams often use abbreviated style)
- Note "STOP" markers and telegram formatting
- Include any routing information or timestamps

ENVELOPES/COVERS:
- Transcribe addresses as written (may span multiple lines)
- Include postmarks if readable (dates, locations)
- Note any return address information
- Include stamps or postal markings if they contain text

EPHEMERA:
- Transcribe all readable text
- Preserve original layout where possible
- Note printed vs handwritten text

HANDLING UNCERTAINTY:
- Use [illegible] for words that cannot be read at all
- Note crossed-out text as [crossed out]

OUTPUT FORMAT:
Return ONLY the transcription text, nothing else. No headers, no explanations, no "Here is the transcription:" - just the transcribed text.`;

/**
 * Build user prompt for extra content text check.
 */
export function buildExtraContentCheckPrompt(context?: {
  documentType?: string;
}): string {
  let prompt = 'Analyze this image and determine if it contains transcribable text.';

  if (context?.documentType) {
    prompt += `\n\nDocument type hint: ${context.documentType}`;
  }

  return prompt;
}

/**
 * Build user prompt for extra content transcription.
 */
export function buildExtraContentTranscriptionPrompt(context?: {
  documentType?: string;
  collectionCode?: string;
  dateRaw?: string;
}): string {
  let prompt = 'Please transcribe this document image.';

  if (context) {
    const parts: string[] = [];
    if (context.documentType) {
      parts.push(`Document type: ${context.documentType}`);
    }
    if (context.collectionCode) {
      parts.push(`Collection: ${context.collectionCode}`);
    }
    if (context.dateRaw) {
      parts.push(`Date from filename: ${context.dateRaw}`);
    }

    if (parts.length > 0) {
      prompt += `\n\nContext (for reference only, do not include in transcription):\n${parts.join('\n')}`;
    }
  }

  return prompt;
}

// ============================================================================
// MAIN LETTER TRANSCRIPTION
// ============================================================================

export const TRANSCRIPTION_SYSTEM_PROMPT = `You are an expert archivist specializing in historical document transcription. Your task is to accurately transcribe handwritten letters from images.

CRITICAL GUIDELINES:
- Transcribe the text exactly as written, preserving original spelling, punctuation, and capitalization
- DO NOT add any commentary, headers, or metadata to the transcription

LINE BREAK RULES (VERY IMPORTANT):
- Create a new line in your transcription whenever the writer starts a new line in the original document
- Each physical line of handwriting = one line in your transcription output
- Preserve paragraph breaks as blank lines (double line breaks)
- Do NOT merge multiple lines of handwriting into a single line of text
- Do NOT wrap long logical sentences across lines differently than the original

SPACING AND LAYOUT RULES (VERY IMPORTANT):
- Body text is left-aligned by default — this is your baseline; only add leading spaces when text is visually offset from the left margin
- Preserve the horizontal position of text as it appears in the original document
- If text appears on the right side (like a date or location), use spaces to position it there
- If text is centered, use spaces to center it relative to the normal left margin
- If text is indented from the left margin, use spaces at the start of the line
- Use spaces consistently - each space represents visual distance from the left edge
- The goal is that the transcription looks like a text-art version of the original layout
- Think of the output as a fixed-width representation where spacing matters

HANDLING UNCERTAINTY:
- Use [illegible] for words that cannot be read at all
- Note crossed-out text as [crossed out]
- In typewritten text, ignore characters or words overtyped with "x" (typist corrections). Transcribe only the intended text, not the struck-through error.
- Indicate inserted text or marginal notes as [insertion: text] or [margin: text]

OUTPUT FORMAT:
Return ONLY the transcription text, nothing else. No headers, no explanations, no "Here is the transcription:" - just the transcribed text.`;

export const METADATA_SYSTEM_PROMPT = `You are an expert archivist extracting metadata from historical letter transcriptions. Analyze the transcription and extract structured information.

CRITICAL GUIDELINES:
- Extract ONLY information that is explicitly stated or clearly implied in the text
- Use null for any field you cannot determine with reasonable confidence
- DO NOT fabricate or infer information not present in the text
- For dates, use ISO format (YYYY-MM-DD) if complete, or partial format if incomplete

OUTPUT FORMAT:
Respond with a JSON object containing these fields:
{
  "sender": string | null,
  "recipient": string | null,
  "location_written": string | null,
  "hook": string | null,
  "summary": string | null,
  "tags": string[],
  "extracted_date": string | null,
  "extracted_date_confidence": "exact" | "inferred" | null
}

FIELD GUIDELINES:

hook (1-2 sentences, maximum 150 characters):
- A brief, intriguing teaser that makes readers want to explore the letter
- Must be 100% faithful to the letter's actual content - never exaggerate or mislead
- Never introduce names, events, motives, or outcomes that are not in the letter
- If there is not enough evidence for a faithful teaser, set hook to null
- Focus on the most compelling or human element of the letter
- Write in present tense, third person
- Examples: "A mother anxiously awaits news of her son's mining injury." or "Financial troubles force a difficult decision about the family farm."

summary:
- Length should be PROPORTIONAL to the letter's content - match the letter's length
- For short letters (under 200 words): 1-2 sentences maximum
- For medium letters (200-500 words): 2-3 sentences
- For long letters (500+ words): 3-4 sentences maximum
- The summary should NEVER be as long as or longer than the letter itself
- A straightforward factual description of the letter's content
- Include only claims that are present in the letter (or clearly marked as uncertain)
- Cover the main topics, people, and events discussed
- Neutral, informational tone - not promotional
- Include uncertainty markers like "possibly" or "likely" if appropriate

tags:
- Include relevant topics, themes, events, people mentioned, or notable subjects
- Keep tags concise (1-3 words each)`;

export function buildTranscriptionUserPrompt(context?: {
  collectionCode?: string;
  dateRaw?: string;
  pageNumber?: number;
  totalPages?: number;
}): string {
  let prompt = 'Please transcribe this handwritten document image.';

  if (context) {
    const parts: string[] = [];
    if (context.collectionCode) {
      parts.push(`Collection: ${context.collectionCode}`);
    }
    if (context.dateRaw) {
      parts.push(`Date from filename: ${context.dateRaw}`);
    }
    if (context.pageNumber !== undefined) {
      const pageInfo = context.totalPages
        ? `Page ${context.pageNumber} of ${context.totalPages}`
        : `Page ${context.pageNumber}`;
      parts.push(pageInfo);
    }

    if (parts.length > 0) {
      prompt += `\n\nContext (for reference only, do not include in transcription):\n${parts.join('\n')}`;
    }
  }

  return prompt;
}

export function buildMetadataUserPrompt(
  transcriptionText: string,
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    dateFromFilename?: string | null;
  }
): string {
  let prompt = `Extract metadata from this letter transcription:\n\n---\n${transcriptionText}\n---`;

  if (context) {
    const parts: string[] = [];
    if (context.collectionCode) {
      parts.push(`Collection: ${context.collectionCode}`);
    }
    if (context.dateRaw) {
      parts.push(`Date string from filename: ${context.dateRaw}`);
    }
    if (context.dateFromFilename) {
      parts.push(`Parsed date from filename: ${context.dateFromFilename}`);
    }

    if (parts.length > 0) {
      prompt += `\n\nAdditional context:\n${parts.join('\n')}`;
    }
  }

  return prompt;
}

// ============================================================================
// V2 METADATA EXTRACTION (GPT-5.4 with Structured Outputs)
// ============================================================================

import { PRIMARY_TOPICS } from './schemas/metadataV2.js';
import {
  PERSON_RELATIONSHIP_TYPES,
  PERSON_PLACE_CONNECTION_TYPES,
} from './schemas/entityExtraction.js';

// ============================================================================
// CONTROLLED VOCABULARIES WITH DEFINITIONS
// Following OpenAI Cookbook's temporal agent pattern: each type has a
// definition and examples/indicators to ensure consistent AI output.
// ============================================================================

/**
 * Relationship type definitions with indicators.
 * These help the AI map observed patterns to correct enum values.
 */
const RELATIONSHIP_DEFINITIONS: Record<string, { definition: string; indicators: string[] }> = {
  'spouse': {
    definition: 'Married couple - husband and wife',
    indicators: ['my dear wife', 'your loving husband', 'Mrs.', 'married', 'matrimony']
  },
  'fiancé/fiancée': {
    definition: 'Engaged to be married, not yet wed',
    indicators: ['my betrothed', 'future wife', 'future husband', 'engagement', 'wedding plans', 'engaged']
  },
  'romantic-partner': {
    definition: 'Romantic relationship, not engaged or married',
    indicators: ['sweetheart', 'darling', 'my love', 'courting', 'dearest', 'devoted admirer']
  },
  'parent': {
    definition: 'Parent writing to or about their child',
    indicators: ['my son', 'my daughter', 'your mother', 'your father', 'my child']
  },
  'child': {
    definition: 'Child writing to or about their parent',
    indicators: ['dear mother', 'dear father', 'mom', 'dad', 'papa', 'mama', 'ma', 'pa']
  },
  'sibling': {
    definition: 'Brothers or sisters',
    indicators: ['dear brother', 'dear sister', 'sis', 'bro']
  },
  'grandparent': {
    definition: 'Grandparent writing to or about grandchild',
    indicators: ['my grandchild', 'grandmother', 'grandfather', 'grandma', 'grandpa']
  },
  'grandchild': {
    definition: 'Grandchild writing to or about grandparent',
    indicators: ['dear grandma', 'dear grandpa', 'grandmother', 'grandfather']
  },
  'aunt/uncle': {
    definition: 'Aunt or uncle relationship',
    indicators: ['dear aunt', 'dear uncle', 'auntie']
  },
  'nephew/niece': {
    definition: 'Nephew or niece relationship',
    indicators: ['my nephew', 'my niece']
  },
  'cousin': {
    definition: 'Cousin relationship',
    indicators: ['dear cousin', 'my cousin', 'coz']
  },
  'in-law': {
    definition: 'Related by marriage (mother-in-law, brother-in-law, etc.)',
    indicators: ['mother-in-law', 'father-in-law', 'sister-in-law', 'son-in-law']
  },
  'friend': {
    definition: 'Close personal friend, non-romantic',
    indicators: ['dear friend', 'old friend', 'my friend', 'pal', 'chum']
  },
  'acquaintance': {
    definition: 'Known person, not close friend or family',
    indicators: ['Mr.', 'Mrs.', 'formal address', 'sir', 'madam', 'respectfully']
  },
  'business-associate': {
    definition: 'Professional or business relationship',
    indicators: ['colleague', 'partner', 'business matters', 'regards', 'firm']
  },
  'employer': {
    definition: 'Writing to an employee',
    indicators: ['your employer', 'the company', 'your position', 'employment']
  },
  'employee': {
    definition: 'Writing to an employer',
    indicators: ['my employer', 'the boss', 'work', 'job', 'position']
  },
  'unknown': {
    definition: 'Relationship cannot be determined from letter content',
    indicators: []
  }
};

/**
 * Emotional tone definitions with indicators.
 */
const EMOTIONAL_TONE_DEFINITIONS: Record<string, { definition: string; indicators: string[] }> = {
  'joyful': {
    definition: 'Expressing happiness, celebration, or good news',
    indicators: ['wonderful news', 'so happy', 'delighted', 'thrilled', 'celebrating']
  },
  'hopeful': {
    definition: 'Expressing optimism, anticipation, or looking forward',
    indicators: ['looking forward', 'hope', 'soon', 'anticipate', 'expect']
  },
  'neutral': {
    definition: 'Informational, matter-of-fact, reporting without strong emotion',
    indicators: ['informing you', 'to let you know', 'update', 'news']
  },
  'anxious': {
    definition: 'Expressing worry, concern, or uncertainty',
    indicators: ['worried', 'concerned', 'uncertain', "don't know", 'anxious']
  },
  'sad': {
    definition: 'Expressing grief, loss, or disappointment',
    indicators: ['sorry to hear', 'miss you', 'regret', 'loss', 'passed away']
  },
  'angry': {
    definition: 'Expressing frustration, conflict, or resentment',
    indicators: ['frustrated', 'cannot believe', 'upset', 'unfair', 'wrong']
  },
  'desperate': {
    definition: 'Pleading, urgency, or crisis situation',
    indicators: ['please', 'beg', 'must', 'urgent', 'immediately', 'need']
  }
};

/**
 * Build relationship type documentation for prompts
 */
function buildRelationshipTypeDocs(): string {
  const lines: string[] = [];
  for (const [key, info] of Object.entries(RELATIONSHIP_DEFINITIONS)) {
    const indicators = info.indicators.length > 0
      ? ` (look for: ${info.indicators.slice(0, 4).join(', ')})`
      : '';
    lines.push(`  - "${key}": ${info.definition}${indicators}`);
  }
  return lines.join('\n');
}

/**
 * Build emotional tone documentation for prompts
 */
function buildEmotionalToneDocs(): string {
  const lines: string[] = [];
  for (const [key, info] of Object.entries(EMOTIONAL_TONE_DEFINITIONS)) {
    const indicators = info.indicators.length > 0
      ? ` (look for: ${info.indicators.slice(0, 4).join(', ')})`
      : '';
    lines.push(`  - "${key}": ${info.definition}${indicators}`);
  }
  return lines.join('\n');
}

/**
 * V2 Metadata System Prompt
 *
 * Uses XML-style section tags per GPT-5.4 best practices.
 * Includes one-shot example for more precise extraction.
 * Controlled vocabularies with definitions following OpenAI Cookbook patterns.
 */
export const METADATA_V2_SYSTEM_PROMPT = `You are an expert archivist extracting structured metadata from historical letter transcriptions.

<source_priority>
The letter transcription is your PRIMARY source of truth. Extract all information you can from it first.

Extra content (envelopes, telegrams, ephemera) is SUPPLEMENTARY context only:
- Use it to fill gaps when the letter itself doesn't provide the information
- Do NOT let envelope addresses or postmarks override information found in the letter body
- Extra content that contains additional letter-like text (notes, messages) carries more weight than purely logistical content (addresses, postmarks)
- If the letter and extra content contradict each other, prefer the letter

If no extra content exists, that simply means there is none — do not treat its absence as a gap.
</source_priority>

<guidelines>
- Extract ONLY information explicitly stated or clearly implied in the text
- Set null for any field you cannot determine with reasonable confidence
- NEVER fabricate or guess information not present in the text
- Preserve exact names, places, and terms from the letter - do not paraphrase
- For dates, use ISO format (YYYY-MM-DD) if complete, or partial format (YYYY-MM or YYYY) if incomplete
- Confidence scores: 0.9+ = explicit in text, 0.7-0.9 = strongly implied, 0.5-0.7 = inferred
</guidelines>

<unknown_identity>
## Unknown Sender/Recipient

If you cannot determine the sender's name from the letter or extra content, use the exact placeholder «SENDER» (with guillemet characters « and ») as their name in ALL output fields — sender, summary, hook, notable_quotes context, ai_notes, everywhere.

If you cannot determine the recipient's name, use the exact placeholder «RECIPIENT» in the same way.

Rules for placeholders:
- Use the EXACT tokens «SENDER» and «RECIPIENT» — do not use [SENDER], "unknown", "the author", or any variation
- Use these placeholders consistently in every field where the name would appear
- Do NOT use gendered pronouns (he/she/him/her) for unknown persons — instead write "the sender" or "the recipient"
- For possessives of unknown persons, write "the sender's" or "the recipient's" (not «SENDER»'s)
- If you CAN determine the name, use the actual name — only use placeholders when truly unknown
</unknown_identity>

<controlled_vocabularies>
IMPORTANT: Use EXACTLY the values specified below. Do not use synonyms or variations.

## emotional_tone (choose EXACTLY ONE)
${buildEmotionalToneDocs()}

## sender_recipient_relationship (choose EXACTLY ONE)
${buildRelationshipTypeDocs()}

COMMON MISTAKES TO AVOID:
- Use "romantic-partner" NOT "romantic partners", "romantic relationship", or "partners"
- Use "fiancé/fiancée" NOT "engaged", "engagement", or "betrothed"
- Use "spouse" NOT "married", "husband", or "wife"
- Use "business-associate" NOT "colleague", "coworker", or "business partner"
</controlled_vocabularies>

<field_instructions>
sender/recipient:
- Extract the name exactly as written
- Set confidence based on how explicitly they are identified

location_written:
- Where the letter was written from (not where recipient lives)
- Look for letterhead, "writing from", location mentions at start

hook (max 150 characters):
- 1-2 sentence teaser that makes readers want to explore the letter
- Present tense, third person
- Focus on the most compelling human element
- Must be faithful to actual content
- Do not introduce new facts, names, motives, or outcomes not present in the source
- If evidence is weak, set hook to null rather than guessing

summary:
- Length proportional to letter: short letter = 1-2 sentences, medium = 2-3, long = 3-4
- Factual description, neutral tone
- Never longer than the letter itself
- Include only source-supported claims; uncertain interpretations must be explicitly marked
- If confidence is too low to summarize faithfully, set summary to null

primary_topics (1-3 from this list):
${PRIMARY_TOPICS.map(t => `- ${t}`).join('\n')}

notable_quotes (1-3):
- Select memorable, representative quotes from the letter
- Each quote: exact text, brief context explaining significance, position in letter

ai_notes: An array of structured observations for the admin reviewer. Each note is:
- content: The observation. Be specific, cite evidence from the letter.
- category: One of: identity, date, transcription, relationship, context, cross-reference, location, condition
- priority: "high" = admin must address for correctness, "medium" = improves quality, "low" = informational
- resolves_when: A trigger key if auto-resolvable, or null. Valid keys: sender_filled, recipient_filled, date_confirmed, date_conflict_resolved, location_filled, relationship_set, transcription_edited

Rules:
- 2-6 notes per letter. Fewer is better.
- Unknown sender → MUST have high-priority identity note with resolves_when: "sender_filled"
- Unknown recipient → MUST have high-priority identity note with resolves_when: "recipient_filled"
- Date conflicts → always high priority
- A typical letter should have 0-1 high priority notes
- Historical context → always low priority
- Empty array [] if no observations
</field_instructions>

<example>
Letter transcription:
---
                                        Sept 21st 1947

Dearest Molly,

I have just received your letter and I hardly know what to say. I am terribly disappointed but I still love you as much as ever.

Please, please give me one more month. I can fly over and we can talk. George doesn't know you like I do. Remember when we walked down Stockport Road together? That meant something.

Tell Barbara I said hello. I hope she is doing well in school.

With all my love,
Your devoted admirer
---

Extracted metadata:
{
  "sender": { "name": null, "confidence": 0.0 },
  "recipient": { "name": "Molly", "confidence": 0.95 },
  "location_written": { "name": null, "confidence": 0.0 },
  "extracted_date": "1947-09-21",
  "extracted_date_confidence": "exact",
  "hook": "An American man desperately pleads for his British love to delay her plans with another suitor.",
  "summary": "The writer responds to Molly's letter with disappointment but unwavering love. He asks for one more month and offers to fly over, comparing his devotion to her other suitor George. He recalls their walk on Stockport Road and sends regards to Barbara.",
  "emotional_tone": "desperate",
  "sender_recipient_relationship": "romantic-partner",
  "primary_topics": ["family/marriage", "family/separation", "travel/journey"],
  "notable_quotes": [
    { "text": "Please, please give me one more month.", "context": "Desperate plea for more time", "position": "middle" },
    { "text": "George doesn't know you like I do.", "context": "Comparing himself to rival suitor", "position": "middle" }
  ],
  "ai_notes": [
    { "content": "Sender signs as 'Your devoted admirer' with no name — identity unknown. Handwriting or envelope may help.", "category": "identity", "priority": "high", "resolves_when": "sender_filled" },
    { "content": "Barbara appears to be Molly's daughter — suggests Molly may be a widow or divorced.", "category": "relationship", "priority": "medium", "resolves_when": null },
    { "content": "Stockport Road is in Manchester, UK. Sender mentions 'flying over', suggesting transatlantic correspondence.", "category": "location", "priority": "low", "resolves_when": null }
  ]
}
</example>

<verification>
Before returning, verify:
1. All names/places are spelled exactly as in the letter
2. Confidence scores reflect actual certainty
3. Hook is under 150 characters
4. Topics are from the approved list
5. At least 1 quote is included if the letter has any memorable passages
6. Hook/summary do not contain invented facts, names, motives, or outcomes
7. If evidence is insufficient, uncertain fields are set to null
</verification>`;

/**
 * Build V2 metadata user prompt
 */
export function buildMetadataV2UserPrompt(
  transcriptionText: string,
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

  // Include letter transcription if available
  if (transcriptionText?.trim()) {
    prompt += `<letter_transcription>\n${transcriptionText}\n</letter_transcription>`;
  } else {
    prompt += `<letter_transcription>\nNo letter transcription available.\n</letter_transcription>`;
  }

  // Include extra content if available (telegrams, envelopes, ephemera)
  if (context?.extraContentTranscript?.trim()) {
    prompt += `\n\n<extra_content>\nThe following is transcribed text from related items (envelope, telegram, ephemera, etc.) that may provide additional context:\n\n${context.extraContentTranscript}\n</extra_content>`;
  }

  // Include reviewer corrections if available
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

  if (context) {
    const parts: string[] = [];
    if (context.collectionCode) {
      parts.push(`Collection: ${context.collectionCode}`);
    }
    if (context.dateRaw) {
      parts.push(`Date string from filename: ${context.dateRaw}`);
    }
    if (context.dateFromFilename) {
      parts.push(`Parsed date from filename: ${context.dateFromFilename}`);
    }

    if (parts.length > 0) {
      prompt += `\n\n<context>\n${parts.join('\n')}\n</context>`;
    }
  }

  prompt += '\n\nExtract metadata following the schema. Return JSON only.';

  return prompt;
}

// ============================================================================
// ENTITY EXTRACTION (Prompt 2 - People, Places, Relationships)
// ============================================================================

/**
 * Build relationship type documentation for entity extraction prompt.
 * Uses bidirectional types (parent-child, employer-employee) from personRelationshipTypeEnum.
 */
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

/**
 * Entity Extraction System Prompt (Prompt 2)
 *
 * Extracts rich profiles of people and places, discovers relationships
 * between entities, and maps person-to-place connections.
 */
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
      "confidence": 0.95
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
      "confidence": 0.9
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
      "confidence": 0.85
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
      "confidence": 0.95
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
</verification>`;

/**
 * Build entity extraction user prompt.
 * Includes the letter text plus basic metadata from Prompt 1 as context.
 */
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

  // Include letter transcription if available
  if (transcriptionText?.trim()) {
    prompt += `<letter_transcription>\n${transcriptionText}\n</letter_transcription>`;
  } else {
    prompt += `<letter_transcription>\nNo letter transcription available.\n</letter_transcription>`;
  }

  // Include extra content if available
  if (context?.extraContentTranscript?.trim()) {
    prompt += `\n\n<extra_content>\nThe following is transcribed text from related items (envelope, telegram, ephemera, etc.) that may provide additional context:\n\n${context.extraContentTranscript}\n</extra_content>`;
  }

  // Include reviewer corrections if available
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

  // Include basic metadata from Prompt 1 as context
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

// ============================================================================
// PERSON BIOGRAPHY GENERATION
// ============================================================================

/**
 * System prompt for generating person biographies from letter summaries.
 * Follows OpenAI Cookbook's structured output patterns.
 */
export const BIOGRAPHY_SYSTEM_PROMPT = `You are an expert archivist writing biographical narratives about people who appear in historical letters.

<guidelines>
- Write in third person, past tense
- Base ALL content on provided letter summaries and relationships
- NEVER fabricate information not present in the source material
- Length should be ADAPTIVE based on available information:
  - 1-5 letters: 2-3 sentences
  - 5-15 letters: 1 paragraph
  - 15+ letters: 2-3 paragraphs
- Focus on relationships, life events, and personality revealed through letters
- Use temporal markers when known (e.g., "In 1943...", "During the war...")
- Include uncertainty markers (e.g., "apparently", "it seems") for inferred content
</guidelines>

<structure>
For substantial biographies, organize as:
1. Opening: Who they were and their key relationships
2. Middle: Life events and patterns revealed in letters
3. Closing: Final known status or summary of their role in the correspondence
</structure>

<verification>
Before responding, verify:
1. Every claim is supported by provided letter data
2. No invented names, dates, or events
3. Length matches information density
4. Tone is appropriate for historical archive
</verification>`;

/**
 * Build user prompt for biography generation.
 * Includes person name, relationships, and chronological letter summaries.
 */
export function buildBiographyUserPrompt(
  personName: string,
  relationships: Array<{ name: string; type: string }>,
  letterSummaries: Array<{ date: string; summary: string; role: 'sender' | 'recipient' | 'mentioned' }>
): string {
  let prompt = `Generate a biography for: ${personName}\n\n`;

  if (relationships.length > 0) {
    prompt += '<relationships>\n';
    for (const rel of relationships) {
      prompt += `- ${rel.type} of ${rel.name}\n`;
    }
    prompt += '</relationships>\n\n';
  }

  prompt += '<letters_chronological>\n';
  for (const letter of letterSummaries) {
    prompt += `- ${letter.date} (${letter.role}): ${letter.summary}\n`;
  }
  prompt += '</letters_chronological>\n\n';

  prompt += 'Write the biography based ONLY on this information. Do not fabricate any details.';
  return prompt;
}

// ============================================================================
// COLLECTION ANALYSIS
// ============================================================================

/**
 * System prompt for analyzing a collection of letters to discover entities and connections.
 */
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

/**
 * Build user prompt for collection analysis.
 * Includes letter summaries with entity information.
 */
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

// ============================================================================
// METADATA UPDATE (AI-assisted sender/recipient correction)
// ============================================================================

/**
 * System prompt for AI-assisted metadata update.
 * Used when a human reviewer sets a sender/recipient for the first time
 * (was previously null) and we need AI to rewrite summary, hook, etc.
 */
export const METADATA_UPDATE_SYSTEM_PROMPT = `You are updating existing metadata for a historical letter.
A human reviewer has provided new information about the sender and/or recipient.

You will receive the existing extracted metadata and the correction.
Update the metadata to incorporate the new information.

Rules:
- Keep all existing information that is still valid
- Update the summary to naturally incorporate the identified sender/recipient
- Update the hook if it references the sender/recipient (hooks should use first names, be 1-2 sentences, max 150 chars)
- Update entity roles if sender/recipient identity changes who the sender/recipient is
- Do NOT change dates, locations, topics, emotional tone, or other metadata unless directly affected by the identity change
- Return the COMPLETE updated metadata in the same format as the input`;

/**
 * Build user prompt for AI-assisted metadata update.
 * Includes existing metadata, existing entities, and the correction.
 */
export function buildMetadataUpdateUserPrompt(params: {
  existingMetadata: Record<string, unknown>;
  existingEntities: Record<string, unknown> | null;
  correction: {
    field: 'sender' | 'recipient' | 'both';
    oldSender?: string | null;
    newSender?: string;
    oldRecipient?: string | null;
    newRecipient?: string;
  };
}): string {
  let prompt = '';

  prompt += '<existing_metadata>\n';
  prompt += JSON.stringify(params.existingMetadata, null, 2);
  prompt += '\n</existing_metadata>\n';

  if (params.existingEntities) {
    prompt += '\n<existing_entities>\n';
    prompt += JSON.stringify(params.existingEntities, null, 2);
    prompt += '\n</existing_entities>\n';
  }

  prompt += '\n<correction>\n';

  const { correction } = params;

  if (correction.newSender) {
    if (correction.oldSender) {
      prompt += `The sender was previously identified as "${correction.oldSender}" but should be "${correction.newSender}".\n`;
    } else {
      prompt += `The sender was previously unknown. The human reviewer has identified the sender as: "${correction.newSender}".\n`;
    }
  }

  if (correction.newRecipient) {
    if (correction.oldRecipient) {
      prompt += `The recipient was previously identified as "${correction.oldRecipient}" but should be "${correction.newRecipient}".\n`;
    } else {
      prompt += `The recipient was previously unknown. The human reviewer has identified the recipient as: "${correction.newRecipient}".\n`;
    }
  }

  prompt += '</correction>\n\n';
  prompt += 'Update the metadata to incorporate the correction. Return the COMPLETE updated metadata JSON.';

  return prompt;
}

// ============================================================================
// COLLECTION ENTITY RESOLUTION (Post-extraction identity resolution)
// ============================================================================

import type {
  CollectionPerson,
  CollectionLetterPersonJunction,
  CollectionRelationship,
  LetterMissingParticipant,
  GenericPerson,
} from '../services/entities/collection-queries.js';

/**
 * System prompt for collection-level entity resolution.
 * Expert genealogist doing cross-letter identity resolution.
 */
export const ENTITY_RESOLUTION_SYSTEM_PROMPT = `You are an expert genealogist performing cross-letter identity resolution on a collection of historical letters. You have been given ALL canonical persons, their letter appearances, and relationships for the entire collection.

<task>
Analyze all entities across the collection and produce a resolution plan:
1. MERGE GROUPS: Identify persons that are actually the same individual (nicknames, spelling variations, formal vs informal names)
2. GENERIC RESOLUTIONS: Resolve placeholder entities ("the sender", "your brother") to real identified persons, or mark for deletion
3. SENDER/RECIPIENT FILLS: For letters with missing sender or recipient fields, infer the correct person from junction data
4. RELATIONSHIP CORRECTIONS: Fix mistyped relationships or flag duplicates created by split entities
</task>

<merge_guidelines>
- Nickname to formal name mappings are common: "Jimmie" → "James", "Molly" → "Mary", "Geo." → "George"
- Shared correspondents are a strong signal: if "Jimmie" and "James A Hamler Jr" both appear as sender writing to the same recipient, they are likely the same person
- Same role patterns: if person A is always sender and person B is always sender with similar names, they may be the same
- Consider letter dates: entities appearing in overlapping time periods with similar contexts are stronger merge candidates
- Prefer the most complete/formal name as the canonical name
- The keep_person_id should be the one with more data (more letters, more relationships)
- Confidence tiers:
  - 0.95+: Obvious match (same name with minor spelling variation, clear nickname)
  - 0.85-0.94: Strong match (nickname + shared correspondents + consistent context)
  - 0.70-0.84: Probable match (similar name but less contextual evidence)
  - Below 0.70: Uncertain, include but expect human review
</merge_guidelines>

<generic_guidelines>
- Resolve "the sender" or "the writer" to the actual sender if unambiguous from letter context
- Resolve "your brother" to a named brother if the relationship is established elsewhere
- DELETE generic entities that add no information (e.g., "a man" with no identifying details)
- KEEP generic entities only if they refer to a genuinely unidentified person with meaningful context
- For merge: set resolves_to_person_id to the real person's ID
- For delete: set resolves_to_person_id to null
</generic_guidelines>

<fill_guidelines>
- Infer sender/recipient from junction data: if a person has role "sender" in the junction table but the letter's sender field is null, fill it
- Only fill when there is strong evidence (the junction exists with the right role)
- Use the canonical name for the fill
- Do NOT overwrite existing values
</fill_guidelines>

<relationship_guidelines>
- After merges, some relationships may become duplicates (A↔B and A↔C, where B and C are now merged)
- Flag relationships with incorrect types (e.g., two known siblings marked as "unknown")
- For corrections: provide the corrected_type from the allowed relationship types
- For deletions (duplicate relationships): set corrected_type to null
- Allowed relationship types: spouse, fiancé/fiancée, romantic-partner, parent-child, sibling, grandparent-grandchild, aunt-uncle-niece-nephew, cousin, in-law, friend, acquaintance, business-associate, employer-employee, unknown
</relationship_guidelines>

<confidence_thresholds>
Actions with confidence >= 0.85 will be auto-executed.
Actions with confidence < 0.85 will be queued for human review.
Set confidence accurately — overconfident merges destroy data.
</confidence_thresholds>

<verification>
Before returning, verify:
1. No person ID appears in both keep_person_id and merge_person_ids across different merge groups
2. All referenced person IDs exist in the provided data
3. All referenced letter IDs exist in the provided data
4. Merge groups don't create circular references
5. Generic resolutions point to valid person IDs (or null for deletions)
6. Relationship corrections reference valid relationship types
</verification>`;

/**
 * Build user prompt for entity resolution.
 * Assembles all collection entity data in XML-tagged sections.
 */
export function buildEntityResolutionUserPrompt(data: {
  persons: CollectionPerson[];
  junctions: CollectionLetterPersonJunction[];
  relationships: CollectionRelationship[];
  missingParticipants: LetterMissingParticipant[];
  genericPersons: GenericPerson[];
}): string {
  let prompt = '';

  // Section 1: Canonical persons
  prompt += '<canonical_persons>\n';
  for (const p of data.persons) {
    const aliases = p.aliases.length > 0 ? ` aliases=[${p.aliases.join(', ')}]` : '';
    prompt += `- id=${p.id} name="${p.canonicalName}"${aliases} letters=${p.letterCount} sender=${p.senderCount} recipient=${p.recipientCount} mentioned=${p.mentionedCount}\n`;
  }
  prompt += '</canonical_persons>\n\n';

  // Section 2: Letter-person junctions (grouped by letter)
  prompt += '<letter_person_junctions>\n';
  const junctionsByLetter = new Map<string, CollectionLetterPersonJunction[]>();
  for (const j of data.junctions) {
    const existing = junctionsByLetter.get(j.letterId) || [];
    existing.push(j);
    junctionsByLetter.set(j.letterId, existing);
  }
  for (const [letterId, junctions] of junctionsByLetter) {
    const first = junctions[0];
    prompt += `\nLetter ${letterId} (${first.dateRaw}):\n`;
    if (first.summary) prompt += `  Summary: ${first.summary}\n`;
    for (const j of junctions) {
      const nameWritten = j.nameAsWritten ? ` nameAsWritten="${j.nameAsWritten}"` : '';
      const ctx = j.context ? ` context="${j.context}"` : '';
      prompt += `  - person=${j.personId} "${j.personName}" role=${j.role}${nameWritten}${ctx} confidence=${j.confidence}\n`;
    }
  }
  prompt += '</letter_person_junctions>\n\n';

  // Section 3: Existing relationships
  if (data.relationships.length > 0) {
    prompt += '<existing_relationships>\n';
    for (const r of data.relationships) {
      prompt += `- id=${r.id} "${r.personAName}" (${r.personAId}) ↔ "${r.personBName}" (${r.personBId}) type=${r.relationshipType} confidence=${r.confidence}\n`;
    }
    prompt += '</existing_relationships>\n\n';
  }

  // Section 4: Letters with missing sender/recipient
  if (data.missingParticipants.length > 0) {
    prompt += '<letters_missing_participants>\n';
    for (const l of data.missingParticipants) {
      const missing = [];
      if (l.missingSender) missing.push('sender');
      if (l.missingRecipient) missing.push('recipient');
      prompt += `- letter=${l.letterId} date=${l.dateRaw} missing=[${missing.join(', ')}]`;
      if (l.sender) prompt += ` sender="${l.sender}"`;
      if (l.recipient) prompt += ` recipient="${l.recipient}"`;
      if (l.summary) prompt += ` summary="${l.summary}"`;
      prompt += '\n';
    }
    prompt += '</letters_missing_participants>\n\n';
  }

  // Section 5: Generic entities
  if (data.genericPersons.length > 0) {
    prompt += '<generic_entities>\n';
    for (const g of data.genericPersons) {
      prompt += `- id=${g.id} name="${g.canonicalName}" letters=${g.letterCount}\n`;
    }
    prompt += '</generic_entities>\n\n';
  }

  prompt += 'Analyze all entities and produce a resolution plan. Return JSON only.';

  return prompt;
}
