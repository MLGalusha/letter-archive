import { describe, expect, it } from 'vitest';
import { transcriptDigest } from '../../services/letter/metadata-input-identity.js';
import {
  emptyAdminLetterPageCounts,
  transformAdminLetterSummary,
  type AdminLetterSummarySource,
} from '../admin-letter-summary.dto.js';

function makeSource(
  overrides: Partial<AdminLetterSummarySource> = {},
): AdminLetterSummarySource {
  return {
    id: 'letter-1',
    collectionId: 'collection-1',
    dateRaw: '19470810',
    extractedDate: null,
    type: 'L',
    typeSequence: 1,
    sender: 'Alice',
    recipient: 'Bob',
    primarySourceRevision: 3,
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'AI_DRAFT',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'VERIFIED',
    photoDescriptionStatus: 'EMPTY',
    metadataStatus: 'PENDING',
    transcriptionText: 'Current transcript',
    transcriptConfirmedAt: null,
    flagged: true,
    createdAt: new Date('2026-07-24T12:00:00.000Z'),
    updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    collection: {
      collectionCode: '009',
      title: 'Family Letters',
    },
    ...overrides,
  };
}

describe('admin letter summary DTO', () => {
  it('defines one exact positive allowlist and omits detail-only source fields', () => {
    const source = {
      ...makeSource(),
      transcriptionJson: { pages: [{ private: true }] },
      metadataJson: { private: true },
      metadataV2Json: { private: true },
      aiNotes: [{ private: true }],
      readingText: 'private reading text',
      entityExtractionJson: { private: true },
      entityExtractionError: 'private error',
      transcriptConfirmationTranscriptDigest: transcriptDigest('stale transcript'),
      transcriptVerifiedBy: 'private reviewer',
      photoDescriptionContext: 'private prompt context',
      pages: [{ originalFilename: 'private.jpg' }],
    } as AdminLetterSummarySource;

    const result = transformAdminLetterSummary(
      source,
      {
        letter: 2,
        photo: 1,
        cover: 3,
        telegram: 4,
        card: 5,
        ephemera: 6,
        voice: 7,
        article: 8,
        diary: 9,
      },
      '2026-07-25T14:00:00.000Z',
    );

    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'extraContentStatus',
      'flagged',
      'id',
      'lastOpenedAt',
      'metadata',
      'metadataContentStatus',
      'metadataJobStatus',
      'metadataPublished',
      'pageCountsByType',
      'photoDescriptionStatus',
      'primaryImageType',
      'primarySourceRevision',
      'title',
      'transcriptConfirmed',
      'transcriptDigest',
      'transcriptPublished',
      'transcriptStatus',
      'updatedAt',
      'visibility',
      'collectionCode',
    ].sort());
    expect(Object.keys(result.metadata).sort()).toEqual([
      'dateRaw',
      'recipient',
      'sender',
    ]);
    expect(Object.keys(result.pageCountsByType).sort()).toEqual([
      'article',
      'card',
      'cover',
      'diary',
      'ephemera',
      'letter',
      'photo',
      'telegram',
      'voice',
    ]);

    for (const detailOnlyField of [
      'images',
      'transcript',
      'transcriptionText',
      'transcriptionJson',
      'metadataJson',
      'metadataV2Json',
      'aiNotes',
      'readingText',
      'entityExtractionJson',
      'entityExtractionError',
      'transcriptConfirmationTranscriptDigest',
      'transcriptVerifiedBy',
      'photoDescriptionContext',
      'pages',
    ]) {
      expect(result).not.toHaveProperty(detailOnlyField);
    }
  });

  it('uses the canonical digest of current raw transcript text', () => {
    const first = transformAdminLetterSummary(
      makeSource({ transcriptionText: 'first' }),
      emptyAdminLetterPageCounts(),
    );
    const changed = transformAdminLetterSummary(
      makeSource({ transcriptionText: 'second' }),
      emptyAdminLetterPageCounts(),
    );
    const empty = transformAdminLetterSummary(
      makeSource({ transcriptionText: null }),
      emptyAdminLetterPageCounts(),
    );

    expect(first.transcriptDigest).toBe(transcriptDigest('first'));
    expect(changed.transcriptDigest).toBe(transcriptDigest('second'));
    expect(changed.transcriptDigest).not.toBe(first.transcriptDigest);
    expect(empty.transcriptDigest).toBe(transcriptDigest(''));
  });

  it('derives confirmation only from the legacy-compatible confirmation timestamp', () => {
    const confirmed = transformAdminLetterSummary(
      makeSource({
        transcriptConfirmedAt: new Date('2026-07-25T12:00:00.000Z'),
      }),
      emptyAdminLetterPageCounts(),
    );
    const unconfirmed = transformAdminLetterSummary(
      makeSource({ transcriptConfirmedAt: null }),
      emptyAdminLetterPageCounts(),
    );

    expect(confirmed.transcriptConfirmed).toBe(true);
    expect(unconfirmed.transcriptConfirmed).toBe(false);
  });

  it('returns fresh zero-filled page-count owners and omits absent optional values', () => {
    const firstCounts = emptyAdminLetterPageCounts();
    const secondCounts = emptyAdminLetterPageCounts();
    firstCounts.letter = 1;

    expect(secondCounts).toEqual({
      letter: 0,
      photo: 0,
      cover: 0,
      telegram: 0,
      card: 0,
      ephemera: 0,
      voice: 0,
      article: 0,
      diary: 0,
    });

    const result = transformAdminLetterSummary(
      makeSource({ sender: null, recipient: null }),
      secondCounts,
    );
    expect(result.metadata).toEqual({ dateRaw: '19470810' });
    expect(result).not.toHaveProperty('lastOpenedAt');
  });
});
