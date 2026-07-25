import { useState, useEffect } from "react";
import { getArchiveShelfItems, type ArchiveShelfResponse } from "../../api/letters";
import type { ArchiveShelfItem } from "../../types/Letter";

/** Resolved results — persists for the session */
const cache = new Map<string, ArchiveShelfItem[]>();

/** In-flight promises — prevents duplicate concurrent fetches */
const pending = new Map<string, Promise<ArchiveShelfItem[]>>();

function fetchCollection(collectionCode: string): Promise<ArchiveShelfItem[]> {
  // Already resolved
  if (cache.has(collectionCode)) return Promise.resolve(cache.get(collectionCode)!);

  // Already in-flight — join existing request
  if (pending.has(collectionCode)) return pending.get(collectionCode)!;

  // Start a new fetch
  const promise = (async () => {
    const items: ArchiveShelfItem[] = [];
    let page = 1;
    let totalPages: number;
    do {
      const res: ArchiveShelfResponse = await getArchiveShelfItems({
        collection: collectionCode,
        limit: 100,
        sort: "letterDate",
        sortOrder: "asc",
        page,
      });
      items.push(...res.letters);
      totalPages = Math.ceil(res.total / 100);
      page++;
    } while (page <= totalPages);

    cache.set(collectionCode, items);
    return items;
  })();

  pending.set(collectionCode, promise);
  promise.finally(() => pending.delete(collectionCode));

  return promise;
}

/**
 * Lazily fetches and caches the full letter list for a collection.
 * Deduplicates concurrent requests — no matter how many components
 * mount/unmount, only one HTTP request is in-flight per collection.
 * Returns `null` while loading.
 */
export default function useCollectionLetters(collectionCode: string): ArchiveShelfItem[] | null {
  const [loaded, setLoaded] = useState<{
    collectionCode: string;
    letters: ArchiveShelfItem[];
  } | null>(null);
  const letters = (
    cache.get(collectionCode)
    ?? (
      loaded?.collectionCode === collectionCode
        ? loaded.letters
        : null
    )
  );

  useEffect(() => {
    if (!collectionCode) return;
    if (cache.has(collectionCode)) return;

    let cancelled = false;

    fetchCollection(collectionCode)
      .then((items) => {
        if (!cancelled) {
          setLoaded({ collectionCode, letters: items });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [collectionCode]);

  return letters;
}
