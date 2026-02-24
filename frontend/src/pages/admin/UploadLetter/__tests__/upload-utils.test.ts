import { describe, expect, it } from "vitest";
import { parseFilename } from "../../../../utils/filename-parser";
import type { UploadedImage } from "../types";
import {
  formatDate,
  formatFileSize,
  generateId,
  generateNewFilename,
  getNextCollectionCode,
  groupImagesByCollection,
} from "../utils";

function makeImage(filename: string, overrides?: Partial<UploadedImage>): UploadedImage {
  return {
    id: filename,
    file: new File(["x"], filename, { type: "image/jpeg" }),
    url: `blob:${filename}`,
    originalFilename: filename,
    parsed: parseFilename(filename),
    isDuplicate: false,
    ...overrides,
  };
}

describe("upload utils", () => {
  it("groups and sorts images by collection and letter", () => {
    const grouped = groupImagesByCollection([
      makeImage("002-18860315-L01-02.jpg"),
      makeImage("002-18860315-C01-01.jpg"),
      makeImage("001-18860314-L01-01.jpg"),
      makeImage("001-18860314-E01-01.jpg"),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].collectionCode).toBe("001");
    expect(grouped[1].collectionCode).toBe("002");

    expect(grouped[0].letters).toHaveLength(1);
    expect(grouped[0].letters[0].letterPageCount).toBe(1);
    expect(grouped[0].letters[0].extraCount).toBe(1);
    expect(grouped[0].dateRange).toContain("1886");
  });

  it("returns next collection code with zero padding", () => {
    expect(getNextCollectionCode([])).toBe("001");
    expect(
      getNextCollectionCode([
        { collectionCode: "001", letters: [], totalImages: 0, dateRange: "Unknown" },
        { collectionCode: "012", letters: [], totalImages: 0, dateRange: "Unknown" },
      ]),
    ).toBe("013");
  });

  it("formats dates and file sizes", () => {
    expect(formatDate("1886-03-14")).toContain("1886");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("generates upload filenames from collection/type/page", () => {
    const filename = generateNewFilename("scan.png", "007", "L", 2, 5);
    expect(filename).toBe("007-XXXXXXXX-L02-05.png");
  });

  it("creates stable random-like IDs", () => {
    const id = generateId();
    expect(id).toHaveLength(9);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it("preserves isDuplicate in grouped images", () => {
    const grouped = groupImagesByCollection([
      makeImage("001-18860314-L01-01.jpg", { isDuplicate: true }),
      makeImage("001-18860314-L01-02.jpg", { isDuplicate: true }),
      makeImage("001-18860315-L01-01.jpg", { isDuplicate: false }),
    ]);

    expect(grouped).toHaveLength(1);
    const letters = grouped[0].letters;
    expect(letters).toHaveLength(2);

    // First letter (18860314) has 2 duplicate images
    const letter1 = letters.find(l => l.dateRaw.startsWith("18860314"));
    expect(letter1!.images).toHaveLength(2);
    expect(letter1!.images[0].isDuplicate).toBe(true);
    expect(letter1!.images[1].isDuplicate).toBe(true);

    // Second letter (18860315) has 1 non-duplicate image
    const letter2 = letters.find(l => l.dateRaw.startsWith("18860315"));
    expect(letter2!.images).toHaveLength(1);
    expect(letter2!.images[0].isDuplicate).toBe(false);
  });

  it("detects all-duplicate collection correctly", () => {
    const allDupImages = [
      makeImage("001-18860314-L01-01.jpg", { isDuplicate: true }),
      makeImage("001-18860315-L01-01.jpg", { isDuplicate: true }),
    ];

    const mixedImages = [
      makeImage("001-18860314-L01-01.jpg", { isDuplicate: true }),
      makeImage("001-18860315-L01-01.jpg", { isDuplicate: false }),
    ];

    const allDupCollections = groupImagesByCollection(allDupImages);
    const allImages1 = allDupCollections[0].letters.flatMap(l => l.images);
    expect(allImages1.every(img => img.isDuplicate)).toBe(true);

    const mixedCollections = groupImagesByCollection(mixedImages);
    const allImages2 = mixedCollections[0].letters.flatMap(l => l.images);
    expect(allImages2.every(img => img.isDuplicate)).toBe(false);
  });

  it("detects all-duplicate letter correctly", () => {
    const images = [
      makeImage("001-18860314-L01-01.jpg", { isDuplicate: true }),
      makeImage("001-18860314-L01-02.jpg", { isDuplicate: true }),
      makeImage("001-18860314-C01-01.jpg", { isDuplicate: true }),
    ];

    const groups = groupImagesByCollection(images);
    const letter = groups[0].letters[0];
    expect(letter.images.every(img => img.isDuplicate)).toBe(true);
  });

  it("one non-duplicate means letter is not all-duplicate", () => {
    const images = [
      makeImage("001-18860314-L01-01.jpg", { isDuplicate: true }),
      makeImage("001-18860314-L01-02.jpg", { isDuplicate: false }),
    ];

    const groups = groupImagesByCollection(images);
    const letter = groups[0].letters[0];
    expect(letter.images.every(img => img.isDuplicate)).toBe(false);
  });
});
