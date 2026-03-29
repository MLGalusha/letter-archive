import { listCollections, type CollectionInfo } from "../../api/collections";

// Session-level cache shared across all consumers
let cachedCollections: CollectionInfo[] | null = null;
let pendingFetch: Promise<CollectionInfo[]> | null = null;

export function fetchAllCollections(): Promise<CollectionInfo[]> {
  if (cachedCollections) return Promise.resolve(cachedCollections);
  if (pendingFetch) return pendingFetch;
  pendingFetch = listCollections().then((result) => {
    const withLetters = result.filter((c) => (c.letterCount || 0) > 0);
    withLetters.sort((a, b) => {
      const aNum = parseInt(a.collectionCode, 10);
      const bNum = parseInt(b.collectionCode, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.collectionCode.localeCompare(b.collectionCode);
    });
    cachedCollections = withLetters;
    pendingFetch = null;
    return withLetters;
  }).catch((err) => {
    pendingFetch = null;
    throw err;
  });
  return pendingFetch;
}

export function getCachedCollections(): CollectionInfo[] | null {
  return cachedCollections;
}
