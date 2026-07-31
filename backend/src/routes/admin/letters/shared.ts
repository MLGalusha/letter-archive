import { z } from 'zod';
import { krakenNativePageLayoutV2Schema } from '../../../services/kraken-page-layout-adapter.js';
import { lineSegmentsSchema } from '../../../schemas/line-segment.js';
import {
  pageLayoutChecksumSchema,
  pageLayoutStableIdSchema,
} from '../../../schemas/page-layout-v2.js';
import {
  EmotionalToneEnum,
  PrimaryTopicEnum,
  RelationshipEnum,
} from '../../../ai/schemas/metadataV2.js';
import {
  decodeMetadataVersionContent,
  decodeTranscriptVersionContent,
} from '../../../services/letter/version-content.js';

export const MAX_BULK_SOURCE_ITEMS = 1_000;

export const bulkSourcesSchema = z.array(z.object({
  letterId: z.string().uuid(),
  primarySourceRevision: z.number().int().nonnegative(),
})).min(1).max(
  MAX_BULK_SOURCE_ITEMS,
  `Select at most ${MAX_BULK_SOURCE_ITEMS} letters at a time`,
).superRefine((sources, context) => {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.letterId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each letter may appear only once',
      });
      return;
    }
    seen.add(source.letterId);
  }
});

export const bulkSourceRequestSchema = z.object({
  sources: bulkSourcesSchema,
});

export const bulkUpdateFieldsSchema = z.object({
  updates: z.array(z.object({
    letterId: z.string().uuid(),
    primarySourceRevision: z.number().int().nonnegative(),
    sender: z.string().optional(),
    recipient: z.string().optional(),
  })).min(1),
});

export const updateLetterSchema = z.object({
  primarySourceRevision: z.number().int().nonnegative().optional(),
  transcriptionText: z.string().optional(),
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
  locationWritten: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  extractedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  emotionalTone: EmotionalToneEnum.nullable().optional(),
  senderRecipientRelationship: RelationshipEnum.nullable().optional(),
  primaryTopics: z.array(PrimaryTopicEnum).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  transcriptPublished: z.boolean().optional(),
  metadataPublished: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  readingText: z.string().nullable().optional(),
});

function decodedVersionContent<Content>(
  decode: (value: unknown) =>
    | { ok: true; content: Content }
    | { ok: false },
) {
  return z.unknown().transform((value, context): Content => {
    const result = decode(value);
    if (result.ok) return result.content;

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid version content',
    });
    return z.NEVER;
  });
}

const versionRequestBase = {
  primarySourceRevision: z.number().int().nonnegative().optional(),
  source: z.enum(['ai', 'human']),
};

export const versionBodySchema = z.discriminatedUnion('fieldType', [
  z.object({
    ...versionRequestBase,
    fieldType: z.literal('transcript'),
    content: decodedVersionContent(decodeTranscriptVersionContent),
  }),
  z.object({
    ...versionRequestBase,
    fieldType: z.literal('metadata'),
    content: decodedVersionContent(decodeMetadataVersionContent),
  }),
]);

export const restoreVersionBodySchema = z.object({
  primarySourceRevision: z.number().int().nonnegative().optional(),
});

export const updateLinkedPersonSchema = z.object({
  canonicalName: z.string().min(1, 'Name is required'),
});

export const updateLinkedPlaceSchema = z.object({
  canonicalName: z.string().min(1, 'Name is required'),
});

export const addLinkedPersonSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['sender', 'recipient', 'mentioned']),
});

export const addLinkedPlaceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['written_from', 'mentioned', 'destination']),
});

export const extractionGuidanceSchema = z.object({
  confirmedSender: z.string().optional(),
  confirmedRecipient: z.string().optional(),
});

export const confirmTranscriptSchema = extractionGuidanceSchema.extend({
  transcriptDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

export const reExtractSchema = z.object({
  confirmedSender: z.string().optional(),
  confirmedRecipient: z.string().optional(),
  mode: z.enum(['full', 'metadata_only', 'entities_only']),
});

const pageSourceExpectationShape = {
  primarySourceRevision: z.number().int().nonnegative(),
  sourceChecksum: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
};

export const saveLineSegmentsSchema = z.object({
  lineSegments: lineSegmentsSchema,
  expectedGeometryRevision: z.number().int().nonnegative(),
  expectedLineSegmentsChecksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  ...pageSourceExpectationShape,
}).strict();

export const saveKrakenPageLayoutSchema = z.object({
  nativePageLayout: krakenNativePageLayoutV2Schema,
  // One execution ID is shared by every page processed in a CLI/worker run.
  runId: pageLayoutStableIdSchema,
  primarySourceRevision: z.number().int().nonnegative(),
  // Native detector output must always be tied to an immutable source object.
  // Pages without a checksum are deliberately excluded from the queue.
  sourceChecksum: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

/**
 * Rotation recovery never writes canonical page layout or editable segments.
 * The detector submits an immutable proposal bound to the exact source bytes
 * and exact editable projection it observed when the local run began.
 */
export const saveRotationGeometryProposalSchema = z.object({
  nativePageLayout: krakenNativePageLayoutV2Schema,
  runId: pageLayoutStableIdSchema,
  source: z.object({
    primarySourceRevision: z.number().int().nonnegative(),
    sourceChecksumSha256: pageLayoutChecksumSchema,
    baseGeometryRevision: z.number().int().nonnegative(),
    baseGeometryChecksumSha256: pageLayoutChecksumSchema,
    baseLineSegmentsChecksumSha256: pageLayoutChecksumSchema,
  }).strict(),
}).strict().superRefine((value, context) => {
  const profile = value.nativePageLayout.producer.config.rotationProfile;
  if (!profile) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nativePageLayout', 'producer', 'config', 'rotationProfile'],
      message: 'Rotation proposal output requires a pinned rotation profile',
    });
    return;
  }
  if (!profile.rotationsDegrees.some((rotation) => rotation !== 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [
        'nativePageLayout',
        'producer',
        'config',
        'rotationProfile',
        'rotationsDegrees',
      ],
      message: 'Rotation proposal output requires a nonzero rotation pass',
    });
  }
});

export const updatePageSegmentTrustSchema = z.object({
  trustState: z.enum(['unverified', 'trusted']),
  expectedGeometryRevision: z.number().int().nonnegative(),
  expectedGeometryChecksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  ...pageSourceExpectationShape,
}).strict();

export const updateLetterSegmentTrustSchema = z.object({
  trustState: z.enum(['unverified', 'trusted']),
  primarySourceRevision: z.number().int().nonnegative(),
  pages: z.array(z.object({
    pageId: z.string().uuid(),
    sourceChecksum: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
    expectedGeometryRevision: z.number().int().nonnegative(),
    expectedGeometryChecksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).min(1),
}).strict();

export const updateIdentitySchema = z.object({
  primarySourceRevision: z.number().int().nonnegative().optional(),
  expectedSender: z.string().nullable().optional(),
  expectedRecipient: z.string().nullable().optional(),
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
});

export const retagMetadataSchema = z.object({
  primarySourceRevision: z.number().int().nonnegative().optional(),
  field: z.enum(['sender', 'recipient', 'both']),
  oldSender: z.string().nullable().optional(),
  newSender: z.string().nullable().optional(),
  oldRecipient: z.string().nullable().optional(),
  newRecipient: z.string().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.field === 'sender' || value.field === 'both') {
    if (value.newSender === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'newSender is required when sender references are being re-tagged',
        path: ['newSender'],
      });
    }
  }

  if (value.field === 'recipient' || value.field === 'both') {
    if (value.newRecipient === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'newRecipient is required when recipient references are being re-tagged',
        path: ['newRecipient'],
      });
    }
  }
});

export const toggleFlagSchema = z.object({
  flagged: z.boolean(),
});

export const addNoteSchema = z.object({
  primarySourceRevision: z.number().int().nonnegative(),
  content: z.string().min(1),
  category: z.enum(['identity', 'date', 'transcription', 'relationship', 'context', 'cross-reference', 'location', 'condition']),
  priority: z.enum(['high', 'medium', 'low']),
});

export const updateNoteStatusSchema = z.object({
  primarySourceRevision: z.number().int().nonnegative(),
  status: z.enum(['dismissed', 'resolved']),
});

export const replaceAiNotesSchema = z.object({
  primarySourceRevision: z.number().int().nonnegative(),
  aiNotes: z.array(z.unknown()),
});

export const notesQuerySchema = z.object({
  type: z.enum(['ai', 'personal']).optional(),
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
