import { describe, expect, it } from 'vitest';
import type { ArchiveSearchFacets } from '../../types/Letter';
import {
  createRememberedSearchFacets,
  mergeRememberedSearchFacets,
} from './rememberedSearchFacets';

function facets(
  overrides: Partial<ArchiveSearchFacets> = {},
): ArchiveSearchFacets {
  return {
    formats: [],
    collections: [],
    correspondents: [],
    places: [],
    years: [],
    topics: [],
    tones: [],
    relationships: [],
    ...overrides,
  };
}

describe('rememberedSearchFacets', () => {
  it('normalizes the remembered facet identities without mutating prior state', () => {
    const empty = createRememberedSearchFacets();

    const remembered = mergeRememberedSearchFacets(empty, facets({
      tones: [{ value: 'hopeful', count: 2 }],
      relationships: [{ value: 'romantic-partner', count: 3 }],
      topics: [
        { value: 'family/marriage', count: 4 },
        { value: 'family/separation-reunion', count: 1 },
        { value: '  /invalid', count: 1 },
      ],
      years: [{ value: 1947, count: 5 }],
    }));

    expect(empty.tones.size).toBe(0);
    expect(empty.relationships.size).toBe(0);
    expect(empty.topics.size).toBe(0);
    expect(empty.years.size).toBe(0);
    expect([...remembered.tones]).toEqual(['hopeful']);
    expect([...remembered.relationships]).toEqual(['romantic-partner']);
    expect([...remembered.topics]).toEqual(['family']);
    expect([...remembered.years]).toEqual([1947]);
  });

  it('returns the prior owner when a response contributes no new values', () => {
    const remembered = mergeRememberedSearchFacets(
      createRememberedSearchFacets(),
      facets({
        tones: [{ value: 'hopeful', count: 2 }],
        relationships: [{ value: 'friend', count: 3 }],
        topics: [{ value: 'family/marriage', count: 4 }],
        years: [{ value: 1947, count: 5 }],
      }),
    );

    const unchanged = mergeRememberedSearchFacets(remembered, facets({
      tones: [{ value: 'hopeful', count: 99 }],
      topics: [{ value: 'family/separation-reunion', count: 8 }],
    }));

    expect(unchanged).toBe(remembered);
  });

  it('adds later values while retaining all previously committed identities', () => {
    const first = mergeRememberedSearchFacets(
      createRememberedSearchFacets(),
      facets({
        tones: [{ value: 'hopeful', count: 2 }],
        relationships: [{ value: 'friend', count: 3 }],
        topics: [{ value: 'family/marriage', count: 4 }],
        years: [{ value: 1947, count: 5 }],
      }),
    );

    const expanded = mergeRememberedSearchFacets(first, facets({
      tones: [{ value: 'joyful', count: 1 }],
      relationships: [{ value: 'sibling', count: 1 }],
      topics: [{ value: 'work/career', count: 1 }],
      years: [{ value: 2000, count: 1 }],
    }));

    expect([...expanded.tones]).toEqual(['hopeful', 'joyful']);
    expect([...expanded.relationships]).toEqual(['friend', 'sibling']);
    expect([...expanded.topics]).toEqual(['family', 'work']);
    expect([...expanded.years]).toEqual([1947, 2000]);
  });
});
