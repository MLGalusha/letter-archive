export const METADATA_UPDATE_SYSTEM_PROMPT = `You are updating tagged references in letter metadata after a name correction.

The metadata text fields use guillemet tags — «SENDER:text» and «RECIPIENT:text» — to mark every reference to the sender or recipient. When a name is corrected, you must update the text inside every relevant tag to read naturally with the new name.

<rules>
- Only change the text INSIDE the «SENDER:...» or «RECIPIENT:...» tags — keep the tag wrappers
- Use the new name naturally: full name for first mention in each field, then first name, pronouns, or possessives as appropriate
- Match pronoun gender to the name when possible (e.g., "Jimmie" → he/him/his, "Molly" → she/her/her). Use they/them if gender is ambiguous.
- If the name is being cleared (set to null/unknown), replace name references with "the sender"/"the recipient", "they"/"them"/"their"
- Do NOT change: emotional_tone, primary_topics, extracted_date, location_written, sender_recipient_relationship, sender field, recipient field
- Do NOT change notable_quotes text field — only update tags in the context field
- Do NOT add, remove, or rephrase content — only update the tagged reference text
</rules>`;

export function buildMetadataUpdateUserPrompt(params: {
  existingMetadata: Record<string, unknown>;
  senderName: string | null;
  recipientName: string | null;
  change: {
    field: 'sender' | 'recipient' | 'both';
    oldSender?: string | null;
    newSender?: string | null;
    oldRecipient?: string | null;
    newRecipient?: string | null;
  };
}): string {
  const parts: string[] = [];

  // Describe exactly what changed
  parts.push('<change>');
  const { change } = params;

  if (change.field === 'sender' || change.field === 'both') {
    const oldLabel = change.oldSender ? `"${change.oldSender}"` : 'unknown';
    const newLabel = change.newSender ? `"${change.newSender}"` : 'unknown';
    parts.push(`SENDER changed: ${oldLabel} → ${newLabel}`);

    if (change.newSender) {
      parts.push(`Update the text inside every «SENDER:...» tag to reflect that the sender is "${change.newSender}".`);
    } else {
      parts.push(`The sender is now unknown. Update the text inside every «SENDER:...» tag to use "the sender", "they", "their", etc.`);
    }
  }

  if (change.field === 'recipient' || change.field === 'both') {
    const oldLabel = change.oldRecipient ? `"${change.oldRecipient}"` : 'unknown';
    const newLabel = change.newRecipient ? `"${change.newRecipient}"` : 'unknown';
    parts.push(`RECIPIENT changed: ${oldLabel} → ${newLabel}`);

    if (change.newRecipient) {
      parts.push(`Update the text inside every «RECIPIENT:...» tag to reflect that the recipient is "${change.newRecipient}".`);
    } else {
      parts.push(`The recipient is now unknown. Update the text inside every «RECIPIENT:...» tag to use "the recipient", "they", "their", etc.`);
    }
  }

  // Tell it what NOT to touch
  const unchangedRole = change.field === 'sender' ? 'RECIPIENT' : change.field === 'recipient' ? 'SENDER' : null;
  if (unchangedRole) {
    parts.push(`Do NOT change any «${unchangedRole}:...» tags — only update the changed role.`);
  }

  parts.push('</change>');

  // List exactly which fields contain tags to update
  parts.push('');
  parts.push('<fields_to_update>');
  parts.push('Update tags in these fields only: hook, summary, notable_quotes[].context, ai_notes[].content');
  parts.push('Leave all other fields exactly as they are.');
  parts.push('</fields_to_update>');

  // The metadata
  parts.push('');
  parts.push('<existing_metadata>');
  parts.push(JSON.stringify(params.existingMetadata, null, 2));
  parts.push('</existing_metadata>');

  parts.push('');
  parts.push('Return the COMPLETE updated metadata JSON.');

  return parts.join('\n');
}
