import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Letter, LetterMetadata } from '../../../../types/Letter';
import { useMetadataFormState } from '../useMetadataFormState';

function metadata(
  overrides: Partial<LetterMetadata> = {},
): LetterMetadata {
  return {
    verified: false,
    ...overrides,
  };
}

function letterMetadata(
  overrides: Partial<LetterMetadata> = {},
): Pick<Letter, 'metadata'> {
  return { metadata: metadata(overrides) };
}

describe('useMetadataFormState', () => {
  it('hydrates every form field with tagged display fallbacks', () => {
    const { result } = renderHook(() => useMetadataFormState());

    act(() => {
      result.current.applyLetterMetadata(letterMetadata({
        sender: 'Alice',
        recipient: 'Bob',
        extractedDate: '1932-07-07',
        location: 'Boston',
        hook: 'Plain hook',
        taggedHook: '«SENDER:Alice» wrote',
        description: 'Plain summary',
        taggedDescription: 'A note from «SENDER:Alice»',
        notes: 'Archivist note',
        emotionalTone: 'matter-of-fact',
        senderRecipientRelationship: 'parent-child',
        primaryTopics: ['family/marriage'],
      }));
    });

    expect(result.current).toMatchObject({
      sender: 'Alice',
      recipient: 'Bob',
      date: '1932-07-07',
      location: 'Boston',
      hook: '«SENDER:Alice» wrote',
      description: 'A note from «SENDER:Alice»',
      notes: 'Archivist note',
      emotionalTone: 'matter-of-fact',
      relationship: 'parent-child',
      primaryTopics: ['family/marriage'],
    });
  });

  it('synchronizes identity fields without replacing unrelated local drafts', () => {
    const { result } = renderHook(() => useMetadataFormState());

    act(() => {
      result.current.applyLetterMetadata(letterMetadata({
        sender: 'Alice',
        recipient: 'Bob',
        extractedDate: '1932-07-07',
        location: 'Boston',
        hook: 'Old hook',
        description: 'Old summary',
        notes: 'Old note',
        emotionalTone: 'sad',
        senderRecipientRelationship: 'friend',
        primaryTopics: ['travel'],
      }));
    });
    act(() => {
      result.current.setDate('Local date');
      result.current.setLocation('Local place');
      result.current.setNotes('Local note');
      result.current.setEmotionalTone('hopeful');
      result.current.setRelationship('sibling');
      result.current.setPrimaryTopics(['family/marriage']);
    });
    act(() => {
      result.current.syncIdentityMetadata(letterMetadata({
        sender: 'Alicia',
        recipient: 'Robert',
        extractedDate: 'Server date',
        location: 'Server place',
        hook: 'New hook',
        description: 'New summary',
        notes: 'Server note',
        emotionalTone: 'angry',
        senderRecipientRelationship: 'professional',
        primaryTopics: ['work'],
      }));
    });

    expect(result.current).toMatchObject({
      sender: 'Alicia',
      recipient: 'Robert',
      hook: 'New hook',
      description: 'New summary',
      date: 'Local date',
      location: 'Local place',
      notes: 'Local note',
      emotionalTone: 'hopeful',
      relationship: 'sibling',
      primaryTopics: ['family/marriage'],
    });
  });
});
