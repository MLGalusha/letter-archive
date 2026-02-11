import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { env, hasOpenAI } from '../config/env.js';
import {
  TRANSCRIPTION_SYSTEM_PROMPT,
  METADATA_SYSTEM_PROMPT,
  METADATA_V2_SYSTEM_PROMPT,
  EXTRA_CONTENT_CHECK_SYSTEM_PROMPT,
  EXTRA_CONTENT_TRANSCRIPTION_SYSTEM_PROMPT,
  buildTranscriptionUserPrompt,
  buildMetadataUserPrompt,
  buildMetadataV2UserPrompt,
  buildExtraContentCheckPrompt,
  buildExtraContentTranscriptionPrompt,
} from './prompts.js';
import {
  MetadataV2Schema,
  METADATA_V2_JSON_SCHEMA,
  type MetadataV2,
} from './schemas/metadataV2.js';
import type { DateConfidence } from '../db/schema.js';
import { createLogger, logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const log = createLogger({ module: 'openai' });

// Initialize OpenAI client only if API key is available
const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

// Log OpenAI configuration on module load
log.info(
  { enabled: hasOpenAI, model: hasOpenAI ? env.OPENAI_MODEL : 'n/a' },
  hasOpenAI ? 'OpenAI client initialized' : 'OpenAI disabled - using stub mode'
);

// ============================================================================
// TYPES
// ============================================================================

export interface TranscribeImageParams {
  filePath: string;
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    pageNumber?: number;
    totalPages?: number;
  };
}

export interface TranscribeImageResult {
  text: string;
  isStub: boolean;
}

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

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * Transcribes an image using OpenAI's vision model.
 * Returns stub data if OPENAI_API_KEY is not set.
 */
export async function transcribeImage(
  params: TranscribeImageParams
): Promise<TranscribeImageResult> {
  const context = {
    filePath: params.filePath,
    collectionCode: params.context?.collectionCode,
    dateRaw: params.context?.dateRaw,
    pageNumber: params.context?.pageNumber,
    totalPages: params.context?.totalPages,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub transcription (no API key)');
    return generateStubTranscription(params);
  }

  log.debug(context, 'Starting image transcription');
  const start = Date.now();

  try {
    // Read image and convert to base64
    const imageBuffer = await readFile(params.filePath);
    const base64Image = imageBuffer.toString('base64');
    const imageSizeKb = Math.round(imageBuffer.length / 1024);

    log.debug({ ...context, imageSizeKb }, 'Image loaded for transcription');

    // Determine MIME type from file extension
    const ext = params.filePath.toLowerCase().split('.').pop();
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: TRANSCRIPTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildTranscriptionUserPrompt(params.context) },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      max_completion_tokens: 4096,
    });

    const duration = Date.now() - start;
    const text = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        textLength: text.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      },
      'Transcription completed'
    );

    logIfSlow(log, 'OpenAI transcription', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return {
      text: text.trim(),
      isStub: false,
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
      'Transcription failed'
    );
    throw error;
  }
}

function generateStubTranscription(params: TranscribeImageParams): TranscribeImageResult {
  const contextParts: string[] = [];
  if (params.context?.collectionCode) {
    contextParts.push(`Collection: ${params.context.collectionCode}`);
  }
  if (params.context?.dateRaw) {
    contextParts.push(`Date: ${params.context.dateRaw}`);
  }
  if (params.context?.pageNumber) {
    contextParts.push(`Page: ${params.context.pageNumber}`);
  }

  const contextStr = contextParts.length > 0 ? contextParts.join(', ') : 'No context provided';

  return {
    text: `[STUB TRANSCRIPTION - OpenAI API key not configured]

This is placeholder transcription text for development and testing purposes.

File: ${params.filePath}
Context: ${contextStr}

Dear [recipient],

I hope this letter finds you well. [illegible] the weather has been quite pleasant this [unclear: week/month].

The family sends their regards, and we look forward to hearing from you soon.

With warm regards,
[sender]

[Note: This is stub data. Set OPENAI_API_KEY for real transcription.]`,
    isStub: true,
  };
}

// ============================================================================
// METADATA EXTRACTION
// ============================================================================

/**
 * Extracts metadata from transcription text using OpenAI.
 * Returns stub data if OPENAI_API_KEY is not set.
 */
export async function extractMetadata(
  params: ExtractMetadataParams
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
        'Failed to parse JSON response from OpenAI'
      );
      throw new Error('Invalid JSON response from OpenAI for metadata extraction');
    }

    const metadata: ExtractedMetadata = {
      sender: parsed.sender as string ?? null,
      recipient: parsed.recipient as string ?? null,
      locationWritten: parsed.location_written as string ?? null,
      hook: parsed.hook as string ?? null,
      summary: parsed.summary as string ?? null,
      tags: Array.isArray(parsed.tags) ? parsed.tags as string[] : [],
      extractedDate: parsed.extracted_date as string ?? null,
      extractedDateConfidence: parsed.extracted_date_confidence as DateConfidence ?? null,
    };

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        fieldsExtracted: Object.values(metadata).filter((v) => v !== null && (Array.isArray(v) ? v.length > 0 : true)).length,
        tagsCount: metadata.tags.length,
      },
      'Metadata extraction completed'
    );

    logIfSlow(log, 'OpenAI metadata extraction', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return metadata;
  } catch (error) {
    const duration = Date.now() - start;
    // Only log if we haven't already logged a more specific error
    if (!(error instanceof Error && error.message.includes('Invalid JSON'))) {
      log.error(
        {
          ...context,
          duration,
          err: error,
          model: env.OPENAI_MODEL,
        },
        'Metadata extraction failed'
      );
    }
    throw error;
  }
}

function generateStubMetadata(params: ExtractMetadataParams): ExtractedMetadata {
  // Extract some basic info from stub transcription for demonstration
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

// ============================================================================
// V2 METADATA EXTRACTION (Responses API with Structured Outputs)
// ============================================================================

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

/**
 * V2 Metadata Extraction using OpenAI Responses API with Structured Outputs.
 *
 * Key improvements over V1:
 * - Uses Responses API (40-80% better cache utilization)
 * - Strict JSON Schema enforcement (no parsing errors)
 * - Temperature 0 for deterministic extraction
 * - Richer metadata: emotional tone, relationships, topics, entities
 * - Auto-retry on refusal (once, then flag for review)
 */
export async function extractMetadataV2(
  params: ExtractMetadataV2Params
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
    // Use Responses API with structured outputs
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

    // Handle refusals
    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'content_filter') {
      log.warn(
        { ...context, duration, reason: response.incomplete_details.reason },
        'V2 metadata extraction refused by content filter'
      );
      throw new Error('Content refused by OpenAI safety filter');
    }

    // Get the output text
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

    // Parse and validate with Zod
    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch (parseError) {
      log.error(
        { ...context, duration, text: textContent.text.substring(0, 500), err: parseError },
        'Failed to parse V2 JSON response'
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
        'V2 metadata failed Zod validation'
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
        entitiesCount: metadata.entities.length,
      },
      'V2 metadata extraction completed'
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
      'V2 metadata extraction failed'
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
      entities: [],
      ai_notes: null,
    },
    isStub: true,
  };
}

// ============================================================================
// EXTRA CONTENT TRANSCRIPTION (Telegrams, Covers, Ephemera)
// ============================================================================

export interface CheckExtraContentParams {
  filePath: string;
  documentType?: string;
}

export interface CheckExtraContentResult {
  hasTranscribableText: boolean;
  reason: string;
  textType: 'telegram' | 'envelope' | 'note' | 'ephemera' | 'none';
  isStub: boolean;
}

/**
 * Checks if an extra content image has transcribable text.
 * Uses GPT-4o-mini for quick, cheap check before full transcription.
 */
export async function checkExtraContentForText(
  params: CheckExtraContentParams
): Promise<CheckExtraContentResult> {
  const context = {
    filePath: params.filePath,
    documentType: params.documentType,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub extra content check (no API key)');
    return {
      hasTranscribableText: true, // Assume yes for stub mode
      reason: 'Stub mode - assuming transcribable',
      textType: 'note',
      isStub: true,
    };
  }

  log.debug(context, 'Checking extra content for transcribable text');
  const start = Date.now();

  try {
    // Read image and convert to base64
    const { readFile } = await import('node:fs/promises');
    const imageBuffer = await readFile(params.filePath);
    const base64Image = imageBuffer.toString('base64');

    // Determine MIME type from file extension
    const ext = params.filePath.toLowerCase().split('.').pop();
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    // Use GPT-4o-mini for quick check
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRA_CONTENT_CHECK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildExtraContentCheckPrompt({ documentType: params.documentType }) },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 256,
    });

    const duration = Date.now() - start;
    const content = response.choices[0]?.message?.content;

    if (!content) {
      log.warn({ ...context, duration }, 'No response from extra content check');
      return {
        hasTranscribableText: false,
        reason: 'No response from AI',
        textType: 'none',
        isStub: false,
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn({ ...context, duration, content: content.substring(0, 200) }, 'Failed to parse extra content check response');
      return {
        hasTranscribableText: false,
        reason: 'Failed to parse AI response',
        textType: 'none',
        isStub: false,
      };
    }

    const result: CheckExtraContentResult = {
      hasTranscribableText: Boolean(parsed.hasTranscribableText),
      reason: String(parsed.reason || ''),
      textType: (parsed.textType as CheckExtraContentResult['textType']) || 'none',
      isStub: false,
    };

    log.info(
      {
        ...context,
        duration,
        hasText: result.hasTranscribableText,
        textType: result.textType,
      },
      'Extra content check completed'
    );

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error }, 'Extra content check failed');
    // On error, assume there might be text to avoid skipping content
    return {
      hasTranscribableText: true,
      reason: 'Check failed, assuming transcribable',
      textType: 'note',
      isStub: false,
    };
  }
}

export interface TranscribeExtraContentParams {
  filePath: string;
  documentType?: string;
  context?: {
    collectionCode?: string;
    dateRaw?: string;
  };
}

export interface TranscribeExtraContentResult {
  text: string;
  isStub: boolean;
}

/**
 * Transcribes extra content (telegrams, covers, ephemera) from an image.
 */
export async function transcribeExtraContent(
  params: TranscribeExtraContentParams
): Promise<TranscribeExtraContentResult> {
  const context = {
    filePath: params.filePath,
    documentType: params.documentType,
    collectionCode: params.context?.collectionCode,
    dateRaw: params.context?.dateRaw,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub extra content transcription (no API key)');
    return {
      text: `[STUB EXTRA CONTENT TRANSCRIPTION]

Document type: ${params.documentType || 'Unknown'}
File: ${params.filePath}

[This is placeholder text. Set OPENAI_API_KEY for real transcription.]`,
      isStub: true,
    };
  }

  log.debug(context, 'Starting extra content transcription');
  const start = Date.now();

  try {
    // Read image and convert to base64
    const { readFile } = await import('node:fs/promises');
    const imageBuffer = await readFile(params.filePath);
    const base64Image = imageBuffer.toString('base64');
    const imageSizeKb = Math.round(imageBuffer.length / 1024);

    log.debug({ ...context, imageSizeKb }, 'Image loaded for extra content transcription');

    // Determine MIME type from file extension
    const ext = params.filePath.toLowerCase().split('.').pop();
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: EXTRA_CONTENT_TRANSCRIPTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildExtraContentTranscriptionPrompt({
                documentType: params.documentType,
                collectionCode: params.context?.collectionCode,
                dateRaw: params.context?.dateRaw,
              }),
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      max_completion_tokens: 2048,
    });

    const duration = Date.now() - start;
    const text = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        textLength: text.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
      },
      'Extra content transcription completed'
    );

    logIfSlow(log, 'OpenAI extra content transcription', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return {
      text: text.trim(),
      isStub: false,
    };
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error }, 'Extra content transcription failed');
    throw error;
  }
}
