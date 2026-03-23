import { env, hasOpenAI } from '../../config/env.js';
import {
  ENTITY_RESOLUTION_SYSTEM_PROMPT,
  buildEntityResolutionUserPrompt,
} from '../prompts.js';
import {
  EntityResolutionSchema,
  ENTITY_RESOLUTION_JSON_SCHEMA,
  type EntityResolution,
} from '../schemas/entityResolution.js';
import type {
  CollectionPerson,
  CollectionLetterPersonJunction,
  CollectionRelationship,
  LetterMissingParticipant,
  GenericPerson,
} from '../../services/entities/collection-queries.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../../utils/logger.js';
import { log, openai } from './client.js';
import { logApiUsage } from '../../services/usage-tracking.js';

export interface ResolveCollectionEntitiesParams {
  persons: CollectionPerson[];
  junctions: CollectionLetterPersonJunction[];
  relationships: CollectionRelationship[];
  missingParticipants: LetterMissingParticipant[];
  genericPersons: GenericPerson[];
}

export interface ResolveCollectionEntitiesResult {
  resolution: EntityResolution;
  isStub: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function resolveCollectionEntitiesAI(
  params: ResolveCollectionEntitiesParams,
): Promise<ResolveCollectionEntitiesResult> {
  const context = {
    personCount: params.persons.length,
    junctionCount: params.junctions.length,
    relationshipCount: params.relationships.length,
    missingParticipantCount: params.missingParticipants.length,
    genericCount: params.genericPersons.length,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub entity resolution (no API key)');
    return generateStubResolution();
  }

  log.info(context, 'Starting collection entity resolution');
  const start = Date.now();

  try {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: 'system', content: ENTITY_RESOLUTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildEntityResolutionUserPrompt(params),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'entity_resolution',
          strict: true,
          schema: ENTITY_RESOLUTION_JSON_SCHEMA,
        },
      },
    });

    const duration = Date.now() - start;

    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'content_filter') {
      log.warn(
        { ...context, duration, reason: response.incomplete_details.reason },
        'Entity resolution refused by content filter',
      );
      throw new Error('Content refused by OpenAI safety filter');
    }

    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      log.error({ ...context, duration, output: response.output }, 'No message in entity resolution response');
      throw new Error('No message output from entity resolution');
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      log.error({ ...context, duration }, 'No text content in entity resolution response');
      throw new Error('No text content in entity resolution response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch (parseError) {
      log.error(
        { ...context, duration, text: textContent.text.substring(0, 500), err: parseError },
        'Failed to parse entity resolution JSON response',
      );
      throw new Error('Invalid JSON in entity resolution response');
    }

    const validationResult = EntityResolutionSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error(
        {
          ...context,
          duration,
          errors: validationResult.error.errors,
          parsed: JSON.stringify(parsed).substring(0, 500),
        },
        'Entity resolution failed Zod validation',
      );
      throw new Error('Entity resolution failed schema validation');
    }

    const resolution = validationResult.data;
    const usage = response.usage;

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
        mergeGroups: resolution.merge_groups.length,
        genericResolutions: resolution.generic_resolutions.length,
        senderRecipientFills: resolution.sender_recipient_fills.length,
        relationshipCorrections: resolution.relationship_corrections.length,
      },
      'Entity resolution completed',
    );

    logIfSlow(log, 'OpenAI entity resolution', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    // Fire-and-forget usage tracking
    logApiUsage({
      callType: 'entity_resolution',
      model: env.OPENAI_MODEL,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      durationMs: duration,
    });

    return {
      resolution,
      isStub: false,
      usage: usage
        ? {
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens,
          }
        : undefined,
    };
  } catch (error) {
    const duration = Date.now() - start;
    log.error(
      {
        ...context,
        duration,
        err: error,
        model: env.OPENAI_MODEL,
      },
      'Entity resolution failed',
    );
    throw error;
  }
}

function generateStubResolution(): ResolveCollectionEntitiesResult {
  return {
    resolution: {
      merge_groups: [],
      generic_resolutions: [],
      sender_recipient_fills: [],
      relationship_corrections: [],
      notes: '[STUB] Entity resolution not performed — no OpenAI API key configured.',
    },
    isStub: true,
  };
}
