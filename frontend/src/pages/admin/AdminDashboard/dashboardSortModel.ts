import type { ExtendedSortField, SortColumn, SortDirection } from "./types";

export const SORT_OPTIONS: Array<{
  value: ExtendedSortField;
  label: string;
  description: string;
}> = [
  { value: "lastOpenedAt", label: "Last opened", description: "Recent admin activity" },
  { value: "letterDate", label: "Letter date", description: "Historical letter date" },
  { value: "collection", label: "Collection", description: "Collection number" },
  { value: "createdAt", label: "Created", description: "Upload time" },
  { value: "updatedAt", label: "Updated", description: "Last record update" },
  { value: "sender", label: "Sender", description: "Sender name" },
  { value: "recipient", label: "Recipient", description: "Recipient name" },
  { value: "visibility", label: "Visibility", description: "Public or hidden state" },
  { value: "flagged", label: "Flagged", description: "Flagged state" },
  { value: "letters", label: "Letters", description: "Letter-page count" },
  { value: "extras", label: "Extras", description: "Extra-content count" },
  { value: "photos", label: "Photos", description: "Photo count" },
];

export type SortOption = (typeof SORT_OPTIONS)[number];

export function getSortButtonSummary(sortColumns: SortColumn[]): { label: string; detail?: string } {
  if (sortColumns.length === 0) {
    return { label: "Sort" };
  }

  if (sortColumns.length > 1) {
    return { label: `Sorted by ${sortColumns.length} rules` };
  }

  const [rule] = sortColumns;
  return {
    label: "Sort",
    detail: `${getFieldLabel(rule.field)}, ${getDirectionLabel(rule.field, rule.direction).toLowerCase()}`,
  };
}

export function areSortColumnsEqual(left: SortColumn[], right: SortColumn[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((column, index) => {
    const nextColumn = right[index];
    return nextColumn?.field === column.field && nextColumn.direction === column.direction;
  });
}

export function getDefaultDirection(field: ExtendedSortField): SortDirection {
  switch (field) {
    case "lastOpenedAt":
    case "createdAt":
    case "updatedAt":
    case "flagged":
    case "letters":
    case "extras":
    case "photos":
      return "desc";
    case "letterDate":
    case "sender":
    case "recipient":
    case "workflow":
    case "visibility":
    case "collection":
      return "asc";
  }
}

export function getDirectionLabel(field: ExtendedSortField, direction: SortDirection): string {
  if (field === "flagged") {
    return direction === "asc" ? "unflagged first" : "flagged first";
  }

  if (field === "letters" || field === "extras" || field === "photos") {
    return direction === "asc" ? "low to high" : "high to low";
  }

  switch (field) {
    case "lastOpenedAt":
    case "createdAt":
    case "updatedAt":
    case "letterDate":
      return direction === "asc" ? "oldest first" : "newest first";
    case "sender":
    case "recipient":
    case "collection":
      return direction === "asc" ? "A to Z" : "Z to A";
    case "visibility":
      return direction === "asc" ? "hidden first" : "public first";
    case "workflow":
      return direction === "asc" ? "earlier stage first" : "later stage first";
  }
}

export function getFieldLabel(field: ExtendedSortField): string {
  return SORT_OPTIONS.find((option) => option.value === field)?.label ?? field;
}
