import { useEffect, useState } from 'react';
import { getCachedCollections, listCollections, type CollectionInfo } from '../api/collections';

interface AdjacentCollections {
  prev: CollectionInfo | null;
  next: CollectionInfo | null;
}

/**
 * Computes the previous and next collection relative to `currentCode`,
 * with carousel wrapping (last → first, first → last).
 *
 * Uses the in-memory collection cache when available (warmed by Header
 * on mount) and falls back to a fresh API call.
 */
export default function useAdjacentCollections(
  currentCode: string | undefined,
): AdjacentCollections {
  const [result, setResult] = useState<AdjacentCollections>({ prev: null, next: null });

  useEffect(() => {
    if (!currentCode) {
      setResult({ prev: null, next: null });
      return;
    }

    let cancelled = false;

    function compute(collections: CollectionInfo[]) {
      // Only include collections that have published letters
      const valid = collections.filter((c) => (c.letterCount ?? 0) > 0);
      const idx = valid.findIndex((c) => c.collectionCode === currentCode);
      if (idx === -1 || valid.length < 2) {
        setResult({ prev: null, next: null });
        return;
      }
      const prev = valid[(idx - 1 + valid.length) % valid.length];
      const next = valid[(idx + 1) % valid.length];
      if (!cancelled) setResult({ prev, next });
    }

    const cached = getCachedCollections();
    if (cached) {
      compute(cached);
    } else {
      listCollections()
        .then((data) => { if (!cancelled) compute(data); })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [currentCode]);

  return result;
}
