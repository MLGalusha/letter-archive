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

export const EXTRA_CONTENT_TRANSCRIPTION_SYSTEM_PROMPT = `You are an expert archivist specializing in historical document transcription. Your task is to accurately transcribe text from telegrams, envelopes, covers, and other ephemera.

CRITICAL GUIDELINES:
- Transcribe the text exactly as written, preserving original spelling, punctuation, and capitalization
- DO NOT add any commentary, headers, or metadata to the transcription
- DO NOT fabricate missing text, names, dates, or context

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

export const PHOTO_DESCRIPTION_SYSTEM_PROMPT = `You are an expert archivist describing historical photographs and other purely visual archival images.

<guidelines>
- Describe only what is visibly present in the image.
- Use concise, neutral archival language.
- If an identification is uncertain, label it clearly as uncertain.
- Do NOT invent names, dates, locations, events, relationships, or historical context.
- If reviewer context or linked letter context is provided, use it only to guide interpretation when it matches the visible evidence.
- Mention notable visual details when they matter: people, pose, clothing, objects, setting, photographic format, inscriptions, damage, or studio backdrop.
- If there is readable text inside the image, mention it briefly only when it materially helps identify the scene; do not switch into full transcription mode.
</guidelines>

<example>
Input:
- Image shows two children standing beside a porch railing.
- Reviewer context says they may be Jimmy and Molly.

Output:
A small black-and-white snapshot showing two children posed beside a wooden porch railing. The reviewer context suggests they may be Jimmy and Molly, but the identification is not confirmed by the image alone.
</example>

<verification>
Before returning, verify:
1. Every factual claim is grounded in the image or explicitly marked as context-based.
2. Uncertainties stay uncertain.
3. The response is plain description text only, with no headings or bullet points.
</verification>`;

export function buildExtraContentCheckPrompt(context?: {
  documentType?: string;
}): string {
  let prompt = 'Analyze this image and determine if it contains transcribable text.';

  if (context?.documentType) {
    prompt += `\n\nDocument type hint: ${context.documentType}`;
  }

  return prompt;
}

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

export function buildPhotoDescriptionPrompt(context?: {
  collectionCode?: string;
  dateRaw?: string;
  photoNumber?: number;
  totalPhotos?: number;
  linkedLetterContext?: string;
  reviewerContext?: string | null;
}): string {
  const blocks: string[] = [
    '<task>\nDescribe this archival image for public browsing.\n</task>',
  ];

  const contextLines: string[] = [];
  if (context?.collectionCode) {
    contextLines.push(`Collection: ${context.collectionCode}`);
  }
  if (context?.dateRaw) {
    contextLines.push(`Date from filename: ${context.dateRaw}`);
  }
  if (context?.photoNumber !== undefined) {
    const photoInfo = context.totalPhotos
      ? `Image ${context.photoNumber} of ${context.totalPhotos}`
      : `Image ${context.photoNumber}`;
    contextLines.push(photoInfo);
  }

  if (contextLines.length > 0) {
    blocks.push(`<context>\n${contextLines.join('\n')}\n</context>`);
  }

  if (context?.linkedLetterContext?.trim()) {
    blocks.push(
      `<linked_letter_context>\nUse this only as supporting context for the image if it matches the visible evidence.\n\n${context.linkedLetterContext.trim()}\n</linked_letter_context>`,
    );
  }

  if (context?.reviewerContext?.trim()) {
    blocks.push(
      `<reviewer_context>\nUse this only as supporting context if it matches the visible evidence.\n\n${context.reviewerContext.trim()}\n</reviewer_context>`,
    );
  }

  blocks.push(
    '<instructions>\nReturn a short archival description in plain prose only. Do not add headings, XML tags, or bullet points.\n</instructions>',
  );

  return blocks.join('\n\n');
}

/** Legacy flat-text prompt — used as fallback when structured output fails */
export const LEGACY_TRANSCRIPTION_SYSTEM_PROMPT = `You are an expert archivist specializing in historical document transcription. Your task is to accurately transcribe handwritten letters from images.

CRITICAL GUIDELINES:
- Transcribe the text exactly as written, preserving original spelling, punctuation, and capitalization
- DO NOT add any commentary, headers, or metadata to the transcription
- DO NOT fabricate missing text, names, dates, or context

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

/** @deprecated Use LEGACY_TRANSCRIPTION_SYSTEM_PROMPT for the flat-text fallback */
export const TRANSCRIPTION_SYSTEM_PROMPT = LEGACY_TRANSCRIPTION_SYSTEM_PROMPT;

/**
 * Structured transcription prompt — returns JSON with per-line annotations.
 * Used with OpenAI responses.create + strict json_schema.
 */
export const STRUCTURED_TRANSCRIPTION_SYSTEM_PROMPT = `You are an expert archivist specializing in historical document transcription. Your task is to accurately transcribe handwritten letters from images, producing structured line-by-line data.

CRITICAL GUIDELINES:
- Transcribe the text exactly as written, preserving original spelling, punctuation, and capitalization
- DO NOT fabricate missing text, names, dates, or context
- Each physical line of handwriting in the image = one entry in the lines array

FOR EACH LINE, PROVIDE:

1. "text" — The transcribed text content. Do NOT add leading spaces for positioning; positioning is handled by the "x" field. Preserve the original spelling, punctuation, and capitalization exactly.

2. "x" — The approximate horizontal starting position of the first character, as an integer from 0 to 999 where 0 is the left edge and 999 is the right edge of the writing area. Most body text starts near 0-50. Dates or locations positioned on the right side of the page would be 400-800. Centered text would be around 200-500 depending on length.

3. "paragraph" — An integer grouping body text into paragraphs. Increment the number when there is a clear paragraph break (blank line, significant vertical gap, or new topic indentation). Set to null for non-body elements (dates, salutations, closings, signatures, etc.).

4. "continues" — Set to true ONLY when a line is a margin continuation of the previous line — meaning the writer ran out of horizontal space and continued writing on the next physical line, NOT starting a new thought. This is the key distinction: if removing the line break would create a natural flowing sentence with the previous line, it continues. If the line starts a new thought or structural element, it does not continue.

5. "role" — The structural role of this line:
   - "date" — A date line, typically at the top (e.g., "September 12, 1943", "Sept. 12th")
   - "salutation" — The greeting (e.g., "Dear Mother,", "My dearest John,")
   - "body" — Regular letter body text (most common)
   - "closing" — The sign-off phrase (e.g., "Yours truly,", "With love,", "Your affectionate son,")
   - "signature" — The writer's name after the closing
   - "postscript" — Text after the signature (e.g., "P.S. ...", "P.P.S. ...")
   - "margin-note" — Text written in margins, sideways, or squeezed into unusual positions
   - "address" — Mailing address, typically on envelopes or letter headers
   - null — When the role is ambiguous or doesn't fit the categories above

BLANK LINES:
- When there is a blank line (paragraph break) in the original, include a line entry with empty text "", x: 0, paragraph: null, continues: false, role: null.

HANDLING UNCERTAINTY:
- Use [illegible] for words that cannot be read at all
- Note crossed-out text as [crossed out]
- In typewritten text, ignore characters overtyped with "x" (typist corrections)
- Indicate inserted text as [insertion: text]
- Indicate marginal notes as separate lines with role "margin-note"`;

export function buildStructuredTranscriptionUserPrompt(context?: {
  collectionCode?: string;
  dateRaw?: string;
  pageNumber?: number;
  totalPages?: number;
}): string {
  let prompt = 'Transcribe this handwritten document image line by line.';

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
