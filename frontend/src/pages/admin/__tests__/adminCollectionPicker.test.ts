import { describe, expect, it } from "vitest";
import type { Letter, LetterImageType } from "../../../types/Letter";
import {
  filterAndSortCollectionPickerLetters,
  getCollectionPickerFormatOptions,
  getCollectionPickerSortLabel,
} from "../adminCollectionPicker";

function makeLetter(params: {
  id: string;
  sender?: string;
  recipient?: string;
  dateRaw?: string;
  hook?: string;
  mediaTypes?: LetterImageType[];
  photoDescription?: string;
}): Letter {
  const mediaTypes = params.mediaTypes ?? ["letter"];

  return {
    id: params.id,
    title: `Letter ${params.id}`,
    collectionCode: "009",
    images: mediaTypes.map((type, index) => ({
      id: `${params.id}-${type}-${index}`,
      type,
      imageUrl: `${params.id}-${type}.jpg`,
    })),
    transcript: { pages: [], fullText: "", verified: false },
    metadata: {
      sender: params.sender,
      recipient: params.recipient,
      dateRaw: params.dateRaw,
      hook: params.hook,
      verified: false,
    },
    status: "uploaded",
    workflowState: "UPLOADED",
    visibility: "HIDDEN",
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: "EMPTY",
    metadataContentStatus: "EMPTY",
    extraContentStatus: "EMPTY",
    photoDescription: params.photoDescription,
    createdAt: "2026-03-29T12:00:00.000Z",
    flagged: false,
  };
}

describe("adminCollectionPicker", () => {
  it("builds format options from media present in the collection", () => {
    const letters = [
      makeLetter({ id: "1", mediaTypes: ["letter", "photo"] }),
      makeLetter({ id: "2", mediaTypes: ["photo"] }),
      makeLetter({ id: "3", mediaTypes: ["telegram"] }),
    ];

    expect(getCollectionPickerFormatOptions(letters)).toEqual([
      { value: "all", label: "All items", count: 3 },
      { value: "letter", label: "Letters", count: 1 },
      { value: "photo", label: "Photos", count: 2 },
      { value: "telegram", label: "Telegrams", count: 1 },
    ]);
  });

  it("filters by search and selected media type", () => {
    const letters = [
      makeLetter({
        id: "letter-1",
        sender: "Alice",
        recipient: "Bob",
        dateRaw: "19470301",
        mediaTypes: ["photo"],
        photoDescription: "Bridge portrait",
      }),
      makeLetter({
        id: "letter-2",
        sender: "Cara",
        recipient: "Dan",
        dateRaw: "19470401",
        mediaTypes: ["letter"],
        hook: "Garden update",
      }),
    ];

    const results = filterAndSortCollectionPickerLetters(letters, {
      search: "bridge",
      format: "photo",
      sort: "letterDate",
      sortOrder: "desc",
    });

    expect(results.map((letter) => letter.id)).toEqual(["letter-1"]);
  });

  it("sorts by the requested field and order", () => {
    const letters = [
      makeLetter({ id: "b", sender: "Mabel", dateRaw: "19470102" }),
      makeLetter({ id: "a", sender: "Alice", dateRaw: "19470304" }),
      makeLetter({ id: "c", sender: "Zora", dateRaw: "19470203" }),
    ];

    expect(
      filterAndSortCollectionPickerLetters(letters, {
        search: "",
        format: "all",
        sort: "sender",
        sortOrder: "asc",
      }).map((letter) => letter.id),
    ).toEqual(["a", "b", "c"]);

    expect(
      filterAndSortCollectionPickerLetters(letters, {
        search: "",
        format: "all",
        sort: "letterDate",
        sortOrder: "desc",
      }).map((letter) => letter.id),
    ).toEqual(["a", "c", "b"]);
  });

  it("returns compact sort labels for the admin toolbar", () => {
    expect(getCollectionPickerSortLabel("letterDate", "desc")).toBe("Newest first");
    expect(getCollectionPickerSortLabel("sender", "asc")).toBe("Sender A-Z");
    expect(getCollectionPickerSortLabel("recipient", "desc")).toBe("Recipient Z-A");
  });
});
