import type { LetterWithRelations } from '../dto/index.js';

export type ArchiveSearchRow = {
  searchCaseMap?: Record<string, string> | null;
  searchWordMap?: Record<string, string[]> | null;
  normalizedSearch?: string | null;
  id: string;
  collectionId: string;
  collectionCode: string;
  collectionTitle: string | null;
  dateRaw: string;
  createdAt: Date | string;
  primaryType: LetterWithRelations['type'];
  primaryPageCount: number;
  sender: string | null;
  recipient: string | null;
  location: string | null;
  hook: string | null;
  metadataVerified: boolean;
  pageId: string | null;
  checksumSha256: string | null;
  formats: string[] | null;
  senders: string[] | null;
  recipients: string[] | null;
  places: string[] | null;
  hooks: string[] | null;
  summaries: string[] | null;
  tags: string[] | null;
  topics: string[] | null;
  tones: string[] | null;
  relationships: string[] | null;
  photoDescriptions: string[] | null;
  extraContentTranscripts: string[] | null;
  transcriptionTexts: string[] | null;
};
export type ArchiveSearchHighlightRange = { start: number; end: number };
export type ArchiveSearchPreview = { excerpt: string; matchCount: number; highlightRanges: ArchiveSearchHighlightRange[]; matchedFieldLabel: string };

export const MEDIA_COUNT_LABELS = {
  letter: ['page', 'pages'],
  photo: ['photo', 'photos'],
  ephemera: ['piece', 'pieces'],
  voice: ['recording', 'recordings'],
  article: ['article', 'articles'],
  diary: ['page', 'pages'],
  cover: ['cover', 'covers'],
  card: ['card', 'cards'],
  telegram: ['telegram', 'telegrams'],
} as const;

export function toIsoDateString(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
