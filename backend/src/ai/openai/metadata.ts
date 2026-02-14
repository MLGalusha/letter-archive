import { env, hasOpenAI } from '../../config/env.js';
import {
  METADATA_SYSTEM_PROMPT,
  METADATA_V2_SYSTEM_PROMPT,
  buildMetadataUserPrompt,
  buildMetadataV2UserPrompt,
} from '../prompts.js';
import {
  MetadataV2Schema,
  METADATA_V2_JSON_SCHEMA,
  type MetadataV2,
} from '../schemas/metadataV2.js';
import type { DateConfidence } from '../../db/schema.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../../utils/logger.js';
import { log, openai } from './client.js';

export interface ExtractMetadataParams {
  transcriptionText: string;
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    dateFromFilename?: string | null;
  };
}

export interface ExtractedMetadata {
  sender: string | null;
  recipient: string | null;
  locationWritten: string | null;
  hook: string | null;
  summary: string | null;
  tags: string[];
  extractedDate: string | null;
  extractedDateConfidence: DateConfidence | null;
}

export async function extractMetadata(
  params: ExtractMetadataParams,
): Promise<ExtractedMetadata> {
  const context = {
    collectionCode: params.context?.collectionCode,
    dateRaw: params.context?.dateRaw,
    transcriptLength: params.transcriptionText.length,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub metadata (no API key)');
    return generateStubMetadata(params);
  }

  log.debug(context, 'Starting metadata extraction');
  const start = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: METADATA_SYSTEM_PROMPT },
        { role: 'user', content: buildMetadataUserPrompt(params.transcriptionText, params.context) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1024,
    });

    const duration = Date.now() - start;
    const content = response.choices[0]?.message?.content;
    const usage = response.usage;

    if (!content) {
      log.error({ ...context, duration }, 'No response content from OpenAI for metadata extraction');
      throw new Error('No response from OpenAI for metadata extraction');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      log.error(
        { ...context, duration, content: content.substring(0, 500), err: parseError },
        'Failed to parse JSON response from OpenAI',
      );
      throw new Error('Invalid JSON response from OpenAI for metadata extraction');
    }

    const metadata: ExtractedMetadata = {
      sender: (parsed.sender as string) ?? null,
      recipient: (parsed.recipient as string) ?? null,
      locationWritten: (parsed.location_written as string) ?? null,
      hook: (parsed.hook as string) ?? null,
      summary: (parsed.summary as string) ?? null,
      tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : [],
      extractedDate: (parsed.extracted_date as string) ?? null,
      extractedDateConfidence: (parsed.extracted_date_confidence as DateConfidence) ?? null,
    };

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        fieldsExtracted: Object.values(metadata).filter(
          (v) => v !== null && (Array.isArray(v) ? v.length > 0 : true),
        ).length,
        tagsCount: metadata.tags.length,
      },
      'Metadata extraction completed',
    );

    logIfSlow(log, 'OpenAI metadata extraction', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return metadata;
  } catch (error) {
    const duration = Date.now() - start;
    if (!(error instanceof Error && error.message.includes('Invalid JSON'))) {
      log.error(
        {
          ...context,
          duration,
          err: error,
          model: env.OPENAI_MODEL,
        },
        'Metadata extraction failed',
      );
    }
    throw error;
  }
}

function generateStubMetadata(params: ExtractMetadataParams): ExtractedMetadata {
  const hasStubMarker = params.transcriptionText.includes('[STUB TRANSCRIPTION');

  return {
    sender: hasStubMarker ? 'Unknown (stub)' : null,
    recipient: hasStubMarker ? 'Unknown (stub)' : null,
    locationWritten: null,
    hook: hasStubMarker ? 'A placeholder letter awaits your review.' : null,
    summary: hasStubMarker
      ? '[STUB] This is placeholder metadata. Set OPENAI_API_KEY for real extraction.'
      : 'Unable to extract summary from transcription.',
    tags: hasStubMarker ? ['stub', 'placeholder'] : [],
    extractedDate: null,
    extractedDateConfidence: null,
  };
}

export interface ExtractMetadataV2Params {
  transcriptionText: string;
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    dateFromFilename?: string | null;
    extraContentTranscript?: string | null;
  };
}

export interface ExtractMetadataV2Result {
  metadata: MetadataV2;
  isStub: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function extractMetadataV2(
  params: ExtractMetadataV2Params,
): Promise<ExtractMetadataV2Result> {
  const context = {
    collectionCode: params.context?.collectionCode,
    dateRaw: params.context?.dateRaw,
    transcriptLength: params.transcriptionText.length,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub V2 metadata (no API key)');
    return generateStubMetadataV2(params);
  }

  log.debug(context, 'Starting V2 metadata extraction');
  const start = Date.now();

  try {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: 'system', content: METADATA_V2_SYSTEM_PROMPT },
        { role: 'user', content: buildMetadataV2UserPrompt(params.transcriptionText, params.context) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'metadata_v2',
          strict: true,
          schema: METADATA_V2_JSON_SCHEMA,
        },
      },
    });

    const duration = Date.now() - start;

    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'content_filter') {
      log.warn(
        { ...context, duration, reason: response.incomplete_details.reason },
        'V2 metadata extraction refused by content filter',
      );
      throw new Error('Content refused by OpenAI safety filter');
    }

    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      log.error({ ...context, duration, output: response.output }, 'No message in V2 response');
      throw new Error('No message output from V2 extraction');
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      log.error({ ...context, duration }, 'No text content in V2 response');
      throw new Error('No text content in V2 extraction response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch (parseError) {
      log.error(
        { ...context, duration, text: textContent.text.substring(0, 500), err: parseError },
        'Failed to parse V2 JSON response',
      );
      throw new Error('Invalid JSON in V2 extraction response');
    }

    const validationResult = MetadataV2Schema.safeParse(parsed);
    if (!validationResult.success) {
      log.error(
        {
          ...context,
          duration,
          errors: validationResult.error.errors,
          parsed: JSON.stringify(parsed).substring(0, 500),
        },
        'V2 metadata failed Zod validation',
      );
      throw new Error('V2 metadata failed schema validation');
    }

    const metadata = validationResult.data;
    const usage = response.usage;

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        promptTokens: usage?.input_tokens,
        completionTokens: usage?.output_tokens,
        totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
        emotionalTone: metadata.emotional_tone,
        relationship: metadata.sender_recipient_relationship,
        topicsCount: metadata.primary_topics.length,
        quotesCount: metadata.notable_quotes.length,
      },
      'V2 metadata extraction completed',
    );

    logIfSlow(log, 'OpenAI V2 metadata extraction', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return {
      metadata,
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
      'V2 metadata extraction failed',
    );
    throw error;
  }
}

function generateStubMetadataV2(params: ExtractMetadataV2Params): ExtractMetadataV2Result {
  const hasStubMarker = params.transcriptionText.includes('[STUB TRANSCRIPTION');

  return {
    metadata: {
      sender: { name: hasStubMarker ? 'Unknown (stub)' : null, confidence: 0 },
      recipient: { name: hasStubMarker ? 'Unknown (stub)' : null, confidence: 0 },
      location_written: { name: null, confidence: 0 },
      extracted_date: null,
      extracted_date_confidence: null,
      hook: hasStubMarker ? 'A placeholder letter awaits review.' : null,
      summary: hasStubMarker
        ? '[STUB] This is placeholder metadata. Set OPENAI_API_KEY for real extraction.'
        : null,
      emotional_tone: 'neutral',
      sender_recipient_relationship: 'unknown',
      primary_topics: [],
      notable_quotes: [],
      ai_notes: null,
    },
    isStub: true,
  };
}
