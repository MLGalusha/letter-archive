/**
 * Entity Resolution Schema
 *
 * Collection-level AI pass that sees ALL entities at once to resolve
 * identities, merge duplicates, clean up generics, fill missing
 * sender/recipient fields, and correct relationships.
 */

import { z } from 'zod';
import { PERSON_RELATIONSHIP_TYPES } from './entityExtraction.js';

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

export const MergeGroupSchema = z.object({
  keep_person_id: z.string(),
  merge_person_ids: z.array(z.string()),
  suggested_canonical_name: z.string(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type MergeGroup = z.infer<typeof MergeGroupSchema>;

export const GenericResolutionSchema = z.object({
  generic_person_id: z.string(),
  resolves_to_person_id: z.string().nullable(),
  action: z.enum(['merge', 'delete', 'keep']),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type GenericResolution = z.infer<typeof GenericResolutionSchema>;

export const SenderRecipientFillSchema = z.object({
  letter_id: z.string(),
  role: z.enum(['sender', 'recipient']),
  person_id: z.string(),
  name: z.string(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type SenderRecipientFill = z.infer<typeof SenderRecipientFillSchema>;

export const RelationshipCorrectionSchema = z.object({
  action: z.enum(['update_type', 'delete']),
  person_a_id: z.string(),
  person_b_id: z.string(),
  current_type: z.string(),
  corrected_type: z.string().nullable(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type RelationshipCorrection = z.infer<typeof RelationshipCorrectionSchema>;

// ============================================================================
// MAIN SCHEMA
// ============================================================================

export const EntityResolutionSchema = z.object({
  merge_groups: z.array(MergeGroupSchema),
  generic_resolutions: z.array(GenericResolutionSchema),
  sender_recipient_fills: z.array(SenderRecipientFillSchema),
  relationship_corrections: z.array(RelationshipCorrectionSchema),
  notes: z.string().nullable(),
});
export type EntityResolution = z.infer<typeof EntityResolutionSchema>;

// ============================================================================
// JSON SCHEMA FOR OPENAI STRICT MODE
// ============================================================================

export const ENTITY_RESOLUTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    merge_groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keep_person_id: { type: 'string' },
          merge_person_ids: { type: 'array', items: { type: 'string' } },
          suggested_canonical_name: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['keep_person_id', 'merge_person_ids', 'suggested_canonical_name', 'reasoning', 'confidence'],
        additionalProperties: false,
      },
    },
    generic_resolutions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          generic_person_id: { type: 'string' },
          resolves_to_person_id: { type: ['string', 'null'] },
          action: { type: 'string', enum: ['merge', 'delete', 'keep'] },
          reasoning: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['generic_person_id', 'resolves_to_person_id', 'action', 'reasoning', 'confidence'],
        additionalProperties: false,
      },
    },
    sender_recipient_fills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          letter_id: { type: 'string' },
          role: { type: 'string', enum: ['sender', 'recipient'] },
          person_id: { type: 'string' },
          name: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['letter_id', 'role', 'person_id', 'name', 'reasoning', 'confidence'],
        additionalProperties: false,
      },
    },
    relationship_corrections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['update_type', 'delete'] },
          person_a_id: { type: 'string' },
          person_b_id: { type: 'string' },
          current_type: { type: 'string' },
          corrected_type: { type: ['string', 'null'] },
          reasoning: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['action', 'person_a_id', 'person_b_id', 'current_type', 'corrected_type', 'reasoning', 'confidence'],
        additionalProperties: false,
      },
    },
    notes: { type: ['string', 'null'] },
  },
  required: ['merge_groups', 'generic_resolutions', 'sender_recipient_fills', 'relationship_corrections', 'notes'],
  additionalProperties: false,
} as const;
