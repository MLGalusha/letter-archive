/**
 * AI-Assisted Metadata Update Service
 *
 * When a sender/recipient name is changed, this service can immediately
 * re-tag all «SENDER:...» and «RECIPIENT:...» references in the metadata text
 * fields using the corrected names.
 */

import { eq } from 'drizzle-orm';
import { db, letters, type Letter } from '../db/index.js';
import { env, hasOpenAI } from '../config/env.js';
import { openai } from '../ai/openai/client.js';
import {
  METADATA_UPDATE_SYSTEM_PROMPT,
  buildMetadataUpdateUserPrompt,
} from '../ai/prompts.js';
import { MetadataV2Schema } from '../ai/schemas/metadataV2.js';
import { METADATA_V2_JSON_SCHEMA } from '../ai/schemas/metadataV2.js';
import { createLogger } from '../utils/logger.js';
import { logApiUsage } from './usage-tracking.js';

const log = createLogger({ module: 'metadata-update' });

// ============================================================================
// AI RE-TAG EXECUTION
// ============================================================================

export interface RetagChange {
  field: 'sender' | 'recipient' | 'both';
  oldSender?: string | null;
  newSender?: string | null;
  oldRecipient?: string | null;
  newRecipient?: string | null;
}

export interface ExecuteRetagResult {
  status: 'updated' | 'skipped' | 'noop';
  reason?: string;
}

function matchesRetagTarget(letter: Pick<Letter, 'sender' | 'recipient'>, change: RetagChange): boolean {
  if ((change.field === 'sender' || change.field === 'both') && letter.sender !== (change.newSender ?? null)) {
    return false;
  }

  if (
    (change.field === 'recipient' || change.field === 'both')
    && letter.recipient !== (change.newRecipient ?? null)
  ) {
    return false;
  }

  return true;
}

export async function executeRetagForLetter(
  letterId: string,
  change: RetagChange,
): Promise<ExecuteRetagResult> {

  const letterLog = log.child({ letterId });
  letterLog.info({ change }, 'Executing immediate metadata re-tag');

  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    letterLog.warn('Letter not found for re-tag, skipping');
    return { status: 'skipped', reason: 'missing_letter' };
  }

  if (!letter.metadataV2Json || !hasOpenAI || !openai) {
    letterLog.debug('Skipping AI re-tag (no metadata or no API key)');
    return {
      status: 'noop',
      reason: !letter.metadataV2Json ? 'missing_metadata' : 'openai_unavailable',
    };
  }

  if (!matchesRetagTarget(letter, change)) {
    letterLog.info({ change }, 'Skipping stale metadata re-tag before AI call');
    return { status: 'skipped', reason: 'stale_before_ai' };
  }

  const existingMetadata = letter.metadataV2Json as Record<string, unknown>;

  try {
    const userPrompt = buildMetadataUpdateUserPrompt({
      existingMetadata,
      senderName: letter.sender,
      recipientName: letter.recipient,
      change,
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

    if (response.status === 'incomplete') {
      letterLog.warn({ duration }, 'AI re-tag incomplete, skipping update');
      return { status: 'skipped', reason: 'incomplete_response' };
    }

    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      letterLog.warn({ duration }, 'No message in AI re-tag response');
      return { status: 'skipped', reason: 'missing_message' };
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      letterLog.warn({ duration }, 'No text content in AI re-tag response');
      return { status: 'skipped', reason: 'missing_text' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch {
      letterLog.warn({ duration }, 'Failed to parse AI re-tag response JSON');
      return { status: 'skipped', reason: 'invalid_json' };
    }

    const validationResult = MetadataV2Schema.safeParse(parsed);
    if (!validationResult.success) {
      letterLog.warn(
        { duration, errors: validationResult.error.errors },
        'AI re-tag response failed validation',
      );
      return { status: 'skipped', reason: 'validation_failed' };
    }

    const updatedMetadata = validationResult.data;
    const usage = response.usage;

    const latestLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
    });

    if (!latestLetter) {
      letterLog.warn({ duration }, 'Letter disappeared before metadata re-tag save');
      return { status: 'skipped', reason: 'missing_letter_before_save' };
    }

    if (!matchesRetagTarget(latestLetter, change)) {
      letterLog.info({ duration, change }, 'Skipping stale metadata re-tag before save');
      return { status: 'skipped', reason: 'stale_before_save' };
    }

    const finalMetadata = {
      ...updatedMetadata,
      sender: latestLetter.sender,
      recipient: latestLetter.recipient,
    };

    // Strip tags for display fields
    const stripTags = (text: string) =>
      text.replace(/«(?:SENDER|RECIPIENT):([^»]*)»/g, '$1');

    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
      hook: finalMetadata.hook ? stripTags(finalMetadata.hook) : finalMetadata.hook,
      summary: finalMetadata.summary ? stripTags(finalMetadata.summary) : finalMetadata.summary,
      metadataV2Json: finalMetadata,
      metadataJson: finalMetadata,
    };

    // Preserve the current sender/recipient names (don't let AI override them)
    dbUpdates.sender = latestLetter.sender;
    dbUpdates.recipient = latestLetter.recipient;

    await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

    letterLog.info(
      {
        duration,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
      },
      'Metadata re-tag completed',
    );

    logApiUsage({
      letterId,
      callType: 'metadata_retag',
      model: env.OPENAI_MODEL,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      durationMs: duration,
    });
    return { status: 'updated' };
  } catch (error) {
    letterLog.error({ err: error }, 'AI metadata re-tag failed');
    return { status: 'skipped', reason: 'request_failed' };
  }
}

// ============================================================================
// LEGACY EXPORTS (used by identity endpoint for immediate field updates)
// ============================================================================

export interface AiUpdateResult {
  letter: Letter;
  method: 'ai' | 'simple';
  fieldsUpdated: string[];
}

/**
 * Simple field update — no AI. Sets sender/recipient fields immediately
 * and updates the metadataV2Json name fields.
 */
export async function simpleFieldUpdate(
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

  // Update metadataV2Json sender/recipient fields
  if (letter.metadataV2Json && typeof letter.metadataV2Json === 'object') {
    const metadata = { ...(letter.metadataV2Json as Record<string, unknown>) };

    if (newSender !== undefined) {
      metadata.sender = newSender;
    }
    if (newRecipient !== undefined) {
      metadata.recipient = newRecipient;
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
