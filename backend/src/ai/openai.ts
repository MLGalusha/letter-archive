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

// Initialize OpenAI client only if API key is available
const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

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
  if (!hasOpenAI || !openai) {
    return generateStubTranscription(params);
  }

  // Read image and convert to base64
  const imageBuffer = await readFile(params.filePath);
  const base64Image = imageBuffer.toString('base64');

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

  const text = response.choices[0]?.message?.content ?? '';

  return {
    text: text.trim(),
    isStub: false,
  };
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
  if (!hasOpenAI || !openai) {
    return generateStubMetadata(params);
  }

  const response = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: 'system', content: METADATA_SYSTEM_PROMPT },
      { role: 'user', content: buildMetadataUserPrompt(params.transcriptionText, params.context) },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI for metadata extraction');
  }

  const parsed = JSON.parse(content);

  return {
    sender: parsed.sender ?? null,
    recipient: parsed.recipient ?? null,
    locationWritten: parsed.location_written ?? null,
    hook: parsed.hook ?? null,
    summary: parsed.summary ?? null,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    extractedDate: parsed.extracted_date ?? null,
    extractedDateConfidence: parsed.extracted_date_confidence ?? null,
  };
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
