import type { WorkflowState } from "../../../types/Letter";
import type { ColumnDef, ColumnId, SortColumn } from "./types";

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
  "letters",
  "extras",
  "photos",
] as const;

export const DEFAULT_DASHBOARD_SORT: SortColumn = {
  field: "lastOpenedAt",
  direction: "desc",
};

export const ALL_COLUMNS: ColumnDef[] = [
  { id: "sender", label: "Sender", defaultVisible: true },
  { id: "recipient", label: "Recipient", defaultVisible: true },
  { id: "date", label: "Letter date", defaultVisible: true },
  { id: "collection", label: "Collection", defaultVisible: true },
  { id: "visibility", label: "Visibility", defaultVisible: true },
  { id: "flag", label: "Review flag", defaultVisible: true },
  { id: "transcript", label: "Transcript status", defaultVisible: true },
  { id: "metadata", label: "Metadata status", defaultVisible: true },
  { id: "lastOpened", label: "Last opened", defaultVisible: true },
  { id: "created", label: "Uploaded", defaultVisible: false },
  { id: "updated", label: "Last updated", defaultVisible: false },
  { id: "letters", label: "Letter pages", defaultVisible: true },
  { id: "extras", label: "Extra items", defaultVisible: true },
  { id: "photos", label: "Photo items", defaultVisible: false },
  { id: "type_letter", label: "Letter files", defaultVisible: false },
  { id: "type_cover", label: "Cover files", defaultVisible: false },
  { id: "type_telegram", label: "Telegram files", defaultVisible: false },
  { id: "type_photo", label: "Photo files", defaultVisible: false },
  { id: "type_card", label: "Card files", defaultVisible: false },
  { id: "type_ephemera", label: "Ephemera files", defaultVisible: false },
  { id: "type_voice", label: "Voice files", defaultVisible: false },
  { id: "type_article", label: "Article files", defaultVisible: false },
  { id: "type_diary", label: "Diary files", defaultVisible: false },
];

export const FILE_TYPE_COLUMNS: Array<{ id: ColumnId; label: string }> = [
  { id: "type_letter", label: "Letters" },
  { id: "type_cover", label: "Covers" },
  { id: "type_telegram", label: "Telegrams" },
  { id: "type_photo", label: "Photos" },
  { id: "type_card", label: "Cards" },
  { id: "type_ephemera", label: "Ephemera" },
  { id: "type_voice", label: "Voice" },
  { id: "type_article", label: "Articles" },
  { id: "type_diary", label: "Diary" },
];

export const VISIBILITY_FILTERS = [
  {
    value: "PUBLISHED",
    label: "Public",
    countKey: "published",
    className: "filter-published",
    title: "Published letters",
  },
  {
    value: "HIDDEN",
    label: "Hidden",
    countKey: "hidden",
    className: "filter-hidden",
    title: "Hidden letters",
  },
] as const;

export const FLAGGED_FILTERS = [
  {
    value: "FLAGGED",
    label: "Flagged",
    className: "filter-flagged",
    title: "Flagged letters",
  },
  {
    value: "UNFLAGGED",
    label: "Unflagged",
    className: "filter-unflagged",
    title: "Unflagged letters",
  },
] as const;

export const WORKFLOW_FILTERS: Array<{
  value: WorkflowState;
  label: string;
  title: string;
  countKey: "uploaded" | "transcribing" | "transcribed" | "metadataExtracting" | "metadataReady" | "reviewed";
  className: string;
}> = [
  {
    value: "UPLOADED",
    label: "Awaiting transcript",
    title: "Stored pipeline stage: uploaded and not yet transcribed.",
    countKey: "uploaded",
    className: "filter-uploaded",
  },
  {
    value: "TRANSCRIBING",
    label: "Transcribing now",
    title: "Stored pipeline stage: transcription is marked as in progress.",
    countKey: "transcribing",
    className: "filter-transcribing",
  },
  {
    value: "TRANSCRIBED",
    label: "Awaiting metadata",
    title: "Stored pipeline stage: transcript exists and metadata has not been drafted.",
    countKey: "transcribed",
    className: "filter-transcribed",
  },
  {
    value: "METADATA_EXTRACTING",
    label: "Extracting now",
    title: "Stored pipeline stage: metadata extraction is marked as in progress.",
    countKey: "metadataExtracting",
    className: "filter-metadata-extracting",
  },
  {
    value: "METADATA_DRAFTED",
    label: "Metadata drafted",
    title: "Stored pipeline stage: metadata draft exists and is ready for review.",
    countKey: "metadataReady",
    className: "filter-metadata-ready",
  },
  {
    value: "REVIEWED",
    label: "Reviewed",
    title: "Stored pipeline stage: letter has been marked reviewed.",
    countKey: "reviewed",
    className: "filter-reviewed",
  },
];

export const MISSING_FILTERS = [
  {
    value: "sender",
    label: "Missing sender",
    countKey: "missingSender",
    className: "filter-missing",
  },
  {
    value: "recipient",
    label: "Missing recipient",
    countKey: "missingRecipient",
    className: "filter-missing",
  },
  {
    value: "date",
    label: "Missing date",
    countKey: "missingDate",
    className: "filter-missing",
  },
] as const;

export const CONTENT_SHAPE_FILTERS = [
  {
    value: "extras",
    label: "Has extras",
    countKey: "hasExtras",
    className: "filter-content-shape",
  },
  {
    value: "photos",
    label: "Has photos",
    countKey: "hasPhotos",
    className: "filter-content-shape",
  },
  {
    value: "cover",
    label: "Has cover",
    countKey: "hasCover",
    className: "filter-content-shape",
  },
  {
    value: "telegram",
    label: "Has telegram",
    countKey: "hasTelegram",
    className: "filter-content-shape",
  },
] as const;

export const CONTENT_STATUS_FILTERS = [
  {
    value: "EMPTY",
    label: "None",
    countKeys: {
      transcript: "transcriptEmpty",
      metadata: "metadataEmpty",
      extras: "extraContentEmpty",
    },
    className: "filter-content-none",
  },
  {
    value: "AI_DRAFT",
    label: "Draft",
    countKeys: {
      transcript: "transcriptAiDraft",
      metadata: "metadataAiDraft",
      extras: "extraContentAiDraft",
    },
    className: "filter-content-draft",
  },
  {
    value: "EDITED",
    label: "Edited",
    countKeys: {
      transcript: "transcriptEdited",
      metadata: "metadataEdited",
      extras: "extraContentEdited",
    },
    className: "filter-content-edited",
  },
  {
    value: "VERIFIED",
    label: "Done",
    countKeys: {
      transcript: "transcriptVerified",
      metadata: "metadataVerified",
      extras: "extraContentVerified",
    },
    className: "filter-content-verified",
  },
] as const;

export const DEFAULT_VISIBLE_COLUMNS = new Set<ColumnId>(
  ALL_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.id),
);

export const DEFAULT_COLUMN_ORDER = ALL_COLUMNS.map((column) => column.id);

export const COLUMN_STORAGE_KEY = "adminDashboardColumns";

export const STORAGE_KEY = "adminDashboardState";

export const SAVED_VIEWS_STORAGE_KEY = "adminDashboardSavedViews";
