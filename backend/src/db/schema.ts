import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  date,
  jsonb,
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

// Content status for transcript and metadata (two-track workflow system)
export const contentStatusEnum = pgEnum('content_status', [
  'EMPTY',      // No content yet
  'AI_DRAFT',   // AI generated, human hasn't touched
  'EDITED',     // Human has edited
  'VERIFIED',   // Human explicitly marked as done
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

    // Transcript confirmation (gates metadata extraction)
    transcriptConfirmedAt: timestamp('transcript_confirmed_at', { withTimezone: true }),
    transcriptConfirmedBy: text('transcript_confirmed_by'),

    // Admin review
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    notes: text('notes'),

    // Soft delete
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    // Check constraint: published requires review
    check('published_requires_review', sql`visibility <> 'PUBLISHED' OR reviewed_at IS NOT NULL`),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotency: no duplicate page numbers within a letter
    uniqueIndex('letter_pages_unique').on(table.letterId, table.pageNumber),
    // Query index
    index('idx_pages_letter').on(table.letterId),
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
