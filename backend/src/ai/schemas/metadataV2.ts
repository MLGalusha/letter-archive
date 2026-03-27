/**
 * Metadata V2 Schema
 *
 * Zod schema for structured metadata extraction using OpenAI's strict mode.
 * Following best practices:
 * - All fields required with nullable() for optional values
 * - Controlled vocabularies for enums
 * - Confidence scores for extracted values
 *
 * Note: Entity extraction (people/places) is handled by a separate prompt.
 * See entityExtraction.ts for that schema.
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
// AI NOTE SCHEMAS
// ============================================================================

/**
 * Note categories for structured AI observations
 */
export const NoteCategoryEnum = z.enum([
  'identity',
  'date',
  'transcription',
  'relationship',
  'context',
  'cross-reference',
  'location',
  'condition',
]);
export type NoteCategory = z.infer<typeof NoteCategoryEnum>;

/**
 * Note priority levels
 */
export const NotePriorityEnum = z.enum(['high', 'medium', 'low']);
export type NotePriority = z.infer<typeof NotePriorityEnum>;

/**
 * Auto-resolution trigger keys
 */
export const ResolvesWhenEnum = z.enum([
  'sender_filled',
  'recipient_filled',
  'date_confirmed',
  'date_conflict_resolved',
  'location_filled',
  'relationship_set',
  'transcription_edited',
]);
export type ResolvesWhen = z.infer<typeof ResolvesWhenEnum>;

/**
 * AI output schema for a single note (what the model returns)
 */
export const AiNoteOutputSchema = z.object({
  content: z.string(),
  category: NoteCategoryEnum,
  priority: NotePriorityEnum,
  resolves_when: ResolvesWhenEnum.nullable(),
});
export type AiNoteOutput = z.infer<typeof AiNoteOutputSchema>;

/**
 * Full structured note (after backend enrichment)
 */
export interface StructuredNote {
  id: string;
  content: string;
  category: NoteCategory;
  priority: NotePriority;
  status: 'open' | 'resolved' | 'dismissed';
  resolves_when: ResolvesWhen | null;
  resolved_at: string | null;
  resolved_by: string | null;
  source: 'ai' | 'admin';
}

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

  // AI observations and hunches for admin review (structured)
  ai_notes: z.array(AiNoteOutputSchema).nullable(),
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
    ai_notes: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          category: {
            type: 'string',
            enum: ['identity', 'date', 'transcription', 'relationship', 'context', 'cross-reference', 'location', 'condition'],
          },
          priority: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
          },
          resolves_when: {
            type: ['string', 'null'],
            enum: ['sender_filled', 'recipient_filled', 'date_confirmed', 'date_conflict_resolved', 'location_filled', 'relationship_set', 'transcription_edited', null],
          },
        },
        required: ['content', 'category', 'priority', 'resolves_when'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'sender',
    'recipient',
    'location_written',
    'extracted_date',
    'hook',
    'summary',
    'emotional_tone',
    'sender_recipient_relationship',
    'primary_topics',
    'notable_quotes',
    'ai_notes',
  ],
  additionalProperties: false,
} as const;
