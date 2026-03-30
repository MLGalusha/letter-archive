import { ARCHIVE_FORMAT_LABELS, ARCHIVE_FORMAT_ORDER } from "../../components/SearchBar/searchBarUtils";
import type { Letter, LetterImageType } from "../../types/Letter";
import { getPrimaryMediaType } from "../../utils/letterPreview";

export type CollectionPickerFormat = LetterImageType | "all";
export type CollectionPickerSortField = "letterDate" | "sender" | "recipient";

export interface CollectionPickerState {
  search: string;
  format: CollectionPickerFormat;
  sort: CollectionPickerSortField;
  sortOrder: "asc" | "desc";
}

export interface CollectionPickerSortOption {
  value: CollectionPickerSortField;
  label: string;
  defaultOrder: CollectionPickerState["sortOrder"];
}

export interface CollectionPickerFormatOption {
  value: CollectionPickerFormat;
  label: string;
  count: number;
}

export const COLLECTION_PICKER_DEFAULT_SORT: CollectionPickerSortField = "letterDate";
export const COLLECTION_PICKER_DEFAULT_SORT_ORDER: CollectionPickerState["sortOrder"] = "desc";

export const COLLECTION_PICKER_SORT_OPTIONS: CollectionPickerSortOption[] = [
  { value: "letterDate", label: "Letter Date", defaultOrder: "desc" },
  { value: "sender", label: "Sender", defaultOrder: "asc" },
  { value: "recipient", label: "Recipient", defaultOrder: "asc" },
];

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function getLetterDateValue(letter: Letter) {
  const rawDate = normalizeText(letter.metadata.dateRaw);
  const rawDigits = rawDate.replace(/\D+/g, "");
  if (rawDigits) {
    return `0:${rawDigits.padEnd(14, "0")}`;
  }

  const displayDate = normalizeText(letter.metadata.date);
  if (!displayDate) return "";

  const parsedDate = Date.parse(displayDate);
  if (!Number.isNaN(parsedDate)) {
    return `1:${String(parsedDate).padStart(16, "0")}`;
  }

  return `2:${displayDate}`;
}

function getLetterSortValue(letter: Letter, sort: CollectionPickerSortField) {
  switch (sort) {
    case "sender":
      return normalizeText(letter.metadata.sender);
    case "recipient":
      return normalizeText(letter.metadata.recipient);
    case "letterDate":
    default:
      return getLetterDateValue(letter);
  }
}

function compareWithMissingLast(
  left: string,
  right: string,
  sortOrder: CollectionPickerState["sortOrder"],
) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return sortOrder === "asc"
    ? collator.compare(left, right)
    : collator.compare(right, left);
}

export function getLetterPickerMediaTypes(letter: Letter): LetterImageType[] {
  const mediaTypes = new Set<LetterImageType>();

  for (const image of letter.images) {
    mediaTypes.add(image.type);
  }

  if (mediaTypes.size === 0) {
    mediaTypes.add(getPrimaryMediaType(letter));
  }

  return Array.from(mediaTypes);
}

export function getCollectionPickerFormatOptions(letters: Letter[]): CollectionPickerFormatOption[] {
  const counts = new Map<LetterImageType, number>();

  for (const letter of letters) {
    const mediaTypes = getLetterPickerMediaTypes(letter);
    for (const mediaType of mediaTypes) {
      counts.set(mediaType, (counts.get(mediaType) || 0) + 1);
    }
  }

  const options: CollectionPickerFormatOption[] = [
    {
      value: "all",
      label: "All items",
      count: letters.length,
    },
  ];

  for (const mediaType of ARCHIVE_FORMAT_ORDER) {
    const count = counts.get(mediaType);
    if (!count) continue;
    options.push({
      value: mediaType,
      label: ARCHIVE_FORMAT_LABELS[mediaType],
      count,
    });
  }

  return options;
}

export function getCollectionPickerSortLabel(
  sort: CollectionPickerSortField,
  sortOrder: CollectionPickerState["sortOrder"],
) {
  switch (sort) {
    case "sender":
      return sortOrder === "asc" ? "Sender A-Z" : "Sender Z-A";
    case "recipient":
      return sortOrder === "asc" ? "Recipient A-Z" : "Recipient Z-A";
    case "letterDate":
    default:
      return sortOrder === "asc" ? "Oldest first" : "Newest first";
  }
}

function getSearchIndex(letter: Letter) {
  return [
    letter.title,
    letter.metadata.sender,
    letter.metadata.recipient,
    letter.metadata.date,
    letter.metadata.dateRaw,
    letter.metadata.hook,
    letter.metadata.description,
    letter.photoDescription,
    ...getLetterPickerMediaTypes(letter).map((mediaType) => ARCHIVE_FORMAT_LABELS[mediaType]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

export function filterAndSortCollectionPickerLetters(
  letters: Letter[],
  state: CollectionPickerState,
) {
  const query = state.search.trim().toLowerCase();
  const filtered = letters.filter((letter) => {
    if (state.format !== "all" && !getLetterPickerMediaTypes(letter).includes(state.format)) {
      return false;
    }

    if (!query) return true;

    return getSearchIndex(letter).includes(query);
  });

  return [...filtered].sort((left, right) => {
    const primaryComparison = compareWithMissingLast(
      getLetterSortValue(left, state.sort),
      getLetterSortValue(right, state.sort),
      state.sortOrder,
    );
    if (primaryComparison !== 0) return primaryComparison;

    const dateComparison = compareWithMissingLast(
      getLetterDateValue(left),
      getLetterDateValue(right),
      state.sort === "letterDate" ? state.sortOrder : COLLECTION_PICKER_DEFAULT_SORT_ORDER,
    );
    if (dateComparison !== 0) return dateComparison;

    return collator.compare(left.id, right.id);
  });
}
