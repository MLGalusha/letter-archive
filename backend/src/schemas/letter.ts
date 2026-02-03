import { z } from 'zod';

export const letterQuerySchema = z.object({
  collection: z.string().optional(),
  visibility: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
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
