import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { env, hasOpenAI } from '../../config/env.js';
import {
  TRANSCRIPTION_SYSTEM_PROMPT,
  EXTRA_CONTENT_CHECK_SYSTEM_PROMPT,
  EXTRA_CONTENT_TRANSCRIPTION_SYSTEM_PROMPT,
  PHOTO_DESCRIPTION_SYSTEM_PROMPT,
  buildTranscriptionUserPrompt,
  buildExtraContentCheckPrompt,
  buildExtraContentTranscriptionPrompt,
  buildPhotoDescriptionPrompt,
} from '../prompts.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../../utils/logger.js';
import { log, openai } from './client.js';
import { logApiUsage } from '../../services/usage-tracking.js';
import { notifyApiError } from '../../services/notifications.js';
import { DEVELOPMENT_STUB_TRANSCRIPTION_TEXT } from './transcription-stub.js';

/** Max width for images sent to OpenAI — preserve fine handwriting detail while keeping payloads bounded */
const AI_IMAGE_MAX_WIDTH = 4000;
const AI_JPEG_QUALITY = 95;
const AI_IMAGE_DETAIL: 'high' = 'high';

type PreparedAIImage = {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  sizeKb: number;
};

/**
 * Load and resize an image for OpenAI vision calls.
 * Preserves PNGs losslessly and avoids unnecessary recompression of already-good inputs.
 */
async function prepareImageForAI(filePath: string): Promise<PreparedAIImage> {
  const imageBuffer = await readFile(filePath);
  const metadata = await sharp(imageBuffer).metadata();
  const needsResize = metadata.width && metadata.width > AI_IMAGE_MAX_WIDTH;
  const ext = filePath.toLowerCase().split('.').pop();
  const isPng = ext === 'png' || metadata.format === 'png';
  const canKeepOriginalJpeg = !needsResize && (ext === 'jpg' || ext === 'jpeg' || metadata.format === 'jpeg');

  if (canKeepOriginalJpeg) {
    return {
      base64: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg',
      sizeKb: Math.round(imageBuffer.length / 1024),
    };
  }

  let outputBuffer: Buffer;
  let mimeType: PreparedAIImage['mimeType'];

  if (isPng) {
    outputBuffer = await sharp(imageBuffer)
      .resize({ width: AI_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    mimeType = 'image/png';
  } else {
    outputBuffer = await sharp(imageBuffer)
      .resize({ width: AI_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: AI_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    mimeType = 'image/jpeg';
  }

  return {
    base64: outputBuffer.toString('base64'),
    mimeType,
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
  isStub: boolean;
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
    return generateStubTranscription();
  }

  log.debug(context, 'Starting image transcription');
  const start = Date.now();

  const preparedImage = await prepareImageForAI(params.filePath);
  log.debug({ ...context, imageSizeKb: preparedImage.sizeKb }, 'Image prepared for transcription');

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
            image_url: {
              url: `data:${preparedImage.mimeType};base64,${preparedImage.base64}`,
              detail: AI_IMAGE_DETAIL,
            },
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
    { ...context, duration, textLength: text.length, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens },
    'Transcription completed',
  );

  logIfSlow(log, 'OpenAI transcription', duration, TIMING_THRESHOLDS.OPENAI_API, context);

  logApiUsage({
    letterId: params.letterId,
    callType: 'transcription',
    model: env.OPENAI_MODEL,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    durationMs: duration,
  });

  return { text: text.replace(/^\n+|\n+$/g, ''), isStub: false };
}

function generateStubTranscription(): TranscribeImageResult {
  return { text: DEVELOPMENT_STUB_TRANSCRIPTION_TEXT, isStub: true };
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
              image_url: { url: `data:${mimeType};base64,${base64}`, detail: AI_IMAGE_DETAIL },
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
    notifyApiError({
      service: 'openai',
      endpoint: 'extra_content_check',
      error,
      letterId: params.letterId,
    });
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
              image_url: { url: `data:${mimeType};base64,${base64}`, detail: AI_IMAGE_DETAIL },
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
    notifyApiError({
      service: 'openai',
      endpoint: 'extra_content_transcription',
      error,
      letterId: params.letterId,
    });
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
              image_url: { url: `data:${mimeType};base64,${base64}`, detail: AI_IMAGE_DETAIL },
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
    notifyApiError({
      service: 'openai',
      endpoint: 'photo_description',
      error,
      letterId: params.letterId,
    });
    throw error;
  }
}
