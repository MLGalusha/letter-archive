/**
 * Structured Transcript Schema
 *
 * Zod schema and JSON Schema for structured transcription using OpenAI's
 * strict mode. Each line of handwriting gets semantic annotations:
 * text, horizontal position, paragraph grouping, continuation flag, and role.
 *
 * Following the same pattern as metadataV2.ts:
 * - All fields required with nullable() for optional values
 * - Controlled vocabulary enums
 * - Manual JSON Schema for OpenAI strict mode
 */

import { z } from 'zod';

// ============================================================================
// CONTROLLED VOCABULARIES
// ============================================================================

/**
 * Structural role of a transcribed line within the letter.
 */
export const TranscriptLineRoleEnum = z.enum([
  'date',
  'salutation',
  'body',
  'closing',
  'signature',
  'postscript',
  'margin-note',
  'address',
]);
export type TranscriptLineRole = z.infer<typeof TranscriptLineRoleEnum>;

// ============================================================================
// LINE SCHEMA
// ============================================================================

/**
 * A single transcribed line from the letter image.
 */
export const TranscriptLineSchema = z.object({
  text: z.string(),
  x: z.number(),
  paragraph: z.number().nullable(),
  continues: z.boolean(),
  role: TranscriptLineRoleEnum.nullable(),
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

// ============================================================================
// PAGE SCHEMA
// ============================================================================

export const StructuredTranscriptPageSchema = z.object({
  pageNumber: z.number(),
  lines: z.array(TranscriptLineSchema),
});
export type StructuredTranscriptPage = z.infer<typeof StructuredTranscriptPageSchema>;

// ============================================================================
// TOP-LEVEL SCHEMA (stored in DB, returned by API)
// ============================================================================

export const StructuredTranscriptSchema = z.object({
  pages: z.array(StructuredTranscriptPageSchema),
});
export type StructuredTranscript = z.infer<typeof StructuredTranscriptSchema>;

// ============================================================================
// PER-PAGE SCHEMA (what OpenAI returns for a single page)
// ============================================================================

export const TranscriptionOutputSchema = z.object({
  lines: z.array(TranscriptLineSchema),
});
export type TranscriptionOutput = z.infer<typeof TranscriptionOutputSchema>;

// ============================================================================
// JSON SCHEMA FOR OPENAI (per-page output)
// ============================================================================

/**
 * Manual JSON Schema for OpenAI's strict mode.
 * This is the per-page schema — each page transcription returns { lines: [...] }.
 */
export const STRUCTURED_TRANSCRIPTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          x: { type: 'number' },
          paragraph: { type: ['number', 'null'] },
          continues: { type: 'boolean' },
          role: {
            type: ['string', 'null'],
            enum: [
              'date', 'salutation', 'body', 'closing',
              'signature', 'postscript', 'margin-note', 'address',
              null,
            ],
          },
        },
        required: ['text', 'x', 'paragraph', 'continues', 'role'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;
