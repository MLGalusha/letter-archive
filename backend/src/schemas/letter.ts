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

export const archiveSearchQuerySchema = z.object({
  collection: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(24),
  search: z.string().trim().max(200).optional(),
  format: z.enum(archiveMediaTypes).optional(),
  person: z.string().trim().max(120).optional(),
  place: z.string().trim().max(120).optional(),
  year: z.coerce.number().int().min(0).max(9999).optional(),
  yearFrom: z.coerce.number().int().min(0).max(9999).optional(),
  yearTo: z.coerce.number().int().min(0).max(9999).optional(),
  verified: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(['relevance', 'createdAt', 'letterDate']).default('relevance'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ArchiveSearchQuery = z.infer<typeof archiveSearchQuerySchema>;
