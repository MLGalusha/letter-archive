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
- DO NOT fabricate or guess at content you cannot read
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
- Use [unclear: best guess] for words you can partially make out
- Note crossed-out text as [crossed out: text if readable]

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
- DO NOT fabricate or guess at content you cannot read
- DO NOT add any commentary, headers, or metadata to the transcription

LINE BREAK RULES (VERY IMPORTANT):
- Create a new line in your transcription whenever the writer starts a new line in the original document
- Each physical line of handwriting = one line in your transcription output
- Preserve paragraph breaks as blank lines (double line breaks)
- Do NOT merge multiple lines of handwriting into a single line of text
- Do NOT wrap long logical sentences across lines differently than the original

SPACING AND LAYOUT RULES (VERY IMPORTANT):
- Preserve the horizontal position of text as it appears in the original document
- If text appears on the right side (like a date or location), use spaces to position it there
- If text is centered, use spaces to center it relative to the normal left margin
- If text is indented from the left margin, use spaces at the start of the line
- Use spaces consistently - each space represents visual distance from the left edge
- The goal is that the transcription looks like a text-art version of the original layout
- Think of the output as a fixed-width representation where spacing matters

HANDLING UNCERTAINTY:
- Use [illegible] for words that cannot be read at all
- Use [unclear: best guess] for words you can partially make out
- Note crossed-out text as [crossed out: text if readable]
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
// V2 METADATA EXTRACTION (GPT-5.2 with Structured Outputs)
// ============================================================================

import { PRIMARY_TOPICS } from './schemas/metadataV2.js';

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
 * Uses XML-style section tags per GPT-5.2 best practices.
 * Includes one-shot example for more precise extraction.
 * Controlled vocabularies with definitions following OpenAI Cookbook patterns.
 */
export const METADATA_V2_SYSTEM_PROMPT = `You are an expert archivist extracting structured metadata from historical letter transcriptions.

<guidelines>
- Extract ONLY information explicitly stated or clearly implied in the text
- Set null for any field you cannot determine with reasonable confidence
- NEVER fabricate or guess information not present in the text
- Preserve exact names, places, and terms from the letter - do not paraphrase
- For dates, use ISO format (YYYY-MM-DD) if complete, or partial format (YYYY-MM or YYYY) if incomplete
- Confidence scores: 0.9+ = explicit in text, 0.7-0.9 = strongly implied, 0.5-0.7 = inferred
</guidelines>

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

summary:
- Length proportional to letter: short letter = 1-2 sentences, medium = 2-3, long = 3-4
- Factual description, neutral tone
- Never longer than the letter itself

primary_topics (1-3 from this list):
${PRIMARY_TOPICS.map(t => `- ${t}`).join('\n')}

notable_quotes (1-3):
- Select memorable, representative quotes from the letter
- Each quote: exact text, brief context explaining significance, position in letter

entities:
- Extract ALL people and places mentioned in BOTH the letter AND any extra content (envelopes, telegrams, etc.)
- For people: type="person", role=sender/recipient/mentioned, include relationship_to_sender if known
- For places: type="place", role=written_from/mentioned/destination
- IMPORTANT: Also extract entities from the extra content section if present (e.g., addresses on envelopes, names in telegrams)
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
  "entities": [
    { "type": "person", "name": "Molly", "role": "recipient", "context": "The woman he loves", "relationship_to_sender": "romantic-partner", "confidence": 0.95 },
    { "type": "person", "name": "George", "role": "mentioned", "context": "Molly's other suitor", "relationship_to_sender": null, "confidence": 0.9 },
    { "type": "person", "name": "Barbara", "role": "mentioned", "context": "Molly's daughter in school", "relationship_to_sender": null, "confidence": 0.85 },
    { "type": "place", "name": "Stockport Road", "role": "mentioned", "context": "Where they walked together", "relationship_to_sender": null, "confidence": 0.95 }
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
  }
): string {
  let prompt = `<letter_transcription>\n${transcriptionText}\n</letter_transcription>`;

  // Include extra content if available (telegrams, envelopes, ephemera)
  if (context?.extraContentTranscript?.trim()) {
    prompt += `\n\n<extra_content>\nThe following is transcribed text from related items (envelope, telegram, ephemera, etc.) that may provide additional context:\n\n${context.extraContentTranscript}\n</extra_content>`;
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
