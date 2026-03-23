/**
 * AI-Assisted Metadata Update Service
 *
 * When a sender/recipient is set for the first time (was null/empty),
 * this service calls OpenAI to intelligently update the metadata
 * (summary, hook, entity roles, etc.) incorporating the new identity.
 *
 * Falls back to simple field update in stub mode (no OPENAI_API_KEY).
 */

import { eq } from 'drizzle-orm';
import { db, letters, type Letter } from '../db/index.js';
import { env, hasOpenAI } from '../config/env.js';
import { openai, log as openaiLog } from '../ai/openai/client.js';
import {
  METADATA_UPDATE_SYSTEM_PROMPT,
  buildMetadataUpdateUserPrompt,
} from '../ai/prompts.js';
import { MetadataV2Schema, type MetadataV2 } from '../ai/schemas/metadataV2.js';
import { METADATA_V2_JSON_SCHEMA } from '../ai/schemas/metadataV2.js';
import { createLogger } from '../utils/logger.js';
import { logApiUsage } from './usage-tracking.js';

const log = createLogger({ module: 'metadata-update' });

export interface AiUpdateParams {
  letterId: string;
  newSender?: string;
  newRecipient?: string;
}

export interface AiUpdateResult {
  letter: Letter;
  method: 'ai' | 'simple';
  fieldsUpdated: string[];
}

/**
 * Use AI to update metadata when a sender/recipient is being set for the first time.
 *
 * If OpenAI is not available (stub mode), falls back to a simple field update.
 */
export async function aiUpdateMetadata(params: AiUpdateParams): Promise<AiUpdateResult> {
  const { letterId, newSender, newRecipient } = params;
  const letterLog = log.child({ letterId, newSender, newRecipient });

  letterLog.info('Starting AI metadata update');

  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  // If no OpenAI key or no existing metadata to update, do simple field update
  if (!hasOpenAI || !openai || !letter.metadataV2Json) {
    letterLog.debug('Using simple field update (no OpenAI or no existing metadata)');
    return simpleFieldUpdate(letter, newSender, newRecipient);
  }

  const existingMetadata = letter.metadataV2Json as Record<string, unknown>;
  const existingEntities = letter.entityExtractionJson as Record<string, unknown> | null;

  // Determine what changed
  const correction: {
    field: 'sender' | 'recipient' | 'both';
    oldSender?: string | null;
    newSender?: string;
    oldRecipient?: string | null;
    newRecipient?: string;
  } = {
    field: (newSender && newRecipient) ? 'both' : newSender ? 'sender' : 'recipient',
  };

  if (newSender) {
    correction.oldSender = letter.sender;
    correction.newSender = newSender;
  }
  if (newRecipient) {
    correction.oldRecipient = letter.recipient;
    correction.newRecipient = newRecipient;
  }

  try {
    const userPrompt = buildMetadataUpdateUserPrompt({
      existingMetadata,
      existingEntities,
      correction,
    });

    const start = Date.now();

    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: 'system', content: METADATA_UPDATE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'metadata_v2_update',
          strict: true,
          schema: METADATA_V2_JSON_SCHEMA,
        },
      },
    });

    const duration = Date.now() - start;

    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'content_filter') {
      letterLog.warn({ duration }, 'AI metadata update refused by content filter, falling back to simple update');
      return simpleFieldUpdate(letter, newSender, newRecipient);
    }

    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      letterLog.warn({ duration }, 'No message in AI update response, falling back to simple update');
      return simpleFieldUpdate(letter, newSender, newRecipient);
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      letterLog.warn({ duration }, 'No text content in AI update response, falling back to simple update');
      return simpleFieldUpdate(letter, newSender, newRecipient);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch {
      letterLog.warn({ duration }, 'Failed to parse AI update response JSON, falling back to simple update');
      return simpleFieldUpdate(letter, newSender, newRecipient);
    }

    const validationResult = MetadataV2Schema.safeParse(parsed);
    if (!validationResult.success) {
      letterLog.warn(
        { duration, errors: validationResult.error.errors },
        'AI update response failed validation, falling back to simple update',
      );
      return simpleFieldUpdate(letter, newSender, newRecipient);
    }

    const updatedMetadata = validationResult.data;
    const usage = response.usage;

    letterLog.info(
      {
        duration,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
      },
      'AI metadata update completed',
    );

    // Fire-and-forget usage tracking
    logApiUsage({
      letterId,
      callType: 'metadata_update',
      model: env.OPENAI_MODEL,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      durationMs: duration,
    });

    // Apply the AI-updated metadata to the DB
    return applyMetadataUpdate(letter, updatedMetadata, newSender, newRecipient, 'ai');
  } catch (error) {
    letterLog.error({ err: error }, 'AI metadata update failed, falling back to simple update');
    return simpleFieldUpdate(letter, newSender, newRecipient);
  }
}

/**
 * Apply an AI-generated metadata update to the database.
 */
async function applyMetadataUpdate(
  letter: Letter,
  metadata: MetadataV2,
  newSender: string | undefined,
  newRecipient: string | undefined,
  method: 'ai' | 'simple',
): Promise<AiUpdateResult> {
  const dbUpdates: Record<string, unknown> = {
    updatedAt: new Date(),
    // V1 compatible fields
    sender: metadata.sender.name,
    recipient: metadata.recipient.name,
    locationWritten: metadata.location_written.name,
    hook: metadata.hook,
    summary: metadata.summary,
    extractedDate: metadata.extracted_date,
    extractedDateConfidence: metadata.extracted_date_confidence,
    tags: metadata.primary_topics,
    // V2 specific fields
    emotionalTone: metadata.emotional_tone,
    senderRecipientRelationship: metadata.sender_recipient_relationship,
    primaryTopics: metadata.primary_topics,
    aiNotes: metadata.ai_notes,
    // Full JSON
    metadataV2Json: metadata,
    metadataJson: metadata,
  };

  // Ensure the new sender/recipient values are set even if AI returned different names
  if (newSender !== undefined) {
    dbUpdates.sender = newSender;
  }
  if (newRecipient !== undefined) {
    dbUpdates.recipient = newRecipient;
  }

  await db.update(letters).set(dbUpdates).where(eq(letters.id, letter.id));

  const fieldsUpdated = ['metadataV2Json', 'summary', 'hook'];
  if (newSender) fieldsUpdated.push('sender');
  if (newRecipient) fieldsUpdated.push('recipient');

  const updatedLetter = await db.query.letters.findFirst({
    where: eq(letters.id, letter.id),
  });

  return {
    letter: updatedLetter!,
    method,
    fieldsUpdated,
  };
}

/**
 * Simple field update — no AI. Just set the sender/recipient fields.
 * Used as fallback when AI is unavailable or fails.
 */
async function simpleFieldUpdate(
  letter: Letter,
  newSender: string | undefined,
  newRecipient: string | undefined,
): Promise<AiUpdateResult> {
  const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
  const fieldsUpdated: string[] = [];

  if (newSender !== undefined) {
    dbUpdates.sender = newSender;
    fieldsUpdated.push('sender');
  }
  if (newRecipient !== undefined) {
    dbUpdates.recipient = newRecipient;
    fieldsUpdated.push('recipient');
  }

  // Also update metadataV2Json sender/recipient if it exists
  if (letter.metadataV2Json && typeof letter.metadataV2Json === 'object') {
    const metadata = { ...(letter.metadataV2Json as Record<string, unknown>) };

    if (newSender !== undefined) {
      const senderObj = metadata.sender as Record<string, unknown> | undefined;
      metadata.sender = { ...(senderObj || {}), name: newSender, confidence: 1.0 };
    }
    if (newRecipient !== undefined) {
      const recipientObj = metadata.recipient as Record<string, unknown> | undefined;
      metadata.recipient = { ...(recipientObj || {}), name: newRecipient, confidence: 1.0 };
    }

    dbUpdates.metadataV2Json = metadata;
    dbUpdates.metadataJson = metadata;
    fieldsUpdated.push('metadataV2Json');
  }

  await db.update(letters).set(dbUpdates).where(eq(letters.id, letter.id));

  const updatedLetter = await db.query.letters.findFirst({
    where: eq(letters.id, letter.id),
  });

  return {
    letter: updatedLetter!,
    method: 'simple',
    fieldsUpdated,
  };
}
