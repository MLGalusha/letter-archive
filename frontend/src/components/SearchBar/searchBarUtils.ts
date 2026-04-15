import type { LetterImageType } from "../../types/Letter";
import type { SearchFilters } from "./SearchBar";

export type SortFieldOption = {
  value: NonNullable<SearchFilters["sort"]>;
  label: string;
  defaultOrder: NonNullable<SearchFilters["sortOrder"]>;
};

export type FilterSuggestion = {
  display: string;
  applyValue: string;
  count: number;
};

export type FilterChoiceOption = {
  value: string;
  label: string;
  count?: number;
  aliases?: string[];
};

export type CombinedSortOption = {
  label: string;
  sort: NonNullable<SearchFilters["sort"]>;
  defaultOrder: NonNullable<SearchFilters["sortOrder"]>;
  canToggle?: boolean;
};

export const SORT_FIELD_OPTIONS: SortFieldOption[] = [
  { label: "Best Match", value: "relevance", defaultOrder: "desc" },
  { label: "Publish Date", value: "createdAt", defaultOrder: "desc" },
  { label: "Date", value: "letterDate", defaultOrder: "desc" },
  { label: "Sender", value: "sender", defaultOrder: "asc" },
  { label: "Recipient", value: "recipient", defaultOrder: "asc" },
  { label: "Collection", value: "collection", defaultOrder: "asc" },
];

export const COMBINED_SORT_OPTIONS: CombinedSortOption[] = [
  { label: "Best Match", sort: "relevance", defaultOrder: "desc" },
  { label: "Date", sort: "letterDate", defaultOrder: "desc", canToggle: true },
  { label: "Date Added", sort: "createdAt", defaultOrder: "desc", canToggle: true },
  { label: "Sender", sort: "sender", defaultOrder: "asc", canToggle: true },
  { label: "Recipient", sort: "recipient", defaultOrder: "asc", canToggle: true },
  { label: "Collection", sort: "collection", defaultOrder: "asc", canToggle: true },
];

export const REFINE_CLOSE_DELAY_MS = 300;

export const ARCHIVE_FORMAT_ORDER: LetterImageType[] = [
  "letter",
  "photo",
  "telegram",
  "cover",
  "card",
  "ephemera",
  "article",
  "diary",
  "voice",
];

export const ARCHIVE_FORMAT_LABELS: Record<LetterImageType, string> = {
  letter: "Letters",
  photo: "Photos",
  telegram: "Telegrams",
  cover: "Covers",
  card: "Cards",
  ephemera: "Ephemera",
  article: "Articles",
  diary: "Diary",
  voice: "Voice",
};

export function getSortValue(option: SortFieldOption) {
  return option.value;
}

export function parseSortValue(value: string, options: SortFieldOption[]) {
  return options.find((option) => option.value === value) || null;
}

export function getSortDirectionAriaLabel(
  sort: NonNullable<SearchFilters["sort"]>,
  sortOrder: NonNullable<SearchFilters["sortOrder"]>,
) {
  switch (sort) {
    case "letterDate":
      return sortOrder === "asc" ? "Oldest letter first" : "Newest letter first";
    case "createdAt":
      return sortOrder === "asc" ? "Oldest published first" : "Newest published first";
    case "sender":
    case "recipient":
    case "collection":
      return sortOrder === "asc" ? "A to Z" : "Z to A";
    case "relevance":
    default:
      return "Best match";
  }
}

export function getSortDirectionDisplayLabel(
  sort: NonNullable<SearchFilters["sort"]>,
  sortOrder: NonNullable<SearchFilters["sortOrder"]>,
) {
  switch (sort) {
    case "sender":
    case "recipient":
    case "collection":
      return sortOrder === "asc" ? "A \u2192 Z" : "Z \u2192 A";
    case "letterDate":
    case "createdAt":
      return sortOrder === "asc" ? "\u2191" : "\u2193";
    case "relevance":
    default:
      return "\u2014";
  }
}

export function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatFacetLabel(value: string) {
  return value
    .split("/")
    .map((part) => toTitleCase(part.replace(/[-_]+/g, " ").trim()))
    .join(" / ");
}

export function normalizeSuggestionText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function scoreSuggestionText(needle: string, alias: string) {
  const normalizedNeedle = normalizeSuggestionText(needle);
  const normalizedAlias = normalizeSuggestionText(alias);
  if (!normalizedNeedle || !normalizedAlias) return 0;
  if (normalizedAlias === normalizedNeedle) return 500;
  if (normalizedAlias.startsWith(normalizedNeedle)) return 420 - normalizedAlias.length;
  const wordMatch = normalizedAlias
    .split(" ")
    .some((part) => part.startsWith(normalizedNeedle));
  if (wordMatch) return 320;
  if (normalizedAlias.includes(normalizedNeedle)) return 220;
  return 0;
}

export function getBestSuggestion(
  inputValue: string | null | undefined,
  candidates: Array<{ value: string; display: string; count: number; aliases?: string[] }>,
): FilterSuggestion | null {
  if (!inputValue?.trim()) return null;

  let bestMatch: (FilterSuggestion & { score: number }) | null = null;

  for (const candidate of candidates) {
    const aliases = [candidate.display, candidate.value, ...(candidate.aliases || [])];
    const score = Math.max(...aliases.map((alias) => scoreSuggestionText(inputValue, alias)));
    if (score <= 0) continue;

    if (
      !bestMatch
      || score > bestMatch.score
      || (score === bestMatch.score && candidate.count > bestMatch.count)
    ) {
      bestMatch = {
        display: candidate.display,
        applyValue: candidate.value,
        count: candidate.count,
        score,
      };
    }
  }

  if (!bestMatch) return null;
  return {
    display: bestMatch.display,
    applyValue: bestMatch.applyValue,
    count: bestMatch.count,
  };
}

export function filterChoiceOptions(options: FilterChoiceOption[], query: string) {
  const needle = normalizeSuggestionText(query);
  if (!needle) return options;

  return options.filter((option) => {
    const haystacks = [option.label, option.value, ...(option.aliases || [])];
    return haystacks.some((haystack) => normalizeSuggestionText(haystack).includes(needle));
  });
}
