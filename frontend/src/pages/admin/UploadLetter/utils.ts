import { getFileExtension } from "../../../utils/filename-parser";
import type { CollectionGroup, LetterGroup, UploadedImage } from "./types";

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function groupImagesByCollection(
  images: UploadedImage[],
): CollectionGroup[] {
  const collectionMap = new Map<string, UploadedImage[]>();

  for (const image of images) {
    if (!image.parsed) continue;
    const collectionCode = image.parsed.collectionCode;
    const existing = collectionMap.get(collectionCode) || [];
    existing.push(image);
    collectionMap.set(collectionCode, existing);
  }

  const groups: CollectionGroup[] = [];

  for (const [collectionCode, collectionImages] of collectionMap) {
    const letterMap = new Map<string, UploadedImage[]>();

    for (const image of collectionImages) {
      if (!image.parsed) continue;

      const dateKey = `${image.parsed.dateRaw}-${String(image.parsed.typeSequence).padStart(2, "0")}`;
      const existing = letterMap.get(dateKey) || [];
      existing.push(image);
      letterMap.set(dateKey, existing);
    }

    const letters: LetterGroup[] = [];

    for (const [dateKey, letterImages] of letterMap) {
      const firstParsed = letterImages[0].parsed!;
      const letterPageCount = letterImages.filter(
        (image) => image.parsed?.type === "L",
      ).length;
      const extraCount = letterImages.length - letterPageCount;

      letters.push({
        letterKey: dateKey,
        dateRaw: dateKey,
        letterDate: firstParsed.letterDate,
        letterPageCount,
        extraCount,
        images: letterImages.sort((a, b) => {
          const aType = a.parsed?.type || "Z";
          const bType = b.parsed?.type || "Z";

          if (aType !== bType) {
            if (aType === "L") return -1;
            if (bType === "L") return 1;
            return aType.localeCompare(bType);
          }

          const aSequence = a.parsed?.typeSequence || 0;
          const bSequence = b.parsed?.typeSequence || 0;
          if (aSequence !== bSequence) return aSequence - bSequence;

          return (a.parsed?.pageNumber || 0) - (b.parsed?.pageNumber || 0);
        }),
      });
    }

    letters.sort((a, b) => a.dateRaw.localeCompare(b.dateRaw));

    let dateRange = "Unknown";
    const knownDates = letters
      .filter((letter) => letter.letterDate !== null)
      .map((letter) => letter.letterDate as string)
      .sort();

    if (knownDates.length > 0) {
      dateRange =
        knownDates.length === 1
          ? knownDates[0]
          : `${knownDates[0]} - ${knownDates[knownDates.length - 1]}`;
    }

    groups.push({
      collectionCode,
      letters,
      totalImages: collectionImages.length,
      dateRange,
    });
  }

  return groups.sort((a, b) => a.collectionCode.localeCompare(b.collectionCode));
}

export function getNextCollectionCode(collections: CollectionGroup[]): string {
  if (collections.length === 0) return "001";
  const maxCode = Math.max(
    ...collections.map((collection) => parseInt(collection.collectionCode, 10)),
  );
  return String(maxCode + 1).padStart(3, "0");
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const base = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(base));
  return `${parseFloat((bytes / Math.pow(base, index)).toFixed(1))} ${sizes[index]}`;
}

export function generateNewFilename(
  originalFilename: string,
  collectionCode: string,
  type: string,
  typeSequence: number,
  pageNumber: number,
): string {
  const extension = getFileExtension(originalFilename);
  const typeSequenceLabel = String(typeSequence).padStart(2, "0");
  const pageLabel = String(pageNumber).padStart(2, "0");
  return `${collectionCode}-XXXXXXXX-${type}${typeSequenceLabel}-${pageLabel}.${extension}`;
}
