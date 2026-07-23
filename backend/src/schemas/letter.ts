import { z } from 'zod';

export const letterQuerySchema = z.object({
  collection: z.string().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  workflow: z
    .enum([
      'UPLOADED',
      'TRANSCRIBING',
      'TRANSCRIBED',
      'METADATA_EXTRACTING',
      'METADATA_DRAFTED',
      'REVIEWED',
    ])
    .optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort: z.enum(['createdAt', 'letterDate', 'sender', 'title', 'workflow', 'visibility']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type LetterQuery = z.infer<typeof letterQuerySchema>;

/**
 * Public archive routes may only query the published catalogue. Internal
 * workflow is intentionally absent, and public sorting cannot use workflow or
 * visibility as an oracle for unpublished state.
 */
export const publicLetterQuerySchema = letterQuerySchema
  .omit({ visibility: true, workflow: true, sort: true })
  .extend({
    visibility: z.literal('PUBLISHED').default('PUBLISHED'),
    sort: z.enum(['createdAt', 'letterDate', 'sender']).default('createdAt'),
  })
  .strict();

export type PublicLetterQuery = z.infer<typeof publicLetterQuerySchema>;

const archiveMediaTypes = [
  'letter',
  'photo',
  'ephemera',
  'voice',
  'article',
  'diary',
  'cover',
  'card',
  'telegram',
] as const;

const archivePersonRoles = ['any', 'sender', 'recipient'] as const;

const archiveSearchSorts = [
  'relevance',
  'createdAt',
  'letterDate',
  'sender',
  'recipient',
  'collection',
] as const;

export const archiveSearchQuerySchema = z.object({
  collection: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(24),
  search: z.string().trim().max(200).optional(),
  format: z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) return [value];
    return undefined;
  }, z.array(z.enum(archiveMediaTypes)).min(1).optional()),
  person: z.string().trim().max(120).optional(),
  personRole: z.enum(archivePersonRoles).default('any'),
  sender: z.string().trim().max(120).optional(),
  recipient: z.string().trim().max(120).optional(),
  place: z.string().trim().max(120).optional(),
  topic: z.string().trim().max(120).optional(),
  tone: z.string().trim().max(80).optional(),
  relationship: z.string().trim().max(80).optional(),
  year: z.coerce.number().int().min(0).max(9999).optional(),
  yearFrom: z.coerce.number().int().min(0).max(9999).optional(),
  yearTo: z.coerce.number().int().min(0).max(9999).optional(),
  hasTranscript: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  verified: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(archiveSearchSorts).default('relevance'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ArchiveSearchQuery = z.infer<typeof archiveSearchQuerySchema>;
