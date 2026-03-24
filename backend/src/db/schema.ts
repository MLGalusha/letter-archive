import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  date,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================================
// ENUMS
// ============================================================================

export const letterTypeEnum = pgEnum('letter_type', ['L', 'P', 'E', 'V', 'A', 'D', 'C', 'N', 'T']);

export const workflowStateEnum = pgEnum('workflow_state', [
  'UPLOADED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'METADATA_EXTRACTING',
  'METADATA_DRAFTED',
  'REVIEWED',
]);

export const visibilityStateEnum = pgEnum('visibility_state', [
  'PUBLISHED',
  'HIDDEN',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
]);

export const dateConfidenceEnum = pgEnum('date_confidence', [
  'exact',
  'unknown',
  'inferred',
]);

// Emotional tone for V2 metadata
export const emotionalToneEnum = pgEnum('emotional_tone', [
  'joyful',
  'hopeful',
  'neutral',
  'anxious',
  'sad',
  'angry',
  'desperate',
]);

// Sender-recipient relationship for V2 metadata
export const relationshipEnum = pgEnum('relationship_type', [
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

// Content status for transcript and metadata (two-track workflow system)
export const contentStatusEnum = pgEnum('content_status', [
  'EMPTY',      // No content yet
  'AI_DRAFT',   // AI generated, human hasn't touched
  'EDITED',     // Human has edited
  'VERIFIED',   // Human explicitly marked as done
]);

// ============================================================================
// ENTITY ENUMS
// ============================================================================

export const personRoleEnum = pgEnum('person_role', ['sender', 'recipient', 'mentioned']);

export const placeRoleEnum = pgEnum('place_role', ['written_from', 'mentioned', 'destination']);

export const placeTypeEnum = pgEnum('place_type', ['city', 'region', 'country', 'street', 'landmark', 'other']);

export const entityReviewStatusEnum = pgEnum('entity_review_status', [
  'pending',
  'confirmed',
  'rejected',
  'new_entity',
]);

// Person-to-person relationship types (for relationship graph)
export const personRelationshipTypeEnum = pgEnum('person_relationship_type', [
  'spouse',
  'fiancé/fiancée',
  'romantic-partner',
  'parent-child',       // Bidirectional: covers parent↔child
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
]);

// ============================================================================
// TABLES
// ============================================================================

// Collections table
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionCode: text('collection_code').notNull().unique(),
  title: text('title'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Letters table
export const letters = pgTable(
  'letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'restrict' }),

    // Filename-derived identity
    dateRaw: text('date_raw').notNull(),
    letterDate: date('letter_date'),
    dateConfidence: dateConfidenceEnum('date_confidence').notNull().default('unknown'),
    type: letterTypeEnum('type').notNull(),
    typeSequence: integer('type_sequence').notNull(),

    // Pipeline + visibility (legacy workflow kept for backward compat)
    workflow: workflowStateEnum('workflow').notNull().default('UPLOADED'),
    visibility: visibilityStateEnum('visibility').notNull().default('HIDDEN'),

    // Two-track content status system (replaces workflow)
    transcriptStatus: contentStatusEnum('transcript_status').notNull().default('EMPTY'),
    metadataContentStatus: contentStatusEnum('metadata_content_status').notNull().default('EMPTY'),
    transcriptVerifiedAt: timestamp('transcript_verified_at', { withTimezone: true }),
    transcriptVerifiedBy: text('transcript_verified_by'),
    metadataVerifiedAt: timestamp('metadata_verified_at', { withTimezone: true }),
    metadataVerifiedBy: text('metadata_verified_by'),

    // Transcription fields
    transcriptionStatus: jobStatusEnum('transcription_status').notNull().default('PENDING'),
    transcriptionText: text('transcription_text'),
    transcriptionError: text('transcription_error'),
    transcriptionAttemptCount: integer('transcription_attempt_count').notNull().default(0),
    transcribedAt: timestamp('transcribed_at', { withTimezone: true }),

    // Metadata fields (filterable)
    sender: text('sender'),
    recipient: text('recipient'),
    locationWritten: text('location_written'),
    extractedDate: date('extracted_date'),
    extractedDateConfidence: dateConfidenceEnum('extracted_date_confidence'),
    hook: text('hook'),
    summary: text('summary'),
    tags: text('tags').array(),
    metadataJson: jsonb('metadata_json'),
    metadataStatus: jobStatusEnum('metadata_status').notNull().default('PENDING'),
    metadataError: text('metadata_error'),
    metadataAttemptCount: integer('metadata_attempt_count').notNull().default(0),

    // V2 Metadata fields
    emotionalTone: emotionalToneEnum('emotional_tone'),
    senderRecipientRelationship: relationshipEnum('sender_recipient_relationship'),
    primaryTopics: text('primary_topics').array(),
    // V2 extraction stores full structured output
    metadataV2Json: jsonb('metadata_v2_json'),

    // Entity extraction (Prompt 2 - separate from basic metadata)
    entityExtractionJson: jsonb('entity_extraction_json'),
    entityExtractionStatus: jobStatusEnum('entity_extraction_status').notNull().default('PENDING'),
    entityExtractionError: text('entity_extraction_error'),

    // Transcript confirmation (gates metadata extraction)
    transcriptConfirmedAt: timestamp('transcript_confirmed_at', { withTimezone: true }),
    transcriptConfirmedBy: text('transcript_confirmed_by'),

    // Extra content transcription (telegrams, covers, ephemera)
    extraContentTranscript: text('extra_content_transcript'),
    extraContentStatus: contentStatusEnum('extra_content_status').notNull().default('EMPTY'),
    extraContentVerifiedAt: timestamp('extra_content_verified_at', { withTimezone: true }),
    extraContentVerifiedBy: text('extra_content_verified_by'),

    // Photo description workflow
    photoDescription: text('photo_description'),
    photoDescriptionStatus: contentStatusEnum('photo_description_status').notNull().default('EMPTY'),
    photoDescriptionVerifiedAt: timestamp('photo_description_verified_at', { withTimezone: true }),
    photoDescriptionVerifiedBy: text('photo_description_verified_by'),
    photoDescriptionContext: text('photo_description_context'),

    // AI notes (structured observations, suggestions, hunches)
    aiNotes: jsonb('ai_notes'),

    // Admin review
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    notes: text('notes'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // Flag for follow-up
    flagged: boolean('flagged').notNull().default(false),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    flaggedBy: text('flagged_by'),
  },
  (table) => [
    // Idempotency: prevents duplicate conceptual letters
    uniqueIndex('letters_identity_unique').on(
      table.collectionId,
      table.dateRaw,
      table.type,
      table.typeSequence
    ),
    // Query indexes
    index('idx_letters_collection').on(table.collectionId),
    index('idx_letters_visibility').on(table.visibility),
    index('idx_letters_workflow').on(table.workflow),
    index('idx_letters_letter_date').on(table.letterDate),
    index('idx_letters_extracted_date').on(table.extractedDate),
    // Flag index (partial: only flagged=true rows)
    index('idx_letters_flagged').on(table.flagged),
    // V2 indexes
    index('idx_letters_emotional_tone').on(table.emotionalTone),
    index('idx_letters_primary_topics').using('gin', table.primaryTopics),
    // Check constraint: type_sequence >= 1
    check('type_sequence_positive', sql`type_sequence >= 1`),
    // Check constraint: attempt counts >= 0
    check('transcription_attempt_count_positive', sql`transcription_attempt_count >= 0`),
    check('metadata_attempt_count_positive', sql`metadata_attempt_count >= 0`),
  ]
);

// Letter pages table
export const letterPages = pgTable(
  'letter_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    storagePath: text('storage_path').notNull(),
    originalFilename: text('original_filename').notNull(),
    checksumSha256: text('checksum_sha256'),
    lineSegments: jsonb('line_segments'),
    ocrWordBoxes: jsonb('ocr_word_boxes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotency: no duplicate page numbers within a letter
    uniqueIndex('letter_pages_unique').on(table.letterId, table.pageNumber),
    // Query indexes
    index('idx_pages_letter').on(table.letterId),
    index('idx_pages_checksum').on(table.checksumSha256),
    // Check constraint: page_number >= 1
    check('page_number_positive', sql`page_number >= 1`),
  ]
);

// Letter versions table (for version history)
export const letterVersions = pgTable(
  'letter_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    fieldType: text('field_type').notNull(), // 'transcript' or 'metadata'
    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull(), // { text: "..." } for transcript, { sender, recipient, ... } for metadata
    source: text('source').notNull(), // 'ai' or 'human'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Each letter + field_type has unique version numbers
    uniqueIndex('letter_versions_unique').on(table.letterId, table.fieldType, table.versionNumber),
    // Query index
    index('idx_versions_letter').on(table.letterId),
    // Check constraints
    check('field_type_valid', sql`field_type IN ('transcript', 'metadata')`),
    check('source_valid', sql`source IN ('ai', 'human')`),
    check('version_number_positive', sql`version_number >= 1`),
  ]
);

// ============================================================================
// ENTITY TABLES
// ============================================================================

/**
 * Canonical people registry - stores unique individuals across all letters
 */
export const canonicalPersons = pgTable(
  'canonical_persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalName: text('canonical_name').notNull(),
    aliases: text('aliases').array().default([]),
    notes: text('notes'),
    // Biography fields for AI-generated person narratives
    biography: text('biography'),
    biographyStatus: contentStatusEnum('biography_status').notNull().default('EMPTY'),
    biographyVerifiedAt: timestamp('biography_verified_at', { withTimezone: true }),
    biographyVerifiedBy: text('biography_verified_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // GIN index for trigram similarity searches on canonical_name
    index('idx_persons_name_trgm').using('gin', sql`${table.canonicalName} gin_trgm_ops`),
    // GIN index for array containment on aliases
    index('idx_persons_aliases').using('gin', table.aliases),
  ]
);

/**
 * Canonical places registry - stores unique locations across all letters
 */
export const canonicalPlaces = pgTable(
  'canonical_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canonicalName: text('canonical_name').notNull(),
    aliases: text('aliases').array().default([]),
    placeType: placeTypeEnum('place_type'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // GIN index for trigram similarity searches
    index('idx_places_name_trgm').using('gin', sql`${table.canonicalName} gin_trgm_ops`),
    // GIN index for aliases
    index('idx_places_aliases').using('gin', table.aliases),
  ]
);

/**
 * Junction table linking letters to people mentioned
 */
export const letterPersons = pgTable(
  'letter_persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => canonicalPersons.id, { onDelete: 'cascade' }),
    role: personRoleEnum('role').notNull(),
    nameAsWritten: text('name_as_written'),
    relationshipToSender: text('relationship_to_sender'),
    context: text('context'),
    confidence: integer('confidence').notNull().default(100),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique constraint: same person can only have one role per letter
    uniqueIndex('letter_persons_unique').on(table.letterId, table.personId, table.role),
    // Query indexes
    index('idx_letter_persons_letter').on(table.letterId),
    index('idx_letter_persons_person').on(table.personId),
    index('idx_letter_persons_person_role').on(table.personId, table.role),
    // Check constraint for confidence range
    check('confidence_range', sql`confidence >= 0 AND confidence <= 100`),
  ]
);

/**
 * Junction table linking letters to places mentioned
 */
export const letterPlaces = pgTable(
  'letter_places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => canonicalPlaces.id, { onDelete: 'cascade' }),
    role: placeRoleEnum('role').notNull(),
    nameAsWritten: text('name_as_written'),
    context: text('context'),
    confidence: integer('confidence').notNull().default(100),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique constraint: same place can only have one role per letter
    uniqueIndex('letter_places_unique').on(table.letterId, table.placeId, table.role),
    // Query indexes
    index('idx_letter_places_letter').on(table.letterId),
    index('idx_letter_places_place').on(table.placeId),
    index('idx_letter_places_place_role').on(table.placeId, table.role),
    // Check constraint for confidence range
    check('confidence_range_place', sql`confidence >= 0 AND confidence <= 100`),
  ]
);

/**
 * Person-to-person relationships (bidirectional graph)
 * Tracks how canonical persons are related to each other across the collection
 */
export const personRelationships = pgTable(
  'person_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Always store with personAId < personBId alphabetically to prevent duplicates
    personAId: uuid('person_a_id')
      .notNull()
      .references(() => canonicalPersons.id, { onDelete: 'cascade' }),
    personBId: uuid('person_b_id')
      .notNull()
      .references(() => canonicalPersons.id, { onDelete: 'cascade' }),
    relationshipType: personRelationshipTypeEnum('relationship_type').notNull(),
    notes: text('notes'),
    // Track which letter this relationship was discovered in (optional)
    discoveredInLetterId: uuid('discovered_in_letter_id')
      .references(() => letters.id, { onDelete: 'set null' }),
    // AI-suggested vs manually confirmed
    confidence: integer('confidence').notNull().default(100),
    confirmedBy: text('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique constraint: only one relationship between any two people
    uniqueIndex('person_relationships_unique').on(table.personAId, table.personBId),
    // Query indexes
    index('idx_person_rel_a').on(table.personAId),
    index('idx_person_rel_b').on(table.personBId),
    index('idx_person_rel_discovered').on(table.discoveredInLetterId),
    // Confidence check
    check('confidence_range_rel', sql`confidence >= 0 AND confidence <= 100`),
    // Ensure personAId != personBId
    check('no_self_relationship', sql`person_a_id <> person_b_id`),
  ]
);

/**
 * Audit log for tracking admin changes to entities and content
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    userId: text('user_id'),
    action: text('action').notNull(), // 'create', 'update', 'delete', 'merge', 'verify', etc.
    entityType: text('entity_type').notNull(), // 'letter', 'person', 'place', 'relationship', etc.
    entityId: uuid('entity_id'),
    changes: jsonb('changes'), // { before: {...}, after: {...} } or action-specific data
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_log_timestamp').on(table.timestamp),
    index('idx_audit_log_entity').on(table.entityType, table.entityId),
    index('idx_audit_log_user').on(table.userId),
  ]
);

/**
 * Tracks when letters were last opened in the admin UI (separate from letters table
 * to avoid bumping updated_at via the trigger)
 */
export const letterViews = pgTable('letter_views', {
  letterId: uuid('letter_id').primaryKey().references(() => letters.id, { onDelete: 'cascade' }),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Review queue for pending entity matches needing admin confirmation
 */
export const entityReviewQueue = pgTable(
  'entity_review_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(), // 'person' | 'place'
    extractedText: text('extracted_text').notNull(),
    letterId: uuid('letter_id')
      .notNull()
      .references(() => letters.id, { onDelete: 'cascade' }),
    suggestedEntityId: uuid('suggested_entity_id'),
    context: text('context'),
    confidence: integer('confidence').notNull().default(0),
    status: entityReviewStatusEnum('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_review_queue_status').on(table.status),
    index('idx_review_queue_letter').on(table.letterId),
    index('idx_review_queue_entity_type').on(table.entityType),
  ]
);

// ============================================================================
// CONTENT PUBLISHING TABLES
// ============================================================================

/**
 * Blog posts for the public site
 */
export const updatePosts = pgTable(
  'update_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    bodyMarkdown: text('body_markdown').notNull(),
    status: text('status').notNull().default('draft'),
    category: text('category'),
    authorDisplayName: text('author_display_name'),
    authorRole: text('author_role'),
    heroImageUrl: text('hero_image_url'),
    heroImageAlt: text('hero_image_alt'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    ctaLabel: text('cta_label'),
    ctaUrl: text('cta_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('update_posts_slug_unique').on(table.slug),
    index('idx_update_posts_status').on(table.status),
    index('idx_update_posts_published_at').on(table.publishedAt),
    index('idx_update_posts_created_at').on(table.createdAt),
  ]
);

/**
 * Structured content pages (about, contact, support)
 */
export const contentPages = pgTable(
  'content_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    contentJson: jsonb('content_json').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by'),
  },
  (table) => [
    uniqueIndex('content_pages_slug_unique').on(table.slug),
  ]
);

// ============================================================================
// ADMIN AUTH TABLES
// ============================================================================

/**
 * Admin users for JWT-based authentication
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin invite tokens — allows existing admins to invite new admins
 */
export const adminInvites = pgTable('admin_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  email: text('email'),
  invitedBy: uuid('invited_by').notNull().references(() => adminUsers.id),
  usedBy: uuid('used_by').references(() => adminUsers.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// SITE SETTINGS TABLE
// ============================================================================

/**
 * Key-value store for site-wide configuration (admin-editable)
 */
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// ADMIN NOTIFICATIONS TABLE
// ============================================================================

/**
 * Admin notification feed — persistent, queryable notifications for the admin UI
 */
export const adminNotifications = pgTable('admin_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // 'transcription', 'metadata', 'entity', 'upload', 'batch', 'admin', 'error', 'system'
  title: text('title').notNull(),
  message: text('message'),
  link: text('link'), // optional frontend route, e.g., '/admin/letters/abc-123'
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// API USAGE TRACKING TABLE
// ============================================================================

/**
 * Tracks OpenAI API usage and costs per call
 */
export const apiUsageLogs = pgTable(
  'api_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    letterId: uuid('letter_id').references(() => letters.id, { onDelete: 'set null' }),
    callType: text('call_type').notNull(), // 'transcription', 'metadata', 'entity_extraction', 'metadata_update', 'extra_content_check', 'extra_content_transcription', 'metadata_v2', 'entity_resolution'
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    inputCost: text('input_cost').notNull(), // Stored as string to avoid float precision issues (e.g., "0.001500")
    outputCost: text('output_cost').notNull(),
    totalCost: text('total_cost').notNull(),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_usage_logs_letter').on(table.letterId),
    index('idx_usage_logs_call_type').on(table.callType),
    index('idx_usage_logs_created_at').on(table.createdAt),
  ]
);

// ============================================================================
// RELATIONS
// ============================================================================

export const collectionsRelations = relations(collections, ({ many }) => ({
  letters: many(letters),
}));

export const lettersRelations = relations(letters, ({ one, many }) => ({
  collection: one(collections, {
    fields: [letters.collectionId],
    references: [collections.id],
  }),
  pages: many(letterPages),
  versions: many(letterVersions),
  persons: many(letterPersons),
  places: many(letterPlaces),
}));

export const letterViewsRelations = relations(letterViews, ({ one }) => ({
  letter: one(letters, {
    fields: [letterViews.letterId],
    references: [letters.id],
  }),
}));

export const letterPagesRelations = relations(letterPages, ({ one }) => ({
  letter: one(letters, {
    fields: [letterPages.letterId],
    references: [letters.id],
  }),
}));

export const letterVersionsRelations = relations(letterVersions, ({ one }) => ({
  letter: one(letters, {
    fields: [letterVersions.letterId],
    references: [letters.id],
  }),
}));

export const canonicalPersonsRelations = relations(canonicalPersons, ({ many }) => ({
  letterPersons: many(letterPersons),
  // Relationships where this person is personA
  relationshipsAsA: many(personRelationships, { relationName: 'personA' }),
  // Relationships where this person is personB
  relationshipsAsB: many(personRelationships, { relationName: 'personB' }),
}));

export const personRelationshipsRelations = relations(personRelationships, ({ one }) => ({
  personA: one(canonicalPersons, {
    fields: [personRelationships.personAId],
    references: [canonicalPersons.id],
    relationName: 'personA',
  }),
  personB: one(canonicalPersons, {
    fields: [personRelationships.personBId],
    references: [canonicalPersons.id],
    relationName: 'personB',
  }),
  discoveredInLetter: one(letters, {
    fields: [personRelationships.discoveredInLetterId],
    references: [letters.id],
  }),
}));

export const canonicalPlacesRelations = relations(canonicalPlaces, ({ many }) => ({
  letterPlaces: many(letterPlaces),
}));

export const letterPersonsRelations = relations(letterPersons, ({ one }) => ({
  letter: one(letters, {
    fields: [letterPersons.letterId],
    references: [letters.id],
  }),
  person: one(canonicalPersons, {
    fields: [letterPersons.personId],
    references: [canonicalPersons.id],
  }),
}));

export const letterPlacesRelations = relations(letterPlaces, ({ one }) => ({
  letter: one(letters, {
    fields: [letterPlaces.letterId],
    references: [letters.id],
  }),
  place: one(canonicalPlaces, {
    fields: [letterPlaces.placeId],
    references: [canonicalPlaces.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

export type Letter = typeof letters.$inferSelect;
export type NewLetter = typeof letters.$inferInsert;

export type LetterPage = typeof letterPages.$inferSelect;
export type NewLetterPage = typeof letterPages.$inferInsert;

export type LetterVersion = typeof letterVersions.$inferSelect;
export type NewLetterVersion = typeof letterVersions.$inferInsert;

export type LetterType = 'L' | 'P' | 'E' | 'V' | 'A' | 'D' | 'C' | 'N' | 'T';
export type WorkflowState = 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED' | 'METADATA_EXTRACTING' | 'METADATA_DRAFTED' | 'REVIEWED';
export type VisibilityState = 'PUBLISHED' | 'HIDDEN';
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type DateConfidence = 'exact' | 'unknown' | 'inferred';
export type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

// V2 Metadata types
export type EmotionalTone = 'joyful' | 'hopeful' | 'neutral' | 'anxious' | 'sad' | 'angry' | 'desperate';
export type RelationshipType = 'spouse' | 'fiancé/fiancée' | 'romantic-partner' | 'parent' | 'child' | 'sibling' | 'grandparent' | 'grandchild' | 'aunt/uncle' | 'nephew/niece' | 'cousin' | 'in-law' | 'friend' | 'acquaintance' | 'business-associate' | 'employer' | 'employee' | 'unknown';

// Entity types
export type CanonicalPerson = typeof canonicalPersons.$inferSelect;
export type NewCanonicalPerson = typeof canonicalPersons.$inferInsert;

export type CanonicalPlace = typeof canonicalPlaces.$inferSelect;
export type NewCanonicalPlace = typeof canonicalPlaces.$inferInsert;

export type LetterPerson = typeof letterPersons.$inferSelect;
export type NewLetterPerson = typeof letterPersons.$inferInsert;

export type LetterPlace = typeof letterPlaces.$inferSelect;
export type NewLetterPlace = typeof letterPlaces.$inferInsert;

export type EntityReviewItem = typeof entityReviewQueue.$inferSelect;
export type NewEntityReviewItem = typeof entityReviewQueue.$inferInsert;

export type PersonRole = 'sender' | 'recipient' | 'mentioned';
export type PlaceRole = 'written_from' | 'mentioned' | 'destination';
export type PlaceType = 'city' | 'region' | 'country' | 'street' | 'landmark' | 'other';
export type EntityReviewStatus = 'pending' | 'confirmed' | 'rejected' | 'new_entity';

// Person relationship types
export type PersonRelationship = typeof personRelationships.$inferSelect;
export type NewPersonRelationship = typeof personRelationships.$inferInsert;
export type PersonRelationshipType = 'spouse' | 'fiancé/fiancée' | 'romantic-partner' | 'parent-child' | 'sibling' | 'grandparent-grandchild' | 'aunt-uncle-niece-nephew' | 'cousin' | 'in-law' | 'friend' | 'acquaintance' | 'business-associate' | 'employer-employee' | 'unknown';

// Audit log types
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// Admin auth types
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type AdminInvite = typeof adminInvites.$inferSelect;
export type NewAdminInvite = typeof adminInvites.$inferInsert;

// Site settings types
export type SiteSetting = typeof siteSettings.$inferSelect;
export type NewSiteSetting = typeof siteSettings.$inferInsert;

// Admin notification types
export type AdminNotification = typeof adminNotifications.$inferSelect;
export type NewAdminNotification = typeof adminNotifications.$inferInsert;

// API usage log types
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
export type NewApiUsageLog = typeof apiUsageLogs.$inferInsert;

// Content publishing types
export type UpdatePost = typeof updatePosts.$inferSelect;
export type NewUpdatePost = typeof updatePosts.$inferInsert;

export type ContentPage = typeof contentPages.$inferSelect;
export type NewContentPage = typeof contentPages.$inferInsert;
