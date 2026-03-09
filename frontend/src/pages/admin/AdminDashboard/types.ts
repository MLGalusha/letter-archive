export type VisibilityFilter = "ALL" | "PUBLISHED" | "HIDDEN";

export type DateMode = "specific" | "range";

export type ContentFilterView = "transcript" | "metadata";

export type ServerSortField =
  | "createdAt"
  | "updatedAt"
  | "lastOpenedAt"
  | "letterDate"
  | "sender"
  | "recipient"
  | "workflow"
  | "visibility"
  | "collection";

export type ClientSortField = "letters" | "extras";

export type ExtendedSortField = ServerSortField | ClientSortField;

export type SortDirection = "asc" | "desc";

export interface SortColumn {
  field: ExtendedSortField;
  direction: SortDirection;
}

export type ColumnId =
  | "flag"
  | "sender"
  | "recipient"
  | "date"
  | "collection"
  | "letters"
  | "extras"
  | "transcript"
  | "metadata"
  | "visibility"
  | "created"
  | "updated"
  | "lastOpened"
  | "sync";

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
}

export interface PendingChange {
  sender?: string;
  recipient?: string;
}
