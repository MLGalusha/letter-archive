/**
 * Metadata V2 Schema
 *
 * Zod schema for structured metadata extraction using OpenAI's strict mode.
 * Following best practices:
 * - All fields required with nullable() for optional values
 * - Controlled vocabularies for enums
 * - Confidence scores for entity extraction
 */

import { z } from 'zod';

// ============================================================================
// CONTROLLED VOCABULARIES
// ============================================================================

/**
 * Emotional tone - single value per letter
 */
export const EmotionalToneEnum = z.enum([
  'joyful',
  'hopeful',
  'neutral',
  'anxious',
  'sad',
  'angry',
  'desperate',
]);
export type EmotionalTone = z.infer<typeof EmotionalToneEnum>;

/**
 * Sender-recipient relationship categories
 */
export const RelationshipEnum = z.enum([
  'spouse',
  'fiancé/fiancée',
  'romantic-partner',
  'parent',
  'child',
  'sibling',
  'grandparent',
  'grandchild',
  'aunt/uncle',
  'nephew/niece',
  'cousin',
  'in-law',
  'friend',
  'acquaintance',
  'business-associate',
  'employer',
  'employee',
  'unknown',
]);
export type Relationship = z.infer<typeof RelationshipEnum>;

/**
 * Primary topics - fixed vocabulary for faceted search
 */
export const PRIMARY_TOPICS = [
  // Family & Relationships
  'family/marriage',
  'family/children',
  'family/death-grief',
  'family/separation',
  'family/reunion',
  // Health
  'health/illness',
  'health/recovery',
  'health/pregnancy-birth',
  // Work & Money
  'work/employment',
  'work/job-loss',
  'finances/hardship',
  'finances/prosperity',
  // Movement & Place
  'travel/journey',
  'travel/immigration',
  'home/moving',
  'home/property',
  // Communication
  'correspondence/news-sharing',
  'correspondence/advice',
  'correspondence/gratitude',
  'correspondence/apology',
  // Society & Events
  'war/service',
  'war/homefront',
  'religion/faith',
  'community/local-events',
  // Daily Life
  'daily-life/weather',
  'daily-life/farming',
  'daily-life/household',
  'daily-life/social',
] as const;

export const PrimaryTopicEnum = z.enum(PRIMARY_TOPICS);
export type PrimaryTopic = z.infer<typeof PrimaryTopicEnum>;

/**
 * Date extraction confidence
 */
export const DateConfidenceEnum = z.enum(['exact', 'inferred']);
export type DateConfidence = z.infer<typeof DateConfidenceEnum>;

/**
 * Entity types
 */
export const EntityTypeEnum = z.enum(['person', 'place']);
export type EntityType = z.infer<typeof EntityTypeEnum>;

/**
 * Person roles
 */
export const PersonRoleEnum = z.enum(['sender', 'recipient', 'mentioned']);
export type PersonRole = z.infer<typeof PersonRoleEnum>;

/**
 * Place roles
 */
export const PlaceRoleEnum = z.enum(['written_from', 'mentioned', 'destination']);
export type PlaceRole = z.infer<typeof PlaceRoleEnum>;

/**
 * Quote positions
 */
export const QuotePositionEnum = z.enum(['opening', 'middle', 'closing']);
export type QuotePosition = z.infer<typeof QuotePositionEnum>;

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

/**
 * Name with confidence (for sender, recipient, location)
 */
export const NameWithConfidenceSchema = z.object({
  name: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type NameWithConfidence = z.infer<typeof NameWithConfidenceSchema>;

/**
 * Notable quote from the letter
 */
export const NotableQuoteSchema = z.object({
  text: z.string(),
  context: z.string(),
  position: QuotePositionEnum,
});
export type NotableQuote = z.infer<typeof NotableQuoteSchema>;

/**
 * Extracted entity (person or place)
 */
export const ExtractedEntitySchema = z.object({
  type: EntityTypeEnum,
  name: z.string(),
  role: z.string(), // PersonRole or PlaceRole depending on type
  context: z.string(),
  relationship_to_sender: z.string().nullable(), // Only for people
  confidence: z.number().min(0).max(1),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

// ============================================================================
// MAIN SCHEMA
// ============================================================================

/**
 * Complete V2 metadata extraction schema
 *
 * All fields are required with nullable() for optional values.
 * This ensures the model always returns a complete, predictable structure.
 */
export const MetadataV2Schema = z.object({
  // Core identifiers
  sender: NameWithConfidenceSchema,
  recipient: NameWithConfidenceSchema,
  location_written: NameWithConfidenceSchema,

  // Date extraction
  extracted_date: z.string().nullable(), // ISO format YYYY-MM-DD or partial
  extracted_date_confidence: DateConfidenceEnum.nullable(),

  // Content teasers
  hook: z.string().nullable(), // 1-2 sentences, max 150 chars
  summary: z.string().nullable(), // Proportional to letter length

  // Emotional context
  emotional_tone: EmotionalToneEnum.nullable(),

  // Relationship between sender and recipient
  sender_recipient_relationship: RelationshipEnum.nullable(),

  // Topics (1-3 from fixed vocabulary)
  primary_topics: z.array(PrimaryTopicEnum),

  // Notable quotes (1-3)
  notable_quotes: z.array(NotableQuoteSchema),

  // Entities (people and places)
  entities: z.array(ExtractedEntitySchema),

  // AI observations and hunches for admin review
  ai_notes: z.string().nullable(),
});

export type MetadataV2 = z.infer<typeof MetadataV2Schema>;

// ============================================================================
// JSON SCHEMA FOR OPENAI
// ============================================================================

/**
 * Convert Zod schema to JSON Schema for OpenAI's structured outputs.
 *
 * Note: We manually construct this because zod-to-json-schema may not
 * produce the exact format OpenAI expects with strict mode.
 */
export const METADATA_V2_JSON_SCHEMA = {
  type: 'object',
  properties: {
    sender: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['name', 'confidence'],
      additionalProperties: false,
    },
    recipient: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['name', 'confidence'],
      additionalProperties: false,
    },
    location_written: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['name', 'confidence'],
      additionalProperties: false,
    },
    extracted_date: { type: ['string', 'null'] },
    extracted_date_confidence: {
      type: ['string', 'null'],
      enum: ['exact', 'inferred', null],
    },
    hook: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    emotional_tone: {
      type: ['string', 'null'],
      enum: ['joyful', 'hopeful', 'neutral', 'anxious', 'sad', 'angry', 'desperate', null],
    },
    sender_recipient_relationship: {
      type: ['string', 'null'],
      enum: [
        'spouse', 'fiancé/fiancée', 'romantic-partner',
        'parent', 'child', 'sibling',
        'grandparent', 'grandchild',
        'aunt/uncle', 'nephew/niece', 'cousin',
        'in-law', 'friend', 'acquaintance',
        'business-associate', 'employer', 'employee',
        'unknown', null
      ],
    },
    primary_topics: {
      type: 'array',
      items: {
        type: 'string',
        enum: PRIMARY_TOPICS,
      },
    },
    notable_quotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          context: { type: 'string' },
          position: { type: 'string', enum: ['opening', 'middle', 'closing'] },
        },
        required: ['text', 'context', 'position'],
        additionalProperties: false,
      },
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['person', 'place'] },
          name: { type: 'string' },
          role: { type: 'string' },
          context: { type: 'string' },
          relationship_to_sender: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['type', 'name', 'role', 'context', 'relationship_to_sender', 'confidence'],
        additionalProperties: false,
      },
    },
    ai_notes: { type: ['string', 'null'] },
  },
  required: [
    'sender',
    'recipient',
    'location_written',
    'extracted_date',
    'extracted_date_confidence',
    'hook',
    'summary',
    'emotional_tone',
    'sender_recipient_relationship',
    'primary_topics',
    'notable_quotes',
    'entities',
    'ai_notes',
  ],
  additionalProperties: false,
} as const;
