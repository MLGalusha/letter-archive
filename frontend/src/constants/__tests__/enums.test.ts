import { describe, expect, it } from 'vitest';
import {
  EMOTIONAL_TONE_OPTIONS,
  METADATA_RELATIONSHIP_OPTIONS,
  PERSON_RELATIONSHIP_OPTIONS,
  PERSON_ROLE_OPTIONS,
  PLACE_ROLE_OPTIONS,
  PLACE_TYPE_OPTIONS,
  PRIMARY_TOPIC_OPTIONS,
} from '../enums';

describe('shared enum options', () => {
  it('has unique values for all option lists', () => {
    const lists = [
      EMOTIONAL_TONE_OPTIONS,
      METADATA_RELATIONSHIP_OPTIONS,
      PERSON_RELATIONSHIP_OPTIONS,
      PERSON_ROLE_OPTIONS,
      PLACE_ROLE_OPTIONS,
      PLACE_TYPE_OPTIONS,
    ];

    for (const list of lists) {
      const values = list.map((item) => item.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('keeps expected baseline vocab entries', () => {
    expect(PERSON_RELATIONSHIP_OPTIONS.some((o) => o.value === 'unknown')).toBe(true);
    expect(METADATA_RELATIONSHIP_OPTIONS.some((o) => o.value === 'spouse')).toBe(true);
    expect(EMOTIONAL_TONE_OPTIONS.some((o) => o.value === 'neutral')).toBe(true);
    expect(PLACE_ROLE_OPTIONS.some((o) => o.value === 'written_from')).toBe(true);
    expect(PRIMARY_TOPIC_OPTIONS.length).toBeGreaterThan(20);
  });
});
