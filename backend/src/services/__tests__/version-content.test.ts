import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EMOTIONAL_TONE_VALUES,
  RELATIONSHIP_TYPE_VALUES,
  canonicalizeMetadataVersionContent,
  canonicalizeTranscriptVersionContent,
  decodeMetadataVersionContent,
  decodeTranscriptVersionContent,
  metadataVersionMatchesCurrentContent,
  transcriptVersionMatchesCurrentContent,
  type MetadataVersionCandidateContent,
  type MetadataVersionContent,
  type TranscriptVersionCandidateContent,
  type TranscriptVersionContent,
} from '../letter/version-content.js';

function completeMetadata(
  overrides: Partial<MetadataVersionContent> = {},
): MetadataVersionContent {
  return {
    sender: 'Alice',
    recipient: 'Bob',
    locationWritten: 'Boston',
    hook: 'News from home',
    summary: 'Alice writes with family news.',
    extractedDate: '1944-02-29',
    emotionalTone: 'hopeful',
    senderRecipientRelationship: 'friend',
    primaryTopics: ['family/marriage', 'daily-life/household-social'],
    ...overrides,
  };
}

describe('transcript version content', () => {
  it('decodes both candidate shapes to one canonical shape without losing empty text', () => {
    expect(decodeTranscriptVersionContent('')).toEqual({
      ok: true,
      content: { text: '' },
    });
    expect(decodeTranscriptVersionContent({ text: 'Earlier transcript' })).toEqual({
      ok: true,
      content: { text: 'Earlier transcript' },
    });
  });

  it('fails closed for malformed stored transcript content', () => {
    for (const malformed of [
      null,
      42,
      [],
      {},
      { text: 42 },
      { transcript: 'wrong key' },
    ]) {
      expect(decodeTranscriptVersionContent(malformed)).toEqual({ ok: false });
    }
  });

  it('canonicalizes typed candidates and compares their exact text', () => {
    const candidates: TranscriptVersionCandidateContent[] = [
      'Earlier transcript',
      { text: 'Earlier transcript' },
    ];

    for (const candidate of candidates) {
      expect(canonicalizeTranscriptVersionContent(candidate)).toEqual({
        text: 'Earlier transcript',
      });
      expect(transcriptVersionMatchesCurrentContent('Earlier transcript', candidate)).toBe(true);
    }

    expect(transcriptVersionMatchesCurrentContent(null, '')).toBe(false);
    expect(transcriptVersionMatchesCurrentContent('', '')).toBe(true);
    expect(transcriptVersionMatchesCurrentContent('Current', 'Earlier')).toBe(false);
    expectTypeOf(canonicalizeTranscriptVersionContent(candidates[0]))
      .toEqualTypeOf<TranscriptVersionContent>();
  });
});

describe('metadata version content', () => {
  it('uses every current database tone and relationship value, including legacy values', () => {
    expect(EMOTIONAL_TONE_VALUES).toEqual([
      'joyful',
      'affectionate',
      'hopeful',
      'grateful',
      'matter-of-fact',
      'nostalgic',
      'anxious',
      'sad',
      'angry',
      'neutral',
      'desperate',
    ]);
    expect(RELATIONSHIP_TYPE_VALUES).toEqual([
      'spouse',
      'romantic-partner',
      'parent-child',
      'sibling',
      'extended-family',
      'friend',
      'acquaintance',
      'professional',
      'institutional',
      'unknown',
      'fiancé/fiancée',
      'parent',
      'child',
      'grandparent',
      'grandchild',
      'aunt/uncle',
      'nephew/niece',
      'cousin',
      'in-law',
      'business-associate',
      'employer',
      'employee',
    ]);

    expect(decodeMetadataVersionContent({
      emotionalTone: 'desperate',
      senderRecipientRelationship: 'fiancé/fiancée',
    })).toEqual({
      ok: true,
      content: {
        emotionalTone: 'desperate',
        senderRecipientRelationship: 'fiancé/fiancée',
      },
    });
  });

  it('decodes a legacy partial snapshot without inventing omitted fields', () => {
    const result = decodeMetadataVersionContent({
      hook: 'Earlier hook',
      ignoredFutureField: 'safe to ignore',
    });

    expect(result).toEqual({
      ok: true,
      content: { hook: 'Earlier hook' },
    });
    if (result.ok) {
      expect(Object.hasOwn(result.content, 'hook')).toBe(true);
      expect(Object.hasOwn(result.content, 'sender')).toBe(false);
      expectTypeOf(result.content).toEqualTypeOf<MetadataVersionCandidateContent>();
    }
  });

  it('preserves explicit nulls, empty strings, empty arrays, and ordered historical topics', () => {
    expect(decodeMetadataVersionContent({
      sender: '',
      recipient: null,
      primaryTopics: [],
    })).toEqual({
      ok: true,
      content: {
        sender: '',
        recipient: null,
        primaryTopics: [],
      },
    });

    expect(decodeMetadataVersionContent({
      primaryTopics: ['historical/custom', 'family/marriage', 'historical/custom'],
    })).toEqual({
      ok: true,
      content: {
        primaryTopics: ['historical/custom', 'family/marriage', 'historical/custom'],
      },
    });
  });

  it('accepts complete nine-field snapshots', () => {
    const snapshot = completeMetadata({
      sender: null,
      hook: '',
      emotionalTone: 'neutral',
      senderRecipientRelationship: 'business-associate',
    });

    expect(decodeMetadataVersionContent(snapshot)).toEqual({
      ok: true,
      content: snapshot,
    });
  });

  it('fails closed when no recognized field is present', () => {
    expect(decodeMetadataVersionContent({})).toEqual({ ok: false });
    expect(decodeMetadataVersionContent({ futureField: 'value' })).toEqual({ ok: false });
  });

  it('fails the whole decode when any recognized field is malformed', () => {
    for (const malformed of [
      null,
      [],
      'metadata',
      { sender: 42 },
      { hook: 'valid', recipient: undefined },
      { extractedDate: '' },
      { extractedDate: '1944-02-30' },
      { emotionalTone: 'calm' },
      { senderRecipientRelationship: 'neighbor' },
      { primaryTopics: 'family/marriage' },
      { primaryTopics: ['family/marriage', 42] },
      { hook: 'valid', primaryTopics: [42] },
    ]) {
      expect(decodeMetadataVersionContent(malformed)).toEqual({ ok: false });
    }

    const sparseTopics = new Array<string>(1);
    expect(decodeMetadataVersionContent({ primaryTopics: sparseTopics })).toEqual({ ok: false });
  });

  it('canonicalizes a locked row as a complete independent snapshot', () => {
    const lockedRow = completeMetadata({
      sender: null,
      hook: '',
      primaryTopics: ['second', 'first'],
    });
    const snapshot = canonicalizeMetadataVersionContent(lockedRow);

    expect(snapshot).toEqual({
      sender: null,
      recipient: 'Bob',
      locationWritten: 'Boston',
      hook: '',
      summary: 'Alice writes with family news.',
      extractedDate: '1944-02-29',
      emotionalTone: 'hopeful',
      senderRecipientRelationship: 'friend',
      primaryTopics: ['second', 'first'],
    });
    expect(snapshot).not.toBe(lockedRow);
    expect(snapshot.primaryTopics).not.toBe(lockedRow.primaryTopics);
    expectTypeOf(snapshot).toEqualTypeOf<MetadataVersionContent>();
  });

  it('matches only fields supplied by a candidate and compares topic order exactly', () => {
    const current = completeMetadata();

    expect(metadataVersionMatchesCurrentContent(current, { hook: current.hook })).toBe(true);
    expect(metadataVersionMatchesCurrentContent(current, { hook: null })).toBe(false);
    expect(metadataVersionMatchesCurrentContent(current, {
      sender: current.sender,
      primaryTopics: [...(current.primaryTopics ?? [])],
    })).toBe(true);
    expect(metadataVersionMatchesCurrentContent(current, {
      primaryTopics: ['daily-life/household-social', 'family/marriage'],
    })).toBe(false);
    expect(metadataVersionMatchesCurrentContent(
      completeMetadata({ primaryTopics: null }),
      { primaryTopics: null },
    )).toBe(true);
  });
});
