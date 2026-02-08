import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { env, hasOpenAI } from '../config/env.js';
import {
  TRANSCRIPTION_SYSTEM_PROMPT,
  METADATA_SYSTEM_PROMPT,
  buildTranscriptionUserPrompt,
  buildMetadataUserPrompt,
} from './prompts.js';
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
