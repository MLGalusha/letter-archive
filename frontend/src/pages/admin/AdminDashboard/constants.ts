import type { ColumnDef, ColumnId } from "./types";

export const YEAR_OPTIONS = Array.from({ length: 151 }, (_, i) => 1800 + i);

export const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

export const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

export const SERVER_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "lastOpenedAt",
  "letterDate",
  "sender",
  "recipient",
  "workflow",
  "visibility",
  "collection",
  "flagged",
] as const;

export const ALL_COLUMNS: ColumnDef[] = [
  { id: "sender", label: "Sender", defaultVisible: true },
  { id: "recipient", label: "Recipient", defaultVisible: true },
  { id: "date", label: "Date", defaultVisible: true },
  { id: "collection", label: "Collection", defaultVisible: true },
  { id: "letters", label: "Letters", defaultVisible: true },
  { id: "extras", label: "Extras", defaultVisible: true },
  { id: "transcript", label: "Transcript", defaultVisible: true },
  { id: "metadata", label: "Metadata", defaultVisible: true },
  { id: "visibility", label: "Visibility", defaultVisible: true },
  { id: "created", label: "Created", defaultVisible: true },
  { id: "updated", label: "Updated", defaultVisible: false },
  { id: "lastOpened", label: "Last Opened", defaultVisible: false },
  { id: "flag", label: "Flag", defaultVisible: true },
];

export const DEFAULT_VISIBLE_COLUMNS = new Set<ColumnId>(
  ALL_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.id),
);

export const COLUMN_STORAGE_KEY = "adminDashboardColumns";

export const STORAGE_KEY = "adminDashboardState";
