import { listCollections, type CollectionInfo } from "../../api/collections";

/** Fetch and normalize the current public collection list for navigation. */
export async function listNavigableCollections(): Promise<CollectionInfo[]> {
  const collections = await listCollections();

  return collections
    .filter((collection) => (collection.letterCount || 0) > 0)
    .sort((a, b) => {
      const aNumber = Number.parseInt(a.collectionCode, 10);
      const bNumber = Number.parseInt(b.collectionCode, 10);
      if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
        return aNumber - bNumber;
      }
      return a.collectionCode.localeCompare(b.collectionCode);
    });
}
