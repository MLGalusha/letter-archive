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

export const letterTypeEnum = pgEnum('letter_type', ['L', 'C', 'E']);

export const workflowStateEnum = pgEnum('workflow_state', [
  'UPLOADED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'METADATA_EXTRACTING',
  'METADATA_DRAFTED',
  'REVIEWED',
]);

export const visibilityStateEnum = pgEnum('visibility_state', [
  'DRAFT',
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

    // Pipeline + visibility
    workflow: workflowStateEnum('workflow').notNull().default('UPLOADED'),
    visibility: visibilityStateEnum('visibility').notNull().default('DRAFT'),

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
}));

export const letterPagesRelations = relations(letterPages, ({ one }) => ({
  letter: one(letters, {
    fields: [letterPages.letterId],
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

export type LetterType = 'L' | 'C' | 'E';
export type WorkflowState = 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED' | 'METADATA_EXTRACTING' | 'METADATA_DRAFTED' | 'REVIEWED';
export type VisibilityState = 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type DateConfidence = 'exact' | 'unknown' | 'inferred';
