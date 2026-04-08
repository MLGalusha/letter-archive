import { useEffect, useState } from 'react';
import {
  fetchAllCollections,
  getCachedCollections,
} from '../components/CollectionHeaderDock/collectionCache';
import type { CollectionInfo } from '../api/collections';

interface AdjacentCollections {
  prev: CollectionInfo | null;
  next: CollectionInfo | null;
}

/**
 * Computes the previous and next collection relative to `currentCode`,
 * with carousel wrapping (last → first, first → last).
 *
 * Uses the same filtered + sorted collection cache as the header scrubber
 * so the ordering is consistent.
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
      if (cancelled) return;
      const idx = collections.findIndex((c) => c.collectionCode === currentCode);
      if (idx === -1 || collections.length < 2) {
        setResult({ prev: null, next: null });
        return;
      }
      setResult({
        prev: collections[(idx - 1 + collections.length) % collections.length],
        next: collections[(idx + 1) % collections.length],
      });
    }

    // Use the same cache as the collection scrubber (already filtered & sorted)
    const cached = getCachedCollections();
    if (cached) {
      compute(cached);
    } else {
      fetchAllCollections()
        .then(compute)
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [currentCode]);

  return result;
}
