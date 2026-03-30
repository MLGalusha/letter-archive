/**
 * AI-Assisted Metadata Update Service
 *
 * When a sender/recipient name is changed, this service debounces for 2 minutes
 * then calls OpenAI to re-tag all «SENDER:...» and «RECIPIENT:...» references
 * in the metadata text fields with natural language using the corrected names.
 *
 * Falls back to simple field update in stub mode (no OPENAI_API_KEY).
 */

import { eq } from 'drizzle-orm';
import { db, letters, type Letter } from '../db/index.js';
import { env, hasOpenAI } from '../config/env.js';
import { openai } from '../ai/openai/client.js';
import {
  METADATA_UPDATE_SYSTEM_PROMPT,
  buildMetadataUpdateUserPrompt,
} from '../ai/prompts.js';
import { MetadataV2Schema, type MetadataV2 } from '../ai/schemas/metadataV2.js';
import { METADATA_V2_JSON_SCHEMA } from '../ai/schemas/metadataV2.js';
import { createLogger } from '../utils/logger.js';
import { logApiUsage } from './usage-tracking.js';

const log = createLogger({ module: 'metadata-update' });

const RETAG_DELAY_MS = 2 * 60 * 1000; // 2 minutes

// ============================================================================
// DEBOUNCE TIMER
// ============================================================================

interface PendingRetag {
  timer: ReturnType<typeof setTimeout>;
  senderName: string | null;
  recipientName: string | null;
  change: {
    field: 'sender' | 'recipient' | 'both';
    oldSender?: string | null;
    newSender?: string | null;
    oldRecipient?: string | null;
    newRecipient?: string | null;
  };
}

const pendingRetags = new Map<string, PendingRetag>();

/**
 * Schedule a debounced AI re-tag for a letter's metadata.
 * Resets the timer if called again within the delay window.
 */
export function scheduleMetadataRetag(params: {
  letterId: string;
  senderName: string | null;
  recipientName: string | null;
  change: PendingRetag['change'];
}): void {
  const { letterId } = params;

  // Clear existing timer for this letter
  const existing = pendingRetags.get(letterId);
  if (existing) {
    clearTimeout(existing.timer);
    // Merge changes: if previous was sender-only and now recipient, make it both
    if (existing.change.field !== params.change.field && params.change.field !== 'both') {
      params.change = {
        field: 'both',
        oldSender: existing.change.oldSender ?? params.change.oldSender,
        newSender: params.change.newSender ?? existing.change.newSender ?? params.senderName,
        oldRecipient: existing.change.oldRecipient ?? params.change.oldRecipient,
        newRecipient: params.change.newRecipient ?? existing.change.newRecipient ?? params.recipientName,
      };
    }
  }

  const timer = setTimeout(() => {
    pendingRetags.delete(letterId);
    void executeRetag(letterId).catch((err) => {
      log.error({ letterId, err }, 'Scheduled metadata re-tag failed');
    });
  }, RETAG_DELAY_MS);

  pendingRetags.set(letterId, {
    timer,
    senderName: params.senderName,
    recipientName: params.recipientName,
    change: params.change,
  });

  log.info({ letterId, delay: RETAG_DELAY_MS }, 'Metadata re-tag scheduled');
}

/** Check if a retag is pending for a letter (for testing/status) */
export function isRetagPending(letterId: string): boolean {
  return pendingRetags.has(letterId);
}

/** Cancel a pending retag (e.g., if letter is deleted) */
export function cancelPendingRetag(letterId: string): void {
  const existing = pendingRetags.get(letterId);
  if (existing) {
    clearTimeout(existing.timer);
    pendingRetags.delete(letterId);
    log.debug({ letterId }, 'Pending metadata re-tag cancelled');
  }
}

// ============================================================================
// AI RE-TAG EXECUTION
// ============================================================================

async function executeRetag(letterId: string): Promise<void> {
  const pending = pendingRetags.get(letterId);
  // May have been cancelled
  if (!pending) return;

  const letterLog = log.child({ letterId });
  letterLog.info('Executing scheduled metadata re-tag');

  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    letterLog.warn('Letter not found for re-tag, skipping');
    return;
  }

  if (!letter.metadataV2Json || !hasOpenAI || !openai) {
    letterLog.debug('Skipping AI re-tag (no metadata or no API key)');
    return;
  }

  const existingMetadata = letter.metadataV2Json as Record<string, unknown>;

  try {
    const userPrompt = buildMetadataUpdateUserPrompt({
      existingMetadata,
      senderName: letter.sender,
      recipientName: letter.recipient,
      change: pending.change,
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
      return;
    }

    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      letterLog.warn({ duration }, 'No message in AI re-tag response');
      return;
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      letterLog.warn({ duration }, 'No text content in AI re-tag response');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch {
      letterLog.warn({ duration }, 'Failed to parse AI re-tag response JSON');
      return;
    }

    const validationResult = MetadataV2Schema.safeParse(parsed);
    if (!validationResult.success) {
      letterLog.warn(
        { duration, errors: validationResult.error.errors },
        'AI re-tag response failed validation',
      );
      return;
    }

    const updatedMetadata = validationResult.data;
    const usage = response.usage;

    // Strip tags for display fields
    const stripTags = (text: string) =>
      text.replace(/«(?:SENDER|RECIPIENT):([^»]*)»/g, '$1');

    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
      hook: updatedMetadata.hook ? stripTags(updatedMetadata.hook) : updatedMetadata.hook,
      summary: updatedMetadata.summary ? stripTags(updatedMetadata.summary) : updatedMetadata.summary,
      metadataV2Json: updatedMetadata,
      metadataJson: updatedMetadata,
    };

    // Preserve the current sender/recipient names (don't let AI override them)
    dbUpdates.sender = letter.sender;
    dbUpdates.recipient = letter.recipient;

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
  } catch (error) {
    letterLog.error({ err: error }, 'AI metadata re-tag failed');
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
