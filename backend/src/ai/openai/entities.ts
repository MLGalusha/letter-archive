import { env, hasOpenAI } from '../../config/env.js';
import {
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  buildEntityExtractionUserPrompt,
} from '../prompts.js';
import {
  EntityExtractionSchema,
  ENTITY_EXTRACTION_JSON_SCHEMA,
  type EntityExtraction,
} from '../schemas/entityExtraction.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../../utils/logger.js';
import { log, openai } from './client.js';

export interface ExtractEntitiesParams {
  transcriptionText: string;
  basicMetadata?: {
    sender?: string | null;
    recipient?: string | null;
    senderRecipientRelationship?: string | null;
    summary?: string | null;
  };
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    dateFromFilename?: string | null;
    extraContentTranscript?: string | null;
  };
}

export interface ExtractEntitiesResult {
  entities: EntityExtraction;
  isStub: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function extractEntities(
  params: ExtractEntitiesParams,
): Promise<ExtractEntitiesResult> {
  const context = {
    collectionCode: params.context?.collectionCode,
    dateRaw: params.context?.dateRaw,
    transcriptLength: params.transcriptionText.length,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub entity extraction (no API key)');
    return generateStubEntityExtraction();
  }

  log.debug(context, 'Starting entity extraction');
  const start = Date.now();

  try {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: 'system', content: ENTITY_EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildEntityExtractionUserPrompt(
            params.transcriptionText,
            params.basicMetadata,
            params.context,
          ),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'entity_extraction',
          strict: true,
          schema: ENTITY_EXTRACTION_JSON_SCHEMA,
        },
      },
    });

    const duration = Date.now() - start;

    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'content_filter') {
      log.warn(
        { ...context, duration, reason: response.incomplete_details.reason },
        'Entity extraction refused by content filter',
      );
      throw new Error('Content refused by OpenAI safety filter');
    }

    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      log.error({ ...context, duration, output: response.output }, 'No message in entity extraction response');
      throw new Error('No message output from entity extraction');
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      log.error({ ...context, duration }, 'No text content in entity extraction response');
      throw new Error('No text content in entity extraction response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch (parseError) {
      log.error(
        { ...context, duration, text: textContent.text.substring(0, 500), err: parseError },
        'Failed to parse entity extraction JSON response',
      );
      throw new Error('Invalid JSON in entity extraction response');
    }

    const validationResult = EntityExtractionSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error(
        {
          ...context,
          duration,
          errors: validationResult.error.errors,
          parsed: JSON.stringify(parsed).substring(0, 500),
        },
        'Entity extraction failed Zod validation',
      );
      throw new Error('Entity extraction failed schema validation');
    }

    const entities = validationResult.data;
    const usage = response.usage;

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
        peopleCount: entities.people.length,
        placesCount: entities.places.length,
        relationshipsCount: entities.relationships.length,
        connectionsCount: entities.person_place_connections.length,
      },
      'Entity extraction completed',
    );

    logIfSlow(log, 'OpenAI entity extraction', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return {
      entities,
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
      'Entity extraction failed',
    );
    throw error;
  }
}

function generateStubEntityExtraction(): ExtractEntitiesResult {
  return {
    entities: {
      people: [],
      places: [],
      relationships: [],
      person_place_connections: [],
    },
    isStub: true,
  };
}
