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
