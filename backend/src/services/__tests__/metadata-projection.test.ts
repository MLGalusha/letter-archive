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
        notable_quotes: [{ text: 'Preserved verbatim' }],
      },
      {
        sender: 'Alicia',
        locationWritten: null,
        summary: 'Reviewer summary',
        tags: ['family'],
      },
    )).toEqual({
      sender: 'Alicia',
      recipient: 'Bob',
      location_written: null,
      summary: 'Reviewer summary',
      primary_topics: ['family'],
      notable_quotes: [{ text: 'Preserved verbatim' }],
    });
  });

  it('does not invent a partial structured extraction for a prefill', () => {
    expect(projectStructuredMetadata(null, { sender: 'Alice' })).toBeNull();
  });

  it('preserves the historical camelCase document shape', () => {
    expect(projectLegacyMetadata(
      { locationWritten: 'Boston', tags: ['old'] },
      { locationWritten: 'Cambridge', tags: ['family'] },
    )).toEqual({
      locationWritten: 'Cambridge',
      tags: ['family'],
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
