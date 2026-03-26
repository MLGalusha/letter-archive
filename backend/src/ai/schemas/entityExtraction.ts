/**
 * Entity Extraction Schema (Prompt 2)
 *
 * Rich entity extraction with detailed person/place profiles,
 * inter-entity relationships, and person-place connections.
 * Runs as a separate prompt after basic metadata extraction.
 */

import { z } from 'zod';

// ============================================================================
// CONTROLLED VOCABULARIES
// ============================================================================

export const PersonRoleEnum = z.enum(['sender', 'recipient', 'mentioned']);
export const PlaceRoleEnum = z.enum(['written_from', 'mentioned', 'destination']);
export const PlaceTypeEnum = z.enum(['city', 'region', 'country', 'street', 'landmark', 'other']);

/**
 * Bidirectional relationship types matching personRelationshipTypeEnum in schema.ts
 */
export const PERSON_RELATIONSHIP_TYPES = [
  'spouse',
  'fiancé/fiancée',
  'romantic-partner',
  'parent-child',
  'sibling',
  'grandparent-grandchild',
  'aunt-uncle-niece-nephew',
  'cousin',
  'in-law',
  'friend',
  'acquaintance',
  'business-associate',
  'employer-employee',
  'unknown',
] as const;

export const PersonRelationshipTypeEnum = z.enum(PERSON_RELATIONSHIP_TYPES);

/**
 * Connection types for person-to-place relationships
 */
export const PERSON_PLACE_CONNECTION_TYPES = [
  'lives_in',
  'works_at',
  'traveled_to',
  'traveled_from',
  'born_in',
  'visiting',
  'moved_to',
  'moved_from',
  'stationed_at',
  'associated_with',
] as const;

export const PersonPlaceConnectionTypeEnum = z.enum(PERSON_PLACE_CONNECTION_TYPES);

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

/**
 * Freeform life detail about a person
 */
export const PersonDetailSchema = z.object({
  detail: z.string(),
  category: z.string(), // occupation, age, health, location, education, personality, life_event, etc.
});
export type PersonDetail = z.infer<typeof PersonDetailSchema>;

/**
 * Quote/passage referencing a person
 */
export const PersonQuoteSchema = z.object({
  text: z.string(),
  context: z.string(),
});
export type PersonQuote = z.infer<typeof PersonQuoteSchema>;

/**
 * Rich person extraction
 */
export const ExtractedPersonSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  role: PersonRoleEnum,
  relationship_to_sender: z.string().nullable(),
  narrative: z.string().nullable().optional().default(null), // 1-3 sentence description of who this person is in this letter's context
  details: z.array(PersonDetailSchema),
  emotional_significance: z.string().nullable(),
  quotes: z.array(PersonQuoteSchema),
  confidence: z.number().min(0).max(1),
  isPlaceholder: z.boolean().optional().default(false),
  source: z.string().optional().default('letter'), // "letter", "telegram", "cover", "ephemera", "card", "multiple"
});
export type ExtractedPerson = z.infer<typeof ExtractedPersonSchema>;

/**
 * Rich place extraction
 */
export const ExtractedPlaceSchema = z.object({
  name: z.string(),
  type: PlaceTypeEnum,
  role: PlaceRoleEnum,
  narrative: z.string().nullable().optional().default(null), // 1-2 sentence description of the place's significance in this letter
  why_mentioned: z.string(),
  descriptive_details: z.string().nullable(),
  associated_people: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  isPlaceholder: z.boolean().optional().default(false),
  source: z.string().optional().default('letter'), // "letter", "telegram", "cover", "ephemera", "card", "multiple"
});
export type ExtractedPlace = z.infer<typeof ExtractedPlaceSchema>;

/**
 * Discovered person-to-person relationship
 */
export const DiscoveredRelationshipSchema = z.object({
  person_a: z.string(),
  person_b: z.string(),
  relationship_type: PersonRelationshipTypeEnum,
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
});
export type DiscoveredRelationship = z.infer<typeof DiscoveredRelationshipSchema>;

/**
 * Person-to-place connection
 */
export const PersonPlaceConnectionSchema = z.object({
  person_name: z.string(),
  place_name: z.string(),
  connection_type: PersonPlaceConnectionTypeEnum,
  evidence: z.string(),
});
export type PersonPlaceConnection = z.infer<typeof PersonPlaceConnectionSchema>;

// ============================================================================
// MAIN SCHEMA
// ============================================================================

/**
 * Complete entity extraction response schema
 */
export const EntityExtractionSchema = z.object({
  people: z.array(ExtractedPersonSchema),
  places: z.array(ExtractedPlaceSchema),
  relationships: z.array(DiscoveredRelationshipSchema),
  person_place_connections: z.array(PersonPlaceConnectionSchema),
});
export type EntityExtraction = z.infer<typeof EntityExtractionSchema>;

// ============================================================================
// JSON SCHEMA FOR OPENAI STRICT MODE
// ============================================================================

export const ENTITY_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          role: { type: 'string', enum: ['sender', 'recipient', 'mentioned'] },
          relationship_to_sender: { type: ['string', 'null'] },
          narrative: { type: ['string', 'null'] },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                detail: { type: 'string' },
                category: { type: 'string' },
              },
              required: ['detail', 'category'],
              additionalProperties: false,
            },
          },
          emotional_significance: { type: ['string', 'null'] },
          quotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                context: { type: 'string' },
              },
              required: ['text', 'context'],
              additionalProperties: false,
            },
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          isPlaceholder: { type: 'boolean' },
          source: { type: 'string' },
        },
        required: [
          'name', 'aliases', 'role', 'relationship_to_sender', 'narrative',
          'details', 'emotional_significance', 'quotes', 'confidence', 'isPlaceholder', 'source',
        ],
        additionalProperties: false,
      },
    },
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['city', 'region', 'country', 'street', 'landmark', 'other'] },
          role: { type: 'string', enum: ['written_from', 'mentioned', 'destination'] },
          narrative: { type: ['string', 'null'] },
          why_mentioned: { type: 'string' },
          descriptive_details: { type: ['string', 'null'] },
          associated_people: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          isPlaceholder: { type: 'boolean' },
          source: { type: 'string' },
        },
        required: [
          'name', 'type', 'role', 'narrative', 'why_mentioned',
          'descriptive_details', 'associated_people', 'confidence', 'isPlaceholder', 'source',
        ],
        additionalProperties: false,
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          person_a: { type: 'string' },
          person_b: { type: 'string' },
          relationship_type: {
            type: 'string',
            enum: PERSON_RELATIONSHIP_TYPES,
          },
          evidence: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['person_a', 'person_b', 'relationship_type', 'evidence', 'confidence'],
        additionalProperties: false,
      },
    },
    person_place_connections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          person_name: { type: 'string' },
          place_name: { type: 'string' },
          connection_type: {
            type: 'string',
            enum: PERSON_PLACE_CONNECTION_TYPES,
          },
          evidence: { type: 'string' },
        },
        required: ['person_name', 'place_name', 'connection_type', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['people', 'places', 'relationships', 'person_place_connections'],
  additionalProperties: false,
} as const;
