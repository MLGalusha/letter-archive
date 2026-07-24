import { describe, expect, it } from 'vitest';
import {
  buildMetadataDocumentProjectionPatch,
  projectLegacyMetadata,
  projectStructuredMetadata,
} from '../letter/metadata-projection.js';

describe('structured metadata projection', () => {
  it('maps reviewer-facing flattened fields onto their structured keys', () => {
    expect(projectStructuredMetadata(
      {
        sender: 'Alice',
        recipient: 'Bob',
        location_written: 'Boston',
        primary_topics: ['old'],
        emotional_tone: 'hopeful',
        sender_recipient_relationship: 'friend',
        notable_quotes: [{ text: 'Preserved verbatim' }],
      },
      {
        sender: 'Alicia',
        locationWritten: null,
        summary: 'Reviewer summary',
        emotionalTone: 'nostalgic',
        senderRecipientRelationship: 'extended-family',
        primaryTopics: ['family/marriage'],
      },
    )).toEqual({
      sender: 'Alicia',
      recipient: 'Bob',
      location_written: null,
      summary: 'Reviewer summary',
      emotional_tone: 'nostalgic',
      sender_recipient_relationship: 'extended-family',
      primary_topics: ['family/marriage'],
      notable_quotes: [{ text: 'Preserved verbatim' }],
    });
  });

  it('does not invent a partial structured extraction for a prefill', () => {
    expect(projectStructuredMetadata(null, { sender: 'Alice' })).toBeNull();
  });

  it('preserves the historical camelCase document shape', () => {
    expect(projectLegacyMetadata(
      {
        locationWritten: 'Boston',
        tags: ['old'],
        emotionalTone: 'hopeful',
        senderRecipientRelationship: 'friend',
      },
      {
        locationWritten: 'Cambridge',
        emotionalTone: null,
        senderRecipientRelationship: 'professional',
        primaryTopics: ['work/employment'],
      },
    )).toEqual({
      locationWritten: 'Cambridge',
      tags: ['work/employment'],
      emotionalTone: null,
      senderRecipientRelationship: 'professional',
    });
  });

  it('does not promote a legacy-only document into the V2 column', () => {
    expect(buildMetadataDocumentProjectionPatch(
      {
        metadataV2Json: null,
        metadataJson: { locationWritten: 'Boston', tags: ['old'] },
      },
      { locationWritten: 'Cambridge', tags: ['family'] },
    )).toEqual({
      metadataJson: { locationWritten: 'Cambridge', tags: ['family'] },
    });
  });
});
