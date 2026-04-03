import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { env, hasOpenAI } from '../../config/env.js';
import {
  LEGACY_TRANSCRIPTION_SYSTEM_PROMPT,
  STRUCTURED_TRANSCRIPTION_SYSTEM_PROMPT,
  EXTRA_CONTENT_CHECK_SYSTEM_PROMPT,
  EXTRA_CONTENT_TRANSCRIPTION_SYSTEM_PROMPT,
  PHOTO_DESCRIPTION_SYSTEM_PROMPT,
  buildTranscriptionUserPrompt,
  buildStructuredTranscriptionUserPrompt,
  buildExtraContentCheckPrompt,
  buildExtraContentTranscriptionPrompt,
  buildPhotoDescriptionPrompt,
} from '../prompts.js';
import {
  TranscriptionOutputSchema,
  STRUCTURED_TRANSCRIPTION_JSON_SCHEMA,
  type TranscriptLine,
} from '../schemas/structuredTranscript.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../../utils/logger.js';
import { log, openai } from './client.js';
import { logApiUsage } from '../../services/usage-tracking.js';

/** Max width for images sent to OpenAI — keeps quality high for handwriting while reducing payload */
const AI_IMAGE_MAX_WIDTH = 2000;

/**
 * Load and resize an image for OpenAI vision calls.
 * Downscales to AI_IMAGE_MAX_WIDTH if wider, converts to JPEG for consistent compression.
 */
async function prepareImageForAI(filePath: string): Promise<{ base64: string; mimeType: string; sizeKb: number }> {
  const imageBuffer = await readFile(filePath);
  const metadata = await sharp(imageBuffer).metadata();
  const needsResize = metadata.width && metadata.width > AI_IMAGE_MAX_WIDTH;

  let outputBuffer: Buffer;
  if (needsResize) {
    outputBuffer = await sharp(imageBuffer)
      .resize({ width: AI_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } else {
    // Still re-encode to JPEG for consistent compression (unless already small)
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'png' || imageBuffer.length > 500_000) {
      outputBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } else {
      outputBuffer = imageBuffer;
    }
  }

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: 'image/jpeg',
    sizeKb: Math.round(outputBuffer.length / 1024),
  };
}

export interface TranscribeImageParams {
  filePath: string;
  letterId?: string;
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    pageNumber?: number;
    totalPages?: number;
  };
}

export interface TranscribeImageResult {
  text: string;
  structured: TranscriptLine[] | null;
  isStub: boolean;
}

/**
 * Derive flat text from structured lines for backward compatibility.
 * Uses spaces to approximate the original horizontal positioning.
 */
function structuredLinesToText(lines: TranscriptLine[]): string {
  const result: string[] = [];
  for (const line of lines) {
    if (line.text === '') {
      result.push('');
      continue;
    }
    // Convert x (0-999) to approximate leading spaces (0-60 range)
    const spaces = Math.round((line.x / 999) * 60);
    result.push(spaces > 0 ? ' '.repeat(spaces) + line.text : line.text);
  }
  return result.join('\n');
}

/**
 * Fallback: transcribe using legacy flat-text prompt.
 * Used when structured output fails.
 */
async function transcribeImageLegacy(
  params: TranscribeImageParams,
  preparedImage: { base64: string; mimeType: string },
  logContext: Record<string, unknown>,
): Promise<TranscribeImageResult> {
  log.warn(logContext, 'Falling back to legacy flat-text transcription');
  const start = Date.now();

  const response = await openai!.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: 'system', content: LEGACY_TRANSCRIPTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildTranscriptionUserPrompt(params.context) },
          {
            type: 'image_url',
            image_url: { url: `data:${preparedImage.mimeType};base64,${preparedImage.base64}` },
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
    { ...logContext, duration, textLength: text.length, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens },
    'Legacy fallback transcription completed',
  );

  logApiUsage({
    letterId: params.letterId,
    callType: 'transcription',
    model: env.OPENAI_MODEL,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    durationMs: duration,
  });

  return { text: text.replace(/^\n+|\n+$/g, ''), structured: null, isStub: false };
}

export async function transcribeImage(
  params: TranscribeImageParams,
): Promise<TranscribeImageResult> {
  const context = {
    letterId: params.letterId,
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

  log.debug(context, 'Starting structured image transcription');
  const start = Date.now();

  const preparedImage = await prepareImageForAI(params.filePath);
  log.debug({ ...context, imageSizeKb: preparedImage.sizeKb }, 'Image prepared for transcription');

  try {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        { role: 'system', content: STRUCTURED_TRANSCRIPTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: buildStructuredTranscriptionUserPrompt(params.context) },
            {
              type: 'input_image',
              image_url: `data:${preparedImage.mimeType};base64,${preparedImage.base64}`,
              detail: 'high',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'structured_transcription',
          strict: true,
          schema: STRUCTURED_TRANSCRIPTION_JSON_SCHEMA,
        },
      },
      max_output_tokens: 8192,
    });

    const duration = Date.now() - start;

    // Check for content filter refusal
    if (response.status === 'incomplete' && response.incomplete_details?.reason === 'content_filter') {
      log.warn({ ...context, duration }, 'Structured transcription refused by content filter');
      return transcribeImageLegacy(params, preparedImage, context);
    }

    // Extract structured output (same pattern as metadata.ts)
    const outputItem = response.output.find((item) => item.type === 'message');
    if (!outputItem || outputItem.type !== 'message') {
      log.error({ ...context, duration, output: response.output }, 'No message in structured transcription response');
      return transcribeImageLegacy(params, preparedImage, context);
    }

    const textContent = outputItem.content.find((c) => c.type === 'output_text');
    if (!textContent || textContent.type !== 'output_text') {
      log.error({ ...context, duration }, 'No text content in structured transcription response');
      return transcribeImageLegacy(params, preparedImage, context);
    }

    // Parse and validate JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(textContent.text);
    } catch (parseError) {
      log.error(
        { ...context, duration, text: textContent.text.substring(0, 500), err: parseError },
        'Failed to parse structured transcription JSON',
      );
      return transcribeImageLegacy(params, preparedImage, context);
    }

    const validated = TranscriptionOutputSchema.safeParse(parsed);
    if (!validated.success) {
      log.error(
        { ...context, duration, errors: validated.error.issues },
        'Structured transcription failed Zod validation',
      );
      return transcribeImageLegacy(params, preparedImage, context);
    }

    const lines = validated.data.lines;
    const flatText = structuredLinesToText(lines);

    // Log usage
    const usage = response.usage;
    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        lineCount: lines.length,
        textLength: flatText.length,
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      },
      'Structured transcription completed',
    );

    logIfSlow(log, 'OpenAI structured transcription', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    logApiUsage({
      letterId: params.letterId,
      callType: 'transcription',
      model: env.OPENAI_MODEL,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      durationMs: duration,
    });

    return { text: flatText, structured: lines, isStub: false };
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error, model: env.OPENAI_MODEL }, 'Structured transcription failed');

    // Try legacy fallback
    try {
      return await transcribeImageLegacy(params, preparedImage, context);
    } catch (fallbackError) {
      log.error({ ...context, err: fallbackError }, 'Legacy fallback also failed');
      throw error; // Throw original error
    }
  }
}

function generateStubTranscription(params: TranscribeImageParams): TranscribeImageResult {
  const stubLines: TranscriptLine[] = [
    { text: 'September 12, 1943', x: 500, paragraph: null, continues: false, role: 'date' },
    { text: '', x: 0, paragraph: null, continues: false, role: null },
    { text: 'Dear [recipient],', x: 0, paragraph: null, continues: false, role: 'salutation' },
    { text: '', x: 0, paragraph: null, continues: false, role: null },
    { text: 'I hope this letter finds you well.', x: 0, paragraph: 1, continues: false, role: 'body' },
    { text: '[illegible] the weather has been quite', x: 0, paragraph: 1, continues: false, role: 'body' },
    { text: 'pleasant this [unclear: week/month].', x: 0, paragraph: 1, continues: true, role: 'body' },
    { text: '', x: 0, paragraph: null, continues: false, role: null },
    { text: 'The family sends their regards, and', x: 0, paragraph: 2, continues: false, role: 'body' },
    { text: 'we look forward to hearing from you', x: 0, paragraph: 2, continues: true, role: 'body' },
    { text: 'soon.', x: 0, paragraph: 2, continues: true, role: 'body' },
    { text: '', x: 0, paragraph: null, continues: false, role: null },
    { text: 'With warm regards,', x: 300, paragraph: null, continues: false, role: 'closing' },
    { text: '[sender]', x: 350, paragraph: null, continues: false, role: 'signature' },
  ];

  const text = structuredLinesToText(stubLines);

  return { text, structured: stubLines, isStub: true };
}

export interface CheckExtraContentParams {
  filePath: string;
  letterId?: string;
  documentType?: string;
}

export interface CheckExtraContentResult {
  hasTranscribableText: boolean;
  reason: string;
  textType: 'telegram' | 'envelope' | 'note' | 'ephemera' | 'none';
  isStub: boolean;
}

export async function checkExtraContentForText(
  params: CheckExtraContentParams,
): Promise<CheckExtraContentResult> {
  const context = {
    letterId: params.letterId,
    filePath: params.filePath,
    documentType: params.documentType,
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub extra content check (no API key)');
    return {
      hasTranscribableText: true,
      reason: 'Stub mode - assuming transcribable',
      textType: 'note',
      isStub: true,
    };
  }

  log.debug(context, 'Checking extra content for transcribable text');
  const start = Date.now();

  try {
    const { base64, mimeType } = await prepareImageForAI(params.filePath);

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
              image_url: { url: `data:${mimeType};base64,${base64}` },
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

    const checkUsage = response.usage;

    log.info(
      {
        ...context,
        duration,
        hasText: result.hasTranscribableText,
        textType: result.textType,
      },
      'Extra content check completed',
    );

    // Fire-and-forget usage tracking
    logApiUsage({
      letterId: params.letterId,
      callType: 'extra_content_check',
      model: 'gpt-4o-mini',
      inputTokens: checkUsage?.prompt_tokens ?? 0,
      outputTokens: checkUsage?.completion_tokens ?? 0,
      durationMs: duration,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error }, 'Extra content check failed');
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
  letterId?: string;
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

export interface DescribePhotoParams {
  filePath: string;
  letterId?: string;
  context?: {
    collectionCode?: string;
    dateRaw?: string;
    photoNumber?: number;
    totalPhotos?: number;
    linkedLetterContext?: string;
    reviewerContext?: string | null;
  };
}

export interface DescribePhotoResult {
  text: string;
  isStub: boolean;
}

export async function transcribeExtraContent(
  params: TranscribeExtraContentParams,
): Promise<TranscribeExtraContentResult> {
  const context = {
    letterId: params.letterId,
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
    const { base64, mimeType, sizeKb } = await prepareImageForAI(params.filePath);

    log.debug({ ...context, imageSizeKb: sizeKb }, 'Image prepared for extra content transcription');

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
              image_url: { url: `data:${mimeType};base64,${base64}` },
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
      'Extra content transcription completed',
    );

    logIfSlow(log, 'OpenAI extra content transcription', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    // Fire-and-forget usage tracking
    logApiUsage({
      letterId: params.letterId,
      callType: 'extra_content_transcription',
      model: env.OPENAI_MODEL,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      durationMs: duration,
    });

    return {
      text: text.replace(/^\n+|\n+$/g, ''),
      isStub: false,
    };
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error }, 'Extra content transcription failed');
    throw error;
  }
}

export async function describePhoto(
  params: DescribePhotoParams,
): Promise<DescribePhotoResult> {
  const context = {
    letterId: params.letterId,
    filePath: params.filePath,
    collectionCode: params.context?.collectionCode,
    dateRaw: params.context?.dateRaw,
    photoNumber: params.context?.photoNumber,
    totalPhotos: params.context?.totalPhotos,
    hasLinkedLetterContext: Boolean(params.context?.linkedLetterContext?.trim()),
    hasReviewerContext: Boolean(params.context?.reviewerContext?.trim()),
  };

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub photo description (no API key)');
    const contextNotes = [
      params.context?.reviewerContext?.trim()
        ? `Reviewer context: ${params.context.reviewerContext.trim()}`
        : null,
      params.context?.linkedLetterContext?.trim()
        ? 'Linked letter context is available.'
        : null,
    ].filter(Boolean);

    return {
      text: `[STUB PHOTO DESCRIPTION]

A historical photograph or visual image from the archive. ${contextNotes.join(' ') || 'No additional context was supplied.'}

[This is placeholder text. Set OPENAI_API_KEY for a real photo description.]`,
      isStub: true,
    };
  }

  log.debug(context, 'Starting photo description');
  const start = Date.now();

  try {
    const { base64, mimeType, sizeKb } = await prepareImageForAI(params.filePath);

    log.debug({ ...context, imageSizeKb: sizeKb }, 'Image prepared for photo description');

    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: PHOTO_DESCRIPTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildPhotoDescriptionPrompt({
                collectionCode: params.context?.collectionCode,
                dateRaw: params.context?.dateRaw,
                photoNumber: params.context?.photoNumber,
                totalPhotos: params.context?.totalPhotos,
                linkedLetterContext: params.context?.linkedLetterContext,
                reviewerContext: params.context?.reviewerContext,
              }),
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      max_completion_tokens: 1024,
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
      'Photo description completed',
    );

    logIfSlow(log, 'OpenAI photo description', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    logApiUsage({
      letterId: params.letterId,
      callType: 'photo_description',
      model: env.OPENAI_MODEL,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      durationMs: duration,
    });

    return {
      text: text.replace(/^\n+|\n+$/g, ''),
      isStub: false,
    };
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error }, 'Photo description failed');
    throw error;
  }
}
