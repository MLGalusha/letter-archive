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
// SPECIAL AREA ENUMS
// ============================================================================

export const SpecialAreaTypeEnum = z.enum(['continuation', 'addition']);
export type SpecialAreaType = z.infer<typeof SpecialAreaTypeEnum>;

export const SpecialAreaPositionEnum = z.enum([
  'top', 'bottom', 'left-margin', 'right-margin', 'corner', 'between-lines',
]);
export type SpecialAreaPosition = z.infer<typeof SpecialAreaPositionEnum>;

export const SpecialAreaOrientationEnum = z.enum([
  'normal', 'sideways-left', 'sideways-right', 'inverted',
]);
export type SpecialAreaOrientation = z.infer<typeof SpecialAreaOrientationEnum>;

// ============================================================================
// SPECIAL AREA SCHEMA
// ============================================================================

export const SpecialAreaSchema = z.object({
  id: z.number(),
  label: z.string(),
  type: SpecialAreaTypeEnum,
  position: SpecialAreaPositionEnum,
  orientation: SpecialAreaOrientationEnum,
  continuesFromLine: z.number().nullable(),
  readingOrder: z.number().nullable(),
});
export type SpecialArea = z.infer<typeof SpecialAreaSchema>;

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
  areaId: z.number().nullable().default(null),
});
export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

// ============================================================================
// PAGE SCHEMA
// ============================================================================

export const StructuredTranscriptPageSchema = z.object({
  pageNumber: z.number(),
  lines: z.array(TranscriptLineSchema),
  specialAreas: z.array(SpecialAreaSchema).default([]),
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
  specialAreas: z.array(SpecialAreaSchema),
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
      description: 'One entry per physical line of handwriting visible in the image.',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Exact transcription of this line. Use [illegible] for unreadable words. No leading spaces — use x for positioning.',
          },
          x: {
            type: 'number',
            description: 'Horizontal start position 0-999 (0=left edge, 999=right edge). Body text is typically 0-50.',
          },
          paragraph: {
            type: ['number', 'null'],
            description: 'Paragraph group number for body text. Increment on paragraph breaks. null for non-body lines.',
          },
          continues: {
            type: 'boolean',
            description: 'true only when the writer ran out of horizontal space and wrapped to the next physical line.',
          },
          role: {
            type: ['string', 'null'],
            description: 'Structural role of this line. Set to null when ambiguous.',
            enum: [
              'date', 'salutation', 'body', 'closing',
              'signature', 'postscript', 'margin-note', 'address',
              null,
            ],
          },
          areaId: {
            type: ['number', 'null'],
            description: 'ID of the special area this line belongs to. null for lines in the main flow.',
          },
        },
        required: ['text', 'x', 'paragraph', 'continues', 'role', 'areaId'],
        additionalProperties: false,
      },
    },
    specialAreas: {
      type: 'array',
      description: 'Text regions outside the normal vertical line flow (margins, corners, sideways writing). Empty array if none.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Sequential ID starting at 1.' },
          label: { type: 'string', description: 'Descriptive name (e.g., "Left margin note").' },
          type: {
            type: 'string',
            description: '"continuation" if writer ran out of room, "addition" if separate thought.',
            enum: ['continuation', 'addition'],
          },
          position: {
            type: 'string',
            description: 'Physical position on the page.',
            enum: ['top', 'bottom', 'left-margin', 'right-margin', 'corner', 'between-lines'],
          },
          orientation: {
            type: 'string',
            description: 'Text direction.',
            enum: ['normal', 'sideways-left', 'sideways-right', 'inverted'],
          },
          continuesFromLine: {
            type: ['number', 'null'],
            description: 'For continuation type: 0-based line index it continues from. null for addition type.',
          },
          readingOrder: {
            type: ['number', 'null'],
            description: 'Paragraph number this area appears near. null if unclear.',
          },
        },
        required: ['id', 'label', 'type', 'position', 'orientation', 'continuesFromLine', 'readingOrder'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines', 'specialAreas'],
  additionalProperties: false,
} as const;
