import { z } from 'zod';

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
  extractedDate: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  transcriptPublished: z.boolean().optional(),
  metadataPublished: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  readingText: z.string().nullable().optional(),
});

export const versionBodySchema = z.object({
  primarySourceRevision: z.number().int().nonnegative().optional(),
  fieldType: z.enum(['transcript', 'metadata']),
  content: z.union([z.string(), z.record(z.unknown())]),
  source: z.enum(['ai', 'human']),
});

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

export const confirmTranscriptSchema = z.object({
  confirmedSender: z.string().optional(),
  confirmedRecipient: z.string().optional(),
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
  lineSegments: z.array(z.unknown()),
  ...pageSourceExpectationShape,
});

export const updatePageSegmentTrustSchema = z.object({
  trustState: z.enum(['unverified', 'trusted']),
  ...pageSourceExpectationShape,
});

export const updateLetterSegmentTrustSchema = z.object({
  trustState: z.enum(['unverified', 'trusted']),
  primarySourceRevision: z.number().int().nonnegative(),
  pages: z.array(z.object({
    pageId: z.string().uuid(),
    sourceChecksum: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
  })).min(1),
});

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
