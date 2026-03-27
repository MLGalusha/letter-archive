import { PRIMARY_TOPICS } from '../schemas/metadataV2.js';

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
- Use the placeholder or actual name for the FIRST mention in each field (hook, summary, ai_notes)
- After the first mention, vary references naturally: use "the sender"/"the recipient", role descriptions ("the writer", "her husband", "their mother"), or pronouns when appropriate
- Only use gendered pronouns (he/she/him/her) when gender can be CONFIDENTLY inferred from the letter content (e.g., names, salutations like "Dear Wife", relationship terms). When gender is uncertain, use "they/them/their" or role descriptions instead.
- NEVER repeat the same reference form in consecutive sentences — if one sentence says "the sender", the next should use a pronoun or role description
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
- Only generate notes for genuinely surprising or non-obvious observations that a human reviewer would find valuable
- Do NOT note things already visible from other metadata fields (e.g., unknown sender, missing date, low confidence scores, missing location). The admin can see empty fields — noting them adds no value.
- Focus notes on: discrepancies (e.g., date in letter body contradicts filename date), transcription ambiguities, internal contradictions, cross-references to people or events mentioned, unexpected historical context
- Date conflicts between letter content and filename → always high priority
- 0-3 notes per letter. Most letters should have 0-1 notes. Empty array [] is perfectly fine and preferred when there is nothing surprising.
- Historical context → always low priority
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
  "hook": "An American man desperately pleads for his British love to delay her plans with another suitor.",
  "summary": "«SENDER» responds to Molly's letter with disappointment but unwavering love. He asks for one more month and offers to fly over, comparing his devotion to her other suitor George. The writer recalls their walk on Stockport Road and sends regards to Barbara.",
  "emotional_tone": "desperate",
  "sender_recipient_relationship": "romantic-partner",
  "primary_topics": ["family/marriage", "family/separation", "travel/journey"],
  "notable_quotes": [
    { "text": "Please, please give me one more month.", "context": "Desperate plea for more time", "position": "middle" },
    { "text": "George doesn't know you like I do.", "context": "Comparing himself to rival suitor", "position": "middle" }
  ],
  "ai_notes": [
    { "content": "Barbara appears to be Molly's daughter or younger relative — the sender sends regards and hopes she is doing well 'in school'.", "category": "relationship", "priority": "medium", "resolves_when": null },
    { "content": "Stockport Road is in Manchester, UK. The sender mentions 'flying over', suggesting transatlantic correspondence — likely writing from the US.", "category": "location", "priority": "low", "resolves_when": null }
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
