import { z } from 'zod';

export const bulkLetterIdsSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
});

export const bulkMetadataSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
  skipConfirmationCheck: z.boolean().optional().default(false),
});

export const bulkUpdateFieldsSchema = z.object({
  updates: z.array(z.object({
    letterId: z.string().uuid(),
    sender: z.string().optional(),
    recipient: z.string().optional(),
  })).min(1),
});

export const updateLetterSchema = z.object({
  transcriptionText: z.string().optional(),
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
  locationWritten: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  extractedDate: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  notes: z.string().nullable().optional(),
});

export const versionBodySchema = z.object({
  fieldType: z.enum(['transcript', 'metadata']),
  content: z.union([z.string(), z.record(z.unknown())]),
  source: z.enum(['ai', 'human']),
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

export const updateIdentitySchema = z.object({
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
});

export const toggleFlagSchema = z.object({
  flagged: z.boolean(),
});

export const addNoteSchema = z.object({
  content: z.string().min(1),
  category: z.enum(['identity', 'date', 'transcription', 'relationship', 'context', 'cross-reference', 'location', 'condition']),
  priority: z.enum(['high', 'medium', 'low']),
});

export const updateNoteStatusSchema = z.object({
  status: z.enum(['dismissed', 'resolved']),
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

export const entityResolutionBodySchema = z.object({
  collectionCode: z.string().min(1),
});
