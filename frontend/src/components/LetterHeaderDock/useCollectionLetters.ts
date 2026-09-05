import { useState, useEffect } from "react";
import { getArchiveShelfItems, type ArchiveShelfResponse } from "../../api/letters";
import type { ArchiveShelfItem } from "../../types/Letter";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_COLLECTIONS = 10;
const cache = new Map<string, { items: ArchiveShelfItem[]; expiresAt: number }>();

function cachedItems(code: string): ArchiveShelfItem[] | undefined {
  const entry = cache.get(code);
  return entry && entry.expiresAt > Date.now() ? entry.items : undefined;
}

/** In-flight promises — prevents duplicate concurrent fetches */
const pending = new Map<string, Promise<ArchiveShelfItem[]>>();

function fetchCollection(collectionCode: string): Promise<ArchiveShelfItem[]> {
  // Already resolved
  const cached = cachedItems(collectionCode);
  if (cached) return Promise.resolve(cached);

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

    cache.delete(collectionCode);
    cache.set(collectionCode, { items, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > MAX_CACHED_COLLECTIONS) cache.delete(cache.keys().next().value!);
    return items;
  })().finally(() => pending.delete(collectionCode));

  pending.set(collectionCode, promise);

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
    cachedItems(collectionCode)
    ?? (
      loaded?.collectionCode === collectionCode
        ? loaded.letters
        : null
    )
  );

  useEffect(() => {
    if (!collectionCode) return;
    if (cachedItems(collectionCode)) return;

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
