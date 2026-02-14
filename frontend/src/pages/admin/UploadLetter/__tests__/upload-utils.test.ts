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

function makeImage(filename: string): UploadedImage {
  return {
    id: filename,
    file: new File(["x"], filename, { type: "image/jpeg" }),
    url: `blob:${filename}`,
    originalFilename: filename,
    parsed: parseFilename(filename),
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
});
