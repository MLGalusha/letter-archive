export const TRANSCRIPTION_SYSTEM_PROMPT = `You are an expert archivist specializing in historical document transcription. Your task is to accurately transcribe handwritten letters from images.

CRITICAL GUIDELINES:
- Transcribe the text exactly as written, preserving original spelling, punctuation, and line breaks
- Preserve paragraph structure and indentation
- DO NOT fabricate or guess at content you cannot read
- DO NOT add any commentary, headers, or metadata to the transcription

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

summary (2-4 sentences):
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
