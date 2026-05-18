export type VisibilityFilter = "ALL" | "PUBLISHED" | "HIDDEN";

export type DateMode = "specific" | "range";

export type ContentFilterView = "transcript" | "metadata" | "extras";

export type FlaggedFilter = "ALL" | "FLAGGED" | "UNFLAGGED";

export type DashboardView = "letters" | "collections";

export type ServerSortField =
  | "createdAt"
  | "updatedAt"
  | "lastOpenedAt"
  | "letterDate"
  | "sender"
  | "recipient"
  | "workflow"
  | "visibility"
  | "collection"
  | "flagged";

export type ClientSortField = "letters" | "extras" | "photos";

export type ExtendedSortField = ServerSortField | ClientSortField;

export type SortDirection = "asc" | "desc";

export interface SortColumn {
  field: ExtendedSortField;
  direction: SortDirection;
}

export interface SortInfo {
  direction: SortDirection;
  priority: number;
  total: number;
}

export type ColumnId =
  | "flag"
  | "sender"
  | "recipient"
  | "date"
  | "collection"
  | "letters"
  | "extras"
  | "photos"
  | "transcript"
  | "metadata"
  | "visibility"
  | "created"
  | "updated"
  | "lastOpened"
  | "type_letter"
  | "type_cover"
  | "type_telegram"
  | "type_photo"
  | "type_card"
  | "type_ephemera"
  | "type_voice"
  | "type_article"
  | "type_diary";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
}

export interface PersistedState {
  visibilityFilter: VisibilityFilter;
  collectionFilter: string;
  searchQuery: string;
  sortColumns: SortColumn[];
  dateMode: DateMode;
  year: number | null;
  month: number | null;
  day: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  transcriptStatusFilters: string[];
  metadataStatusFilters: string[];
  extraContentStatusFilters: string[];
  workflowFilters: string[];
  flaggedFilter: FlaggedFilter;
}

export interface DashboardViewState extends PersistedState {
  visibleColumns: ColumnId[];
  columnOrder: ColumnId[];
}

export interface SavedDashboardView {
  id: string;
  name: string;
  createdAt: string;
  state: DashboardViewState;
}

export interface PendingChange {
  sender?: string;
  recipient?: string;
}

export interface DashboardFilterStats {
  total: number;
  published: number;
  hidden: number;
  flagged: number;
  uploaded: number;
  transcribing: number;
  transcribed: number;
  metadataExtracting: number;
  metadataReady: number;
  reviewed: number;
  transcriptEmpty: number;
  transcriptAiDraft: number;
  transcriptEdited: number;
  transcriptVerified: number;
  metadataEmpty: number;
  metadataAiDraft: number;
  metadataEdited: number;
  metadataVerified: number;
  extraContentEmpty: number;
  extraContentAiDraft: number;
  extraContentEdited: number;
  extraContentVerified: number;
}
