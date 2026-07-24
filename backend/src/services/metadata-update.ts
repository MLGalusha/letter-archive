/**
 * AI-Assisted Metadata Update Service
 *
 * When a sender/recipient name is changed, this service can immediately
 * re-tag all «SENDER:...» and «RECIPIENT:...» references in the metadata text
 * fields using the corrected names.
 */

import { and, eq } from 'drizzle-orm';
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
import {
  deepApplyVariants,
  generateNameVariants,
  getOtherPeopleFirstNames,
  parseNameComponents,
  propagateInEntityExtraction,
  propagateInMetadataV2,
} from './name-propagation.js';
import {
  buildHumanMetadataJobPatch,
  observedMetadataRevisionConditions,
} from './letter/metadata-job.js';

const log = createLogger({ module: 'metadata-update' });

// ============================================================================
// AI RE-TAG EXECUTION
// ============================================================================

export interface RetagChange {
  primarySourceRevision: number;
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

function normalizeRetaggedMetadata(
  metadata: Record<string, unknown>,
  letter: Pick<Letter, 'sender' | 'recipient' | 'entityExtractionJson'>,
  change: RetagChange,
): Record<string, unknown> {
  let result: Record<string, unknown> = {
    ...metadata,
    sender: letter.sender,
    recipient: letter.recipient,
  };

  const entityJson = letter.entityExtractionJson as Record<string, unknown> | null;

  const applyRoleCleanup = (
    field: 'sender' | 'recipient',
    oldName: string | null | undefined,
    newName: string | null | undefined,
  ) => {
    if (!newName) {
      result = { ...result, [field]: newName };
      return;
    }

    const variants = oldName
      ? generateNameVariants(parseNameComponents(oldName), oldName)
      : [];
    const collisionNames = oldName
      ? getOtherPeopleFirstNames(entityJson, oldName, field)
      : new Set<string>();

    result = propagateInMetadataV2(result, field, variants, newName, collisionNames);
  };

  if (change.field === 'sender' || change.field === 'both') {
    applyRoleCleanup('sender', change.oldSender, letter.sender);
  }

  if (change.field === 'recipient' || change.field === 'both') {
    applyRoleCleanup('recipient', change.oldRecipient, letter.recipient);
  }

  return result;
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

  if (letter.primarySourceRevision !== change.primarySourceRevision) {
    letterLog.info({ change }, 'Skipping metadata re-tag for a replaced page source');
    return { status: 'skipped', reason: 'source_changed_before_ai' };
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
  let receivedAiResponse = false;

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
    receivedAiResponse = true;

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

    if (latestLetter.primarySourceRevision !== change.primarySourceRevision) {
      letterLog.info({ duration, change }, 'Skipping metadata re-tag after page source replacement');
      return { status: 'skipped', reason: 'source_changed_before_save' };
    }

    if (!matchesRetagTarget(latestLetter, change)) {
      letterLog.info({ duration, change }, 'Skipping stale metadata re-tag before save');
      return { status: 'skipped', reason: 'stale_before_save' };
    }

    const normalizedMetadata = normalizeRetaggedMetadata(
      updatedMetadata as Record<string, unknown>,
      latestLetter,
      change,
    );

    const normalizedValidation = MetadataV2Schema.safeParse(normalizedMetadata);
    if (!normalizedValidation.success) {
      letterLog.warn(
        { duration, errors: normalizedValidation.error.errors },
        'Normalized AI re-tag response failed validation',
      );
      return { status: 'skipped', reason: 'validation_failed' };
    }

    const finalMetadata = normalizedValidation.data;

    // Strip tags for display fields
    const stripTags = (text: string) =>
      text.replace(/«(?:SENDER|RECIPIENT):([^»]*)»/g, '$1');

    const dbUpdates: Record<string, unknown> = {
      ...buildHumanMetadataJobPatch(),
      updatedAt: new Date(),
      hook: finalMetadata.hook ? stripTags(finalMetadata.hook) : finalMetadata.hook,
      summary: finalMetadata.summary ? stripTags(finalMetadata.summary) : finalMetadata.summary,
      metadataV2Json: finalMetadata,
      metadataJson: finalMetadata,
    };

    // Preserve the current sender/recipient names (don't let AI override them)
    dbUpdates.sender = latestLetter.sender;
    dbUpdates.recipient = latestLetter.recipient;

    // Propagate name changes to entity extraction JSON and AI notes
    const propagateForRole = (
      field: 'sender' | 'recipient',
      oldName: string | null | undefined,
      newName: string | null | undefined,
    ) => {
      if (!newName || !oldName) return;
      const variants = generateNameVariants(parseNameComponents(oldName), oldName);
      const entityJson = (dbUpdates.entityExtractionJson ?? latestLetter.entityExtractionJson) as Record<string, unknown> | null;
      const collisionNames = getOtherPeopleFirstNames(entityJson, oldName, field);

      if (entityJson && typeof entityJson === 'object') {
        dbUpdates.entityExtractionJson = propagateInEntityExtraction(
          entityJson, oldName, newName, field, variants, collisionNames,
        );
      }

      const currentNotes = (dbUpdates.aiNotes ?? latestLetter.aiNotes) as unknown;
      if (currentNotes && Array.isArray(currentNotes)) {
        dbUpdates.aiNotes = deepApplyVariants(currentNotes, variants, newName, collisionNames);
      }
    };

    if (change.field === 'sender' || change.field === 'both') {
      propagateForRole('sender', change.oldSender, latestLetter.sender);
    }
    if (change.field === 'recipient' || change.field === 'both') {
      propagateForRole('recipient', change.oldRecipient, latestLetter.recipient);
    }

    const saved = await db
      .update(letters)
      .set(dbUpdates)
      .where(and(
        ...observedMetadataRevisionConditions(letterId, latestLetter),
        eq(letters.primarySourceRevision, change.primarySourceRevision),
      ))
      .returning({ id: letters.id });
    if (saved.length === 0) {
      letterLog.info({ duration }, 'Skipping metadata re-tag because its revision changed');
      return { status: 'skipped', reason: 'revision_changed_before_save' };
    }

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
    if (receivedAiResponse) {
      letterLog.error({ err: error }, 'Metadata re-tag persistence failed');
      throw error;
    }

    letterLog.error({ err: error }, 'AI metadata re-tag request failed');
    return { status: 'skipped', reason: 'request_failed' };
  }
}
