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
