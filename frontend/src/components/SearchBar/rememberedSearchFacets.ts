import { useState } from 'react';
import type { ArchiveSearchFacets } from '../../types/Letter';

type RememberedFacetSource = Pick<
  ArchiveSearchFacets,
  'relationships' | 'tones' | 'topics' | 'years'
>;

export interface RememberedSearchFacets {
  relationships: ReadonlySet<string>;
  tones: ReadonlySet<string>;
  topics: ReadonlySet<string>;
  years: ReadonlySet<number>;
}

export function createRememberedSearchFacets(): RememberedSearchFacets {
  return {
    relationships: new Set(),
    tones: new Set(),
    topics: new Set(),
    years: new Set(),
  };
}

function mergeValues<T>(
  remembered: ReadonlySet<T>,
  values: Iterable<T>,
): ReadonlySet<T> {
  let merged: Set<T> | null = null;

  for (const value of values) {
    if ((merged ?? remembered).has(value)) continue;
    if (!merged) {
      merged = new Set(remembered);
    }
    merged.add(value);
  }

  return merged ?? remembered;
}

function topicCategories(
  facets: RememberedFacetSource['topics'],
): string[] {
  return facets
    .map((facet) => facet.value.split('/')[0].trim())
    .filter(Boolean);
}

export function mergeRememberedSearchFacets(
  remembered: RememberedSearchFacets,
  facets: RememberedFacetSource,
): RememberedSearchFacets {
  const relationships = mergeValues(
    remembered.relationships,
    facets.relationships.map((facet) => facet.value),
  );
  const tones = mergeValues(
    remembered.tones,
    facets.tones.map((facet) => facet.value),
  );
  const topics = mergeValues(
    remembered.topics,
    topicCategories(facets.topics),
  );
  const years = mergeValues(
    remembered.years,
    facets.years.map((facet) => facet.value),
  );

  if (
    relationships === remembered.relationships
    && tones === remembered.tones
    && topics === remembered.topics
    && years === remembered.years
  ) {
    return remembered;
  }

  return { relationships, tones, topics, years };
}

/**
 * Remembers values from committed facet responses for one mounted SearchBar.
 *
 * A new value triggers React's supported render-time state adjustment, which restarts
 * this component before commit. An abandoned render cannot mutate the prior state,
 * while a current choice still appears in the first committed UI.
 */
export function useRememberedSearchFacets(
  facets: RememberedFacetSource,
): RememberedSearchFacets {
  const [remembered, setRemembered] = useState(
    () => mergeRememberedSearchFacets(
      createRememberedSearchFacets(),
      facets,
    ),
  );
  const rendered = mergeRememberedSearchFacets(remembered, facets);

  if (rendered !== remembered) {
    setRemembered(rendered);
  }

  return rendered;
}
