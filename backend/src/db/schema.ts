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
import {
  PERSISTED_EMOTIONAL_TONE_VALUES,
  PERSISTED_RELATIONSHIP_TYPE_VALUES,
} from '../constants/metadata-values.js';

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

export const transcriptionClaimKindEnum = pgEnum('transcription_claim_kind', [
  'QUEUED',
  'REQUESTED',
]);

export const extraContentClaimKindEnum = pgEnum('extra_content_claim_kind', [
  'QUEUED',
  'REQUESTED',
]);

export const metadataClaimKindEnum = pgEnum('metadata_claim_kind', [
  'QUEUED',
  'REQUESTED',
]);

export const entityExtractionClaimKindEnum = pgEnum('entity_extraction_claim_kind', [
  'QUEUED',
  'REQUESTED',
]);

export const dateConfidenceEnum = pgEnum('date_confidence', [
  'exact',
  'unknown',
  'inferred',
]);

// Emotional tone for V2 metadata
export const emotionalToneEnum = pgEnum(
  'emotional_tone',
  PERSISTED_EMOTIONAL_TONE_VALUES,
);

// Sender-recipient relationship for V2 metadata
export const relationshipEnum = pgEnum(
  'relationship_type',
  PERSISTED_RELATIONSHIP_TYPE_VALUES,
);

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
export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionCode: text('collection_code').notNull().unique(),
    title: text('title'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // Optimistic-concurrency epoch for the derived collection profile. Source
    // invalidation and every profile mutation advance it.
    profileRevision: integer('profile_revision').notNull().default(0),
    // Exact database-derived fingerprint of the public corpus approved with
    // the current profile. This is the final read-time guard for profile input
    // writers that do not own the collection revision directly.
    profileSourceFingerprint: text('profile_source_fingerprint'),

    // AI-generated collection profile
    profileNarrative: text('profile_narrative'),
    profileStartHereLetterId: uuid('profile_start_here_letter_id'), // FK to letters(id) added in migration
    profileStartHereReason: text('profile_start_here_reason'),
    profileReadingPaths: jsonb('profile_reading_paths'), // Array<{ title, description, letterIds[] }>
    profileGapAnalysis: jsonb('profile_gap_analysis'),   // Array<{ startDate, endDate, description }>
    profileThemes: jsonb('profile_themes'),               // Array<{ name, description, letterIds[] }>
    profileCorrespondents: jsonb('profile_correspondents'), // Array<{ name, hook, biography }>
    profileStatus: contentStatusEnum('profile_status').notNull().default('EMPTY'),
    profileGeneratedAt: timestamp('profile_generated_at', { withTimezone: true }),
    hook: text('hook'),
    highlightImageId: uuid('highlight_image_id'), // FK to letter_pages(id) — the featured image for this collection
  },
  (table) => [
    check(
      'collection_profile_revision_nonnegative',
      sql`${table.profileRevision} >= 0`,
    ),
    check(
      'collection_profile_source_fingerprint_valid',
      sql`${table.profileSourceFingerprint} IS NULL
        OR ${table.profileSourceFingerprint} ~ '^[0-9a-f]{32}$'`,
    ),
  ],
);

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
    // Monotonic source epoch for a correspondence unit. L and source-bearing
    // companion page changes advance every member so source-bound admin writes
    // from an older browser cannot restore stale derived state.
    primarySourceRevision: integer('primary_source_revision').notNull().default(0),
    visibility: visibilityStateEnum('visibility').notNull().default('HIDDEN'),
    transcriptPublished: boolean('transcript_published').notNull().default(false),
    metadataPublished: boolean('metadata_published').notNull().default(false),

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
    // Database-owned identity for the exact UTF-8 transcript bytes. The
    // migration trigger advances the revision and refreshes the checksum for
    // every writer, including older application revisions and direct SQL.
    transcriptRevision: integer('transcript_revision').notNull().default(0),
    transcriptChecksumSha256: text('transcript_checksum_sha256')
      .notNull()
      .default('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    transcriptionJson: jsonb('transcription_json'),
    transcriptionError: text('transcription_error'),
    transcriptionAttemptCount: integer('transcription_attempt_count').notNull().default(0),
    transcriptionRunId: uuid('transcription_run_id'),
    // Millisecond precision round-trips losslessly through JavaScript Date for CAS claims.
    transcriptionLeaseExpiresAt: timestamp('transcription_lease_expires_at', {
      withTimezone: true,
      precision: 3,
    }),
    // Rollout fence: nullable because older revisions neither write nor clear it.
    transcriptionLeaseRunId: uuid('transcription_lease_run_id'),
    transcriptionClaimKind: transcriptionClaimKindEnum('transcription_claim_kind'),
    transcribedAt: timestamp('transcribed_at', { withTimezone: true }),

    // Dead-letter flag: set when a job (transcription/metadata/entity) hits MAX_JOB_ATTEMPTS.
    // The worker excludes dead-letter rows from auto-pickup; manual retry/reset clears it.
    deadLetter: boolean('dead_letter').notNull().default(false),

    // Metadata fields (filterable)
    sender: text('sender'),
    recipient: text('recipient'),
    locationWritten: text('location_written'),
    extractedDate: date('extracted_date'),
    hook: text('hook'),
    summary: text('summary'),
    tags: text('tags').array(),
    metadataJson: jsonb('metadata_json'),
    metadataStatus: jobStatusEnum('metadata_status').notNull().default('PENDING'),
    // Monotonic source/output revision. Claims bind to the exact revision they
    // observed so human and upstream changes can supersede stale AI work.
    metadataRevision: integer('metadata_revision').notNull().default(0),
    // Expand/contract rollout fence: current claims populate this ownership
    // tuple, while tokenless RUNNING rows from older revisions remain visible
    // for deliberate reconciliation after those executors have drained.
    metadataRunId: uuid('metadata_run_id'),
    metadataRunRevision: integer('metadata_run_revision'),
    metadataLeaseExpiresAt: timestamp('metadata_lease_expires_at', {
      withTimezone: true,
      precision: 3,
    }),
    metadataLeaseRunId: uuid('metadata_lease_run_id'),
    metadataClaimKind: metadataClaimKindEnum('metadata_claim_kind'),
    metadataError: text('metadata_error'),
    metadataAttemptCount: integer('metadata_attempt_count').notNull().default(0),
    // Durable reviewer guidance for a transcript-confirmation-owned metadata
    // intent. Nullable during the expand phase so legacy confirmations and
    // metadata attempts retain their unknown provenance.
    metadataConfirmationGuidance: jsonb('metadata_confirmation_guidance').$type<{
      version: 1;
      confirmationId: string;
      metadataInputIdentity: string;
      confirmedSender: string | null;
      confirmedRecipient: string | null;
    }>(),
    // A current metadata claimant binds durable guidance to its exact run.
    // Guidance remains available after metadata completion for deferred entity
    // extraction, so this intentionally need not match a terminal run tuple.
    metadataGuidanceRunId: uuid('metadata_guidance_run_id'),

    // V2 Metadata fields
    emotionalTone: emotionalToneEnum('emotional_tone'),
    senderRecipientRelationship: relationshipEnum('sender_recipient_relationship'),
    primaryTopics: text('primary_topics').array(),
    // V2 extraction stores full structured output
    metadataV2Json: jsonb('metadata_v2_json'),

    // Entity extraction (Prompt 2 - separate from basic metadata)
    entityExtractionJson: jsonb('entity_extraction_json'),
    entityExtractionStatus: jobStatusEnum('entity_extraction_status').notNull().default('PENDING'),
    // The committed revision remains authoritative while a replacement run is
    // in flight. The run tuple identifies the only producer allowed to replace
    // that committed projection.
    entityExtractionRevision: integer('entity_extraction_revision').notNull().default(0),
    entityExtractionRunId: uuid('entity_extraction_run_id'),
    entityExtractionRunRevision: integer('entity_extraction_run_revision'),
    entityExtractionLeaseExpiresAt: timestamp('entity_extraction_lease_expires_at', {
      withTimezone: true,
      precision: 3,
    }),
    entityExtractionLeaseRunId: uuid('entity_extraction_lease_run_id'),
    entityExtractionClaimKind: entityExtractionClaimKindEnum('entity_extraction_claim_kind'),
    entityExtractionError: text('entity_extraction_error'),

    // Transcript confirmation (gates metadata extraction)
    transcriptConfirmedAt: timestamp('transcript_confirmed_at', { withTimezone: true }),
    transcriptConfirmedBy: text('transcript_confirmed_by'),
    transcriptConfirmationId: uuid('transcript_confirmation_id'),
    transcriptConfirmationIntentHash: text('transcript_confirmation_intent_hash'),
    transcriptConfirmationSourceRevision: integer('transcript_confirmation_source_revision'),
    transcriptConfirmationTranscriptDigest: text('transcript_confirmation_transcript_digest'),

    // Extra content transcription (telegrams, covers, ephemera)
    extraContentTranscript: text('extra_content_transcript'),
    extraContentStatus: contentStatusEnum('extra_content_status').notNull().default('EMPTY'),
    extraContentVerifiedAt: timestamp('extra_content_verified_at', { withTimezone: true }),
    extraContentVerifiedBy: text('extra_content_verified_by'),
    extraContentJobStatus: jobStatusEnum('extra_content_job_status').notNull().default('PENDING'),
    extraContentJobError: text('extra_content_job_error'),
    extraContentJobRunId: uuid('extra_content_job_run_id'),
    // Millisecond precision round-trips losslessly through JavaScript Date for CAS claims.
    extraContentJobLeaseExpiresAt: timestamp('extra_content_job_lease_expires_at', {
      withTimezone: true,
      precision: 3,
    }),
    extraContentJobLeaseRunId: uuid('extra_content_job_lease_run_id'),
    extraContentJobClaimKind: extraContentClaimKindEnum('extra_content_job_claim_kind'),
    extraContentJobDirty: boolean('extra_content_job_dirty').notNull().default(false),

    // Photo description workflow
    photoDescription: text('photo_description'),
    photoDescriptionStatus: contentStatusEnum('photo_description_status').notNull().default('EMPTY'),
    photoDescriptionVerifiedAt: timestamp('photo_description_verified_at', { withTimezone: true }),
    photoDescriptionVerifiedBy: text('photo_description_verified_by'),
    photoDescriptionContext: text('photo_description_context'),

    // AI notes (structured observations, suggestions, hunches)
    aiNotes: jsonb('ai_notes'),

    // Reading view text (independent spacing from raw transcript)
    readingText: text('reading_text'),

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
    index('idx_letters_transcription_lease_expires_at')
      .on(table.transcriptionLeaseExpiresAt)
      .where(sql`${table.transcriptionStatus} = 'RUNNING' AND ${table.transcriptionLeaseExpiresAt} IS NOT NULL`),
    index('idx_letters_extra_content_job_lease_expires_at')
      .on(table.extraContentJobLeaseExpiresAt)
      .where(sql`${table.extraContentJobStatus} = 'RUNNING' AND ${table.extraContentJobLeaseExpiresAt} IS NOT NULL`),
    index('idx_letters_metadata_lease_expires_at')
      .on(table.metadataLeaseExpiresAt)
      .where(sql`${table.metadataStatus} = 'RUNNING' AND ${table.metadataLeaseExpiresAt} IS NOT NULL`),
    index('idx_letters_entity_extraction_lease_expires_at')
      .on(table.entityExtractionLeaseExpiresAt)
      .where(sql`${table.entityExtractionStatus} = 'RUNNING' AND ${table.entityExtractionLeaseExpiresAt} IS NOT NULL`),
    // Flag index (partial: only flagged=true rows)
    index('idx_letters_flagged').on(table.flagged),
    // V2 indexes
    index('idx_letters_emotional_tone').on(table.emotionalTone),
    index('idx_letters_primary_topics').using('gin', table.primaryTopics),
    uniqueIndex('letters_transcript_confirmation_id_unique')
      .on(table.transcriptConfirmationId)
      .where(sql`${table.transcriptConfirmationId} IS NOT NULL`),
    // Check constraint: type_sequence >= 1
    check('type_sequence_positive', sql`type_sequence >= 1`),
    // Check constraint: attempt counts >= 0
    check('transcription_attempt_count_positive', sql`transcription_attempt_count >= 0`),
    check('metadata_attempt_count_positive', sql`metadata_attempt_count >= 0`),
    check('metadata_revision_nonnegative', sql`metadata_revision >= 0`),
    check('primary_source_revision_nonnegative', sql`${table.primarySourceRevision} >= 0`),
    check('transcript_revision_nonnegative', sql`${table.transcriptRevision} >= 0`),
    check(
      'transcript_checksum_sha256_valid',
      sql`${table.transcriptChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'entity_extraction_revision_nonnegative',
      sql`${table.entityExtractionRevision} >= 0`,
    ),
    check(
      'entity_extraction_owner_shape',
      sql`(
        ${table.entityExtractionRunId} IS NULL
        AND ${table.entityExtractionRunRevision} IS NULL
      ) OR (
        ${table.entityExtractionStatus} = 'RUNNING'
        AND ${table.entityExtractionRunId} IS NOT NULL
        AND ${table.entityExtractionRunRevision} IS NOT NULL
        AND ${table.entityExtractionRunRevision} = ${table.entityExtractionRevision} + 1
      )`,
    ),
    // During rolling deployment an older terminal writer may clear the run
    // tuple while leaving this new tuple behind. Current code treats that
    // residue as non-authoritative and overwrites it on the next claim.
    check(
      'entity_extraction_lease_metadata_valid',
      sql`(${table.entityExtractionLeaseExpiresAt} IS NULL)
        = (${table.entityExtractionLeaseRunId} IS NULL)
        AND (${table.entityExtractionLeaseExpiresAt} IS NULL)
        = (${table.entityExtractionClaimKind} IS NULL)`,
    ),
    check(
      'metadata_owner_shape',
      sql`(
        ${table.metadataRunId} IS NULL
        AND ${table.metadataRunRevision} IS NULL
        AND ${table.metadataLeaseExpiresAt} IS NULL
        AND ${table.metadataLeaseRunId} IS NULL
        AND ${table.metadataClaimKind} IS NULL
      ) OR (
        ${table.metadataStatus} = 'RUNNING'
        AND ${table.metadataRunId} IS NOT NULL
        AND ${table.metadataRunRevision} IS NOT NULL
        AND ${table.metadataRunRevision} = ${table.metadataRevision}
        AND ${table.metadataLeaseExpiresAt} IS NOT NULL
        AND ${table.metadataLeaseRunId} = ${table.metadataRunId}
        AND ${table.metadataClaimKind} IS NOT NULL
      )`,
    ),
    check(
      'transcript_confirmation_identity_shape',
      sql`(
        ${table.transcriptConfirmationId} IS NULL
        AND ${table.transcriptConfirmationIntentHash} IS NULL
        AND ${table.transcriptConfirmationSourceRevision} IS NULL
        AND ${table.transcriptConfirmationTranscriptDigest} IS NULL
      ) OR (
        ${table.transcriptConfirmedAt} IS NOT NULL
        AND ${table.transcriptConfirmationId} IS NOT NULL
        AND ${table.transcriptConfirmationIntentHash} IS NOT NULL
        AND ${table.transcriptConfirmationSourceRevision} IS NOT NULL
        AND ${table.transcriptConfirmationTranscriptDigest} IS NOT NULL
      )`,
    ),
    check(
      'transcript_confirmation_hashes_valid',
      sql`(
        ${table.transcriptConfirmationIntentHash} IS NULL
        OR ${table.transcriptConfirmationIntentHash} ~ '^v1[.][0-9a-f]{64}$'
      ) AND (
        ${table.transcriptConfirmationTranscriptDigest} IS NULL
        OR ${table.transcriptConfirmationTranscriptDigest} ~ '^[0-9a-f]{64}$'
      )`,
    ),
    check(
      'transcript_confirmation_source_revision_nonnegative',
      sql`${table.transcriptConfirmationSourceRevision} IS NULL
        OR ${table.transcriptConfirmationSourceRevision} >= 0`,
    ),
    check(
      'metadata_confirmation_guidance_shape',
      sql`(
          ${table.metadataConfirmationGuidance} IS NULL
          OR (
            ${table.transcriptConfirmationId} IS NOT NULL
            AND jsonb_typeof(${table.metadataConfirmationGuidance}) = 'object'
            AND ${table.metadataConfirmationGuidance}
              ?& ARRAY[
                'version',
                'confirmationId',
                'metadataInputIdentity',
                'confirmedSender',
                'confirmedRecipient'
              ]
            AND ${table.metadataConfirmationGuidance}
              - ARRAY[
                'version',
                'confirmationId',
                'metadataInputIdentity',
                'confirmedSender',
                'confirmedRecipient'
              ] = '{}'::jsonb
            AND ${table.metadataConfirmationGuidance}->'version' = '1'::jsonb
            AND ${table.metadataConfirmationGuidance}->>'confirmationId'
              = ${table.transcriptConfirmationId}::text
            AND ${table.metadataConfirmationGuidance}->>'metadataInputIdentity'
              ~ '^v1[.][0-9a-f]{64}$'
            AND jsonb_typeof(${table.metadataConfirmationGuidance}->'confirmedSender')
              IN ('string', 'null')
            AND jsonb_typeof(${table.metadataConfirmationGuidance}->'confirmedRecipient')
              IN ('string', 'null')
          )
        )
        AND (
          ${table.metadataConfirmationGuidance} IS NOT NULL
          OR ${table.metadataGuidanceRunId} IS NULL
        )`,
    ),
    check(
      'metadata_guidance_running_bound_to_run',
      sql`${table.metadataConfirmationGuidance} IS NULL
        OR ${table.metadataStatus} <> 'RUNNING'
        OR (
          ${table.metadataGuidanceRunId} IS NOT NULL
          AND ${table.metadataRunId} IS NOT NULL
          AND ${table.metadataGuidanceRunId} = ${table.metadataRunId}
        )`,
    ),
    check(
      'transcription_run_id_matches_running',
      sql`(${table.transcriptionStatus} = 'RUNNING') = (${table.transcriptionRunId} IS NOT NULL)`,
    ),
    check(
      'transcription_lease_metadata_valid',
      sql`(${table.transcriptionLeaseExpiresAt} IS NULL)
        = (${table.transcriptionClaimKind} IS NULL)`,
    ),
    check(
      'transcription_excludes_downstream_running',
      sql`${table.transcriptionStatus} <> 'RUNNING'
        OR (
          ${table.metadataStatus} <> 'RUNNING'
          AND ${table.entityExtractionStatus} <> 'RUNNING'
        )`,
    ),
    check(
      'extra_content_job_run_id_matches_running',
      sql`(${table.extraContentJobStatus} = 'RUNNING') = (${table.extraContentJobRunId} IS NOT NULL)`,
    ),
    check(
      'extra_content_job_lease_metadata_valid',
      sql`(${table.extraContentJobLeaseExpiresAt} IS NULL)
        = (${table.extraContentJobLeaseRunId} IS NULL)
        AND (${table.extraContentJobLeaseExpiresAt} IS NULL)
        = (${table.extraContentJobClaimKind} IS NULL)`,
    ),
    check(
      'extra_content_job_dirty_requires_running',
      sql`NOT ${table.extraContentJobDirty} OR ${table.extraContentJobStatus} = 'RUNNING'`,
    ),
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
    // Immutable, versioned detector output. Human review remains in
    // lineSegments during the PageLayoutV2 rollout so rerunning a detector
    // cannot silently destroy the original engine evidence.
    pageLayout: jsonb('page_layout'),
    pageLayoutChecksumSha256: text('page_layout_checksum_sha256'),
    lineSegments: jsonb('line_segments'),
    // Monotonic identity for the editable geometry projection. Revision zero
    // represents detector/legacy geometry; it is lazily snapshotted into the
    // append-only log before the first human geometry change.
    geometryRevision: integer('geometry_revision').notNull().default(0),
    geometryChecksumSha256: text('geometry_checksum_sha256'),
    segmentTrustState: text('segment_trust_state').notNull().default('unverified'),
    approvedGeometryRevision: integer('approved_geometry_revision'),
    approvedGeometryChecksumSha256: text('approved_geometry_checksum_sha256'),
    geometryApprovedBy: text('geometry_approved_by'),
    geometryApprovedAt: timestamp('geometry_approved_at', { withTimezone: true }),
    width: integer('width'),
    height: integer('height'),
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
    check(
      'page_layout_v2_envelope',
      sql`${table.pageLayout} IS NULL
        OR (
          jsonb_typeof(${table.pageLayout}) = 'object'
          AND COALESCE(
            ${table.pageLayout}->'schemaVersion' = '2'::jsonb,
            false
          )
        )`,
    ),
    check(
      'page_layout_checksum_valid',
      sql`${table.pageLayoutChecksumSha256} IS NULL
        OR ${table.pageLayoutChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_layout_checksum_presence',
      sql`(${table.pageLayout} IS NULL)
        = (${table.pageLayoutChecksumSha256} IS NULL)`,
    ),
    check(
      'page_layout_page_id_matches_row',
      sql`${table.pageLayout} IS NULL
        OR ${table.pageLayout}->>'pageId' = ${table.id}::text`,
    ),
    check(
      'page_layout_source_checksum_matches_row',
      sql`${table.pageLayout} IS NULL
        OR (
          ${table.checksumSha256} IS NOT NULL
          AND COALESCE(
            ${table.pageLayout}#>>'{image,source,checksumSha256}',
            ${table.pageLayout}#>>'{image,checksumSha256}'
          ) = ${table.checksumSha256}
        )`,
    ),
    check('geometry_revision_nonnegative', sql`${table.geometryRevision} >= 0`),
    check(
      'geometry_checksum_valid',
      sql`${table.geometryChecksumSha256} IS NULL
        OR ${table.geometryChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'geometry_revision_checksum_presence',
      sql`${table.geometryRevision} = 0
        OR ${table.geometryChecksumSha256} IS NOT NULL`,
    ),
    check(
      'geometry_approval_shape',
      sql`(
          ${table.approvedGeometryRevision} IS NULL
          AND ${table.approvedGeometryChecksumSha256} IS NULL
          AND ${table.geometryApprovedBy} IS NULL
          AND ${table.geometryApprovedAt} IS NULL
        )
        OR (
          ${table.approvedGeometryRevision} IS NOT NULL
          AND ${table.approvedGeometryChecksumSha256} IS NOT NULL
          AND ${table.geometryApprovedBy} IS NOT NULL
          AND ${table.geometryApprovedAt} IS NOT NULL
        )`,
    ),
    check(
      'geometry_approval_matches_current',
      sql`${table.approvedGeometryRevision} IS NULL
        OR (
          ${table.approvedGeometryRevision} = ${table.geometryRevision}
          AND ${table.approvedGeometryChecksumSha256}
            = ${table.geometryChecksumSha256}
        )`,
    ),
    check(
      'segment_trust_bound_to_geometry',
      sql`(
          ${table.segmentTrustState} = 'unverified'
          AND ${table.approvedGeometryRevision} IS NULL
        )
        OR (
          ${table.segmentTrustState} = 'trusted'
          AND ${table.approvedGeometryRevision} IS NOT NULL
        )`,
    ),
  ]
);

/**
 * Immutable geometry snapshots: a lazy system baseline for revision zero,
 * followed by each reviewer shape edit.
 *
 * The mutable letter_pages.line_segments column remains the fast read
 * projection. This table is the durable history and intentionally contains
 * geometry/provenance only; transcript mappings and review classifications do
 * not manufacture geometry revisions.
 */
export const pageGeometryRevisions = pgTable(
  'page_geometry_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => letterPages.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    primarySourceRevision: integer('primary_source_revision').notNull(),
    sourceChecksumSha256: text('source_checksum_sha256'),
    basePageLayoutChecksumSha256: text('base_page_layout_checksum_sha256'),
    geometryChecksumSha256: text('geometry_checksum_sha256').notNull(),
    geometrySnapshot: jsonb('geometry_snapshot').notNull(),
    changeSummary: jsonb('change_summary').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('page_geometry_revisions_page_source_revision_unique')
      .on(table.pageId, table.primarySourceRevision, table.revision),
    index('idx_page_geometry_revisions_page_created')
      .on(table.pageId, table.createdAt),
    check('page_geometry_revision_nonnegative', sql`${table.revision} >= 0`),
    check(
      'page_geometry_revision_source_revision_nonnegative',
      sql`${table.primarySourceRevision} >= 0`,
    ),
    check(
      'page_geometry_revision_source_checksum_valid',
      sql`${table.sourceChecksumSha256} IS NULL
        OR ${table.sourceChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_geometry_revision_base_layout_checksum_valid',
      sql`${table.basePageLayoutChecksumSha256} IS NULL
        OR ${table.basePageLayoutChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_geometry_revision_checksum_valid',
      sql`${table.geometryChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_geometry_revision_snapshot_array',
      sql`jsonb_typeof(${table.geometrySnapshot}) = 'array'`,
    ),
    check(
      'page_geometry_revision_change_summary_object',
      sql`jsonb_typeof(${table.changeSummary}) = 'object'`,
    ),
  ],
);

/** Append-only audit history for geometry approval and revocation. */
export const pageGeometryReviewEvents = pgTable(
  'page_geometry_review_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => letterPages.id, { onDelete: 'cascade' }),
    primarySourceRevision: integer('primary_source_revision').notNull(),
    sourceChecksumSha256: text('source_checksum_sha256'),
    geometryRevision: integer('geometry_revision').notNull(),
    geometryChecksumSha256: text('geometry_checksum_sha256').notNull(),
    decision: text('decision').notNull(),
    reviewedBy: text('reviewed_by').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_page_geometry_review_events_page_reviewed')
      .on(table.pageId, table.reviewedAt),
    check(
      'page_geometry_review_event_revision_nonnegative',
      sql`${table.geometryRevision} >= 0`,
    ),
    check(
      'page_geometry_review_event_source_revision_nonnegative',
      sql`${table.primarySourceRevision} >= 0`,
    ),
    check(
      'page_geometry_review_event_source_checksum_valid',
      sql`${table.sourceChecksumSha256} IS NULL
        OR ${table.sourceChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_geometry_review_event_checksum_valid',
      sql`${table.geometryChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_geometry_review_event_decision_valid',
      sql`${table.decision} IN ('trusted', 'unverified')`,
    ),
  ],
);

/**
 * Immutable OCR/HTR evidence bound to one exact page source, editable
 * projection, recognition profile, and per-segment geometry.
 *
 * The canonical artifact remains intact in JSONB for replay and future model
 * training. Denormalized identity columns make exact-current reads indexed and
 * let database constraints reject a mismatched envelope.
 */
export const pageRecognitionArtifacts = pgTable(
  'page_recognition_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => letterPages.id, { onDelete: 'cascade' }),
    artifactChecksumSha256: text('artifact_checksum_sha256').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    primarySourceRevision: integer('primary_source_revision').notNull(),
    sourceChecksumSha256: text('source_checksum_sha256').notNull(),
    geometryRevision: integer('geometry_revision').notNull(),
    geometryChecksumSha256: text('geometry_checksum_sha256').notNull(),
    lineSegmentsChecksumSha256: text('line_segments_checksum_sha256').notNull(),
    alignmentSegmentInputChecksumSha256: text(
      'alignment_segment_input_checksum_sha256',
    ).notNull(),
    profileChecksumSha256: text('profile_checksum_sha256').notNull(),
    engine: text('engine').notNull(),
    engineVersion: text('engine_version').notNull(),
    modelName: text('model_name').notNull(),
    modelChecksumSha256: text('model_checksum_sha256').notNull(),
    configChecksumSha256: text('config_checksum_sha256').notNull(),
    state: text('state').notNull(),
    artifact: jsonb('artifact').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    persistedAt: timestamp('persisted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('page_recognition_artifacts_checksum_unique')
      .on(table.artifactChecksumSha256),
    index('idx_page_recognition_artifacts_current_profile').on(
      table.pageId,
      table.primarySourceRevision,
      table.sourceChecksumSha256,
      table.geometryRevision,
      table.geometryChecksumSha256,
      table.lineSegmentsChecksumSha256,
      table.alignmentSegmentInputChecksumSha256,
      table.profileChecksumSha256,
      table.createdAt,
    ),
    check(
      'page_recognition_artifact_checksum_valid',
      sql`${table.artifactChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_source_revision_nonnegative',
      sql`${table.primarySourceRevision} >= 0`,
    ),
    check(
      'page_recognition_geometry_revision_nonnegative',
      sql`${table.geometryRevision} >= 0`,
    ),
    check(
      'page_recognition_source_checksum_valid',
      sql`${table.sourceChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_geometry_checksum_valid',
      sql`${table.geometryChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_line_segments_checksum_valid',
      sql`${table.lineSegmentsChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_alignment_input_checksum_valid',
      sql`${table.alignmentSegmentInputChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_profile_checksum_valid',
      sql`${table.profileChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_model_checksum_valid',
      sql`${table.modelChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_config_checksum_valid',
      sql`${table.configChecksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'page_recognition_schema_version_valid',
      sql`${table.schemaVersion} IN (1, 2)`,
    ),
    check(
      'page_recognition_state_valid',
      sql`${table.state} IN ('completed', 'partial')`,
    ),
    check(
      'page_recognition_artifact_object',
      sql`jsonb_typeof(${table.artifact}) = 'object'`,
    ),
    check(
      'page_recognition_artifact_records_array',
      sql`jsonb_typeof(${table.artifact}->'records') = 'array'`,
    ),
    check(
      'page_recognition_v2_evidence_valid',
      sql`${table.schemaVersion} <> 2 OR (
        jsonb_typeof(${table.artifact}->'evidence') = 'object'
        AND jsonb_typeof(${table.artifact}#>'{evidence,inference}') = 'object'
        AND jsonb_typeof(${table.artifact}#>'{evidence,raster}') = 'object'
        AND jsonb_typeof(${table.artifact}#>'{evidence,normalization}')
          = 'object'
        AND ${table.artifact}#>>'{evidence,raster,checksumAlgorithm}'
          = 'sha256-rgb8-v1'
        AND ${table.artifact}#>>'{evidence,normalization,normalized,mode}'
          = 'RGB'
      )`,
    ),
    check(
      'page_recognition_artifact_identity_matches',
      sql`${table.artifact}->>'kind' = 'page-line-recognition'
        AND ${table.artifact}->>'pageId' = ${table.pageId}::text
        AND (${table.artifact}->>'schemaVersion')::integer
          = ${table.schemaVersion}
        AND ${table.artifact}#>>'{source,primarySourceRevision}'
          = ${table.primarySourceRevision}::text
        AND ${table.artifact}#>>'{source,sourceChecksumSha256}'
          = ${table.sourceChecksumSha256}
        AND ${table.artifact}#>>'{source,geometryRevision}'
          = ${table.geometryRevision}::text
        AND ${table.artifact}#>>'{source,geometryChecksumSha256}'
          = ${table.geometryChecksumSha256}
        AND ${table.artifact}#>>'{source,lineSegmentsChecksumSha256}'
          = ${table.lineSegmentsChecksumSha256}
        AND ${table.artifact}#>>'{source,alignmentSegmentInputChecksumSha256}'
          = ${table.alignmentSegmentInputChecksumSha256}
        AND ${table.artifact}#>>'{profile,profileChecksumSha256}'
          = ${table.profileChecksumSha256}
        AND ${table.artifact}#>>'{profile,engine}' = ${table.engine}
        AND ${table.artifact}#>>'{profile,engineVersion}'
          = ${table.engineVersion}
        AND ${table.artifact}#>>'{profile,modelName}' = ${table.modelName}
        AND ${table.artifact}#>>'{profile,modelChecksumSha256}'
          = ${table.modelChecksumSha256}
        AND ${table.artifact}#>>'{profile,configChecksumSha256}'
          = ${table.configChecksumSha256}
        AND ${table.artifact}->>'state' = ${table.state}
        AND (${table.artifact}->>'createdAt')::timestamptz
          = ${table.createdAt}`,
    ),
  ],
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
    primarySourceRevision: integer('primary_source_revision').notNull().default(0),
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
    check(
      'letter_version_primary_source_revision_nonnegative',
      sql`${table.primarySourceRevision} >= 0`,
    ),
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
    hook: text('hook'),
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
    // NULL denotes a link owned outside the letter extraction pipeline.
    // Extraction-owned links carry the committed revision and replace as one unit.
    entityExtractionRevision: integer('entity_extraction_revision'),
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
    index('idx_letter_persons_extraction_revision').on(
      table.letterId,
      table.entityExtractionRevision,
    ),
    // Check constraint for confidence range
    check('confidence_range', sql`confidence >= 0 AND confidence <= 100`),
    check(
      'letter_persons_extraction_revision_nonnegative',
      sql`${table.entityExtractionRevision} IS NULL OR ${table.entityExtractionRevision} >= 0`,
    ),
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
    entityExtractionRevision: integer('entity_extraction_revision'),
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
    index('idx_letter_places_extraction_revision').on(
      table.letterId,
      table.entityExtractionRevision,
    ),
    // Check constraint for confidence range
    check('confidence_range_place', sql`confidence >= 0 AND confidence <= 100`),
    check(
      'letter_places_extraction_revision_nonnegative',
      sql`${table.entityExtractionRevision} IS NULL OR ${table.entityExtractionRevision} >= 0`,
    ),
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
    // NULL denotes a human/system-owned relationship. A revision marks a
    // relationship owned by one committed extraction of its discovery letter.
    entityExtractionRevision: integer('entity_extraction_revision'),
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
    index('idx_person_rel_extraction_revision').on(
      table.discoveredInLetterId,
      table.entityExtractionRevision,
    ),
    // Confidence check
    check('confidence_range_rel', sql`confidence >= 0 AND confidence <= 100`),
    // Ensure personAId != personBId
    check('no_self_relationship', sql`person_a_id <> person_b_id`),
    check(
      'person_relationships_extraction_revision_nonnegative',
      sql`${table.entityExtractionRevision} IS NULL OR ${table.entityExtractionRevision} >= 0`,
    ),
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
    entityExtractionRevision: integer('entity_extraction_revision'),
    status: entityReviewStatusEnum('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_review_queue_status').on(table.status),
    index('idx_review_queue_letter').on(table.letterId),
    index('idx_review_queue_entity_type').on(table.entityType),
    index('idx_review_queue_extraction_revision').on(
      table.letterId,
      table.entityExtractionRevision,
    ),
    check(
      'review_queue_extraction_revision_nonnegative',
      sql`${table.entityExtractionRevision} IS NULL OR ${table.entityExtractionRevision} >= 0`,
    ),
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
  canDeleteAdminProfiles: boolean('can_delete_admin_profiles').notNull().default(false),
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
 * Admin notification feed — persistent, queryable notifications for the admin UI.
 * See backend/src/services/notifications.ts for the canonical type/severity enums
 * and the notify() helper that should be used for all inserts.
 */
export const adminNotifications = pgTable(
  'admin_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(), // canonical NotificationType (see services/notifications.ts)
    severity: text('severity').notNull().default('info'), // 'info' | 'warn' | 'error' | 'critical'
    status: text('status').notNull().default('open'), // 'open' | 'acknowledged' | 'resolved' | 'archived'
    title: text('title').notNull(),
    message: text('message'),
    link: text('link'), // optional frontend route, e.g., '/admin/letters/abc-123'
    sourceType: text('source_type'), // 'letter' | 'collection' | 'job' | 'admin' | 'system'
    sourceId: text('source_id'), // identifier of source entity (no FK so deletes don't cascade)
    metadata: jsonb('metadata'), // structured context (sender, recipient, counts, error code, etc.)
    dedupeKey: text('dedupe_key'), // collapse duplicates within a window
    dedupeCount: integer('dedupe_count').notNull().default(1),
    lastOccurredAt: timestamp('last_occurred_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_notifications_status_severity_created').on(
      table.status,
      table.severity,
      table.createdAt,
    ),
    index('idx_notifications_source').on(table.sourceType, table.sourceId),
    index('idx_notifications_dedupe_open').on(table.dedupeKey),
    index('idx_notifications_expires_at').on(table.expiresAt),
  ],
);

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
// WORKER STATE SINGLETON
// ============================================================================

/**
 * Singleton row observed by the admin Processing page. A complete execution-token
 * lease is authoritative liveness; the remaining fields are its last fenced report.
 */
export const workerState = pgTable(
  'worker_state',
  {
    id: text('id').primaryKey().default('singleton'),
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
    isPolling: boolean('is_polling').notNull().default(false),
    lastError: text('last_error'),
    currentBatchSize: integer('current_batch_size'),
    executionToken: uuid('execution_token'),
    executionLeaseExpiresAt: timestamp('execution_lease_expires_at', {
      withTimezone: true,
      precision: 3,
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'worker_execution_lease_shape',
      sql`(${table.executionToken} IS NULL) = (${table.executionLeaseExpiresAt} IS NULL)`,
    ),
  ],
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

export const letterPagesRelations = relations(letterPages, ({ one, many }) => ({
  letter: one(letters, {
    fields: [letterPages.letterId],
    references: [letters.id],
  }),
  geometryRevisions: many(pageGeometryRevisions),
  geometryReviewEvents: many(pageGeometryReviewEvents),
  recognitionArtifacts: many(pageRecognitionArtifacts),
}));

export const pageGeometryRevisionsRelations = relations(
  pageGeometryRevisions,
  ({ one }) => ({
    page: one(letterPages, {
      fields: [pageGeometryRevisions.pageId],
      references: [letterPages.id],
    }),
  }),
);

export const pageGeometryReviewEventsRelations = relations(
  pageGeometryReviewEvents,
  ({ one }) => ({
    page: one(letterPages, {
      fields: [pageGeometryReviewEvents.pageId],
      references: [letterPages.id],
    }),
  }),
);

export const pageRecognitionArtifactsRelations = relations(
  pageRecognitionArtifacts,
  ({ one }) => ({
    page: one(letterPages, {
      fields: [pageRecognitionArtifacts.pageId],
      references: [letterPages.id],
    }),
  }),
);

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

export type PageGeometryRevision = typeof pageGeometryRevisions.$inferSelect;
export type NewPageGeometryRevision = typeof pageGeometryRevisions.$inferInsert;

export type PageGeometryReviewEvent = typeof pageGeometryReviewEvents.$inferSelect;
export type NewPageGeometryReviewEvent = typeof pageGeometryReviewEvents.$inferInsert;

export type PageRecognitionArtifactRow =
  typeof pageRecognitionArtifacts.$inferSelect;
export type NewPageRecognitionArtifactRow =
  typeof pageRecognitionArtifacts.$inferInsert;

export type LetterVersion = typeof letterVersions.$inferSelect;
export type NewLetterVersion = typeof letterVersions.$inferInsert;

export type LetterType = 'L' | 'P' | 'E' | 'V' | 'A' | 'D' | 'C' | 'N' | 'T';
export type WorkflowState = 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED' | 'METADATA_EXTRACTING' | 'METADATA_DRAFTED' | 'REVIEWED';
export type VisibilityState = 'PUBLISHED' | 'HIDDEN';
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type TranscriptionClaimKind = (typeof transcriptionClaimKindEnum.enumValues)[number];
export type ExtraContentClaimKind = (typeof extraContentClaimKindEnum.enumValues)[number];
export type MetadataClaimKind = (typeof metadataClaimKindEnum.enumValues)[number];
export type EntityExtractionClaimKind =
  (typeof entityExtractionClaimKindEnum.enumValues)[number];
export type DateConfidence = 'exact' | 'unknown' | 'inferred';
export type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

// V2 Metadata types
export type EmotionalTone = (typeof emotionalToneEnum.enumValues)[number];
export type RelationshipType = (typeof relationshipEnum.enumValues)[number];

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
