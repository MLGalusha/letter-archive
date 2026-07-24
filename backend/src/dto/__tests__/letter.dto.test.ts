import { describe, expect, it } from 'vitest';
import {
  formatLetterDate,
  transformLetterToDTO,
  type LetterWithRelations,
} from '../letter.dto.js';

type LetterDateInput = Parameters<typeof formatLetterDate>[0];

function letterDateInput(
  extractedDate: string | null,
  dateRaw: string,
): LetterDateInput {
  return { extractedDate, dateRaw } as LetterDateInput;
}

describe('letter DTO date formatting', () => {
  it('prefers the reviewed extracted date over filename identity', () => {
    expect(formatLetterDate(
      letterDateInput('1886-03-14', '18860315'),
    )).toBe('March 14th, 1886');
  });

  it('falls back to the partial filename date without JavaScript Date parsing', () => {
    expect(formatLetterDate(
      letterDateInput(null, '1947XXXX'),
    )).toBe('1947');
  });

  it('falls back when a stored extracted date is not canonical ISO', () => {
    expect(formatLetterDate(
      letterDateInput('not-a-date', '18860315'),
    )).toBe('March 15th, 1886');
  });
});

describe('letter DTO metadata fidelity', () => {
  it('preserves authoritative empty strings for lossless version snapshots', () => {
    const letter = {
      id: 'letter-1',
      type: 'L',
      collection: {
        collectionCode: '001',
        title: 'Collection One',
      },
      pages: [],
      sender: '',
      recipient: '',
      locationWritten: '',
      hook: '',
      summary: '',
      extractedDate: null,
      dateRaw: '1947XXXX',
      dateConfidence: 'unknown',
      metadataV2Json: null,
      transcriptionText: null,
      transcriptionJson: null,
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EDITED',
      workflow: 'TRANSCRIBED',
      visibility: 'HIDDEN',
      transcriptPublished: false,
      metadataPublished: false,
      primarySourceRevision: 4,
      extraContentStatus: 'EMPTY',
      photoDescriptionStatus: 'EMPTY',
      flagged: false,
      createdAt: new Date('2026-07-24T12:00:00.000Z'),
    } as unknown as LetterWithRelations;

    expect(transformLetterToDTO(letter).metadata).toMatchObject({
      sender: '',
      recipient: '',
      location: '',
      hook: '',
      description: '',
    });
  });
});
