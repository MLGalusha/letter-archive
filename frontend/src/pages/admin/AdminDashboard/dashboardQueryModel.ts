import type { AdminLetterQueryParams } from "../../../api/letters";
import type {
  ContentStatus,
  WorkflowState,
} from "../../../types/Letter";
import {
  DEFAULT_DASHBOARD_SORT,
  MAX_DASHBOARD_SORT_RULES,
  SERVER_SORT_FIELDS,
} from "./constants";
import type {
  ContentShapeFilter,
  ExtendedSortField,
  FlaggedFilter,
  MissingFilter,
  ServerSortField,
  SortColumn,
  VisibilityFilter,
} from "./types";
import { normalizeDashboardSearchQuery } from "./dashboardStoredStateModel";

export interface DashboardCommittedQuerySource {
  readonly collectionFilter: string;
  readonly visibilityFilter: VisibilityFilter;
  readonly searchQuery: string;
  readonly yearFilter: number | null;
  readonly monthFilter: number | null;
  readonly dayFilter: number | null;
  readonly dateFromFilter: string | null;
  readonly dateToFilter: string | null;
  readonly transcriptStatusFilters: readonly ContentStatus[];
  readonly metadataStatusFilters: readonly ContentStatus[];
  readonly extraContentStatusFilters: readonly ContentStatus[];
  readonly workflowFilters: readonly WorkflowState[];
  readonly flaggedFilter: FlaggedFilter;
  readonly missingFilters: readonly MissingFilter[];
  readonly contentShapeFilters: readonly ContentShapeFilter[];
}

export interface DashboardCommittedQuery
  extends DashboardCommittedQuerySource {
  readonly sortColumns: readonly Readonly<SortColumn>[];
}

export function createDashboardCommittedQuery(
  source: DashboardCommittedQuerySource,
  sortColumns: readonly SortColumn[],
): DashboardCommittedQuery {
  return {
    collectionFilter: source.collectionFilter,
    visibilityFilter: source.visibilityFilter,
    searchQuery: normalizeDashboardSearchQuery(source.searchQuery),
    yearFilter: source.yearFilter,
    monthFilter: source.monthFilter,
    dayFilter: source.dayFilter,
    dateFromFilter: source.dateFromFilter,
    dateToFilter: source.dateToFilter,
    transcriptStatusFilters: [...source.transcriptStatusFilters],
    metadataStatusFilters: [...source.metadataStatusFilters],
    extraContentStatusFilters: [...source.extraContentStatusFilters],
    workflowFilters: [...source.workflowFilters],
    flaggedFilter: source.flaggedFilter,
    missingFilters: [...source.missingFilters],
    contentShapeFilters: [...source.contentShapeFilters],
    sortColumns: sortColumns
      .slice(0, MAX_DASHBOARD_SORT_RULES)
      .map((column) => ({ ...column })),
  };
}

export function isServerSortField(
  field: ExtendedSortField,
): field is ServerSortField {
  return (SERVER_SORT_FIELDS as readonly string[]).includes(field);
}

export function buildDashboardLetterQuery(
  query: DashboardCommittedQuery,
  pagination: {
    page?: number;
    limit?: number;
  } = {},
): AdminLetterQueryParams {
  const serverSortColumns = query.sortColumns
    .filter(
      (
        column,
      ): column is Readonly<SortColumn> & { field: ServerSortField } => (
        isServerSortField(column.field)
      ),
    )
    .slice(0, MAX_DASHBOARD_SORT_RULES);
  const fallbackSortField = isServerSortField(DEFAULT_DASHBOARD_SORT.field)
    ? DEFAULT_DASHBOARD_SORT.field
    : undefined;
  const sortRules = serverSortColumns.length > 0
    ? serverSortColumns
      .map((column) => `${column.field}:${column.direction}`)
      .join(",")
    : fallbackSortField
      ? `${fallbackSortField}:${DEFAULT_DASHBOARD_SORT.direction}`
      : undefined;

  return {
    page: pagination.page,
    limit: pagination.limit,
    collection: query.collectionFilter === "all"
      ? undefined
      : query.collectionFilter,
    visibility: query.visibilityFilter === "ALL"
      ? undefined
      : query.visibilityFilter,
    search: query.searchQuery || undefined,
    sort: serverSortColumns[0]?.field ?? fallbackSortField,
    sortOrder: serverSortColumns[0]?.direction
      ?? (fallbackSortField ? DEFAULT_DASHBOARD_SORT.direction : undefined),
    sortRules,
    year: query.yearFilter ?? undefined,
    month: query.monthFilter ?? undefined,
    day: query.dayFilter ?? undefined,
    dateFrom: query.dateFromFilter ?? undefined,
    dateTo: query.dateToFilter ?? undefined,
    transcriptStatus: query.transcriptStatusFilters.length > 0
      ? query.transcriptStatusFilters.join(",")
      : undefined,
    metadataStatus: query.metadataStatusFilters.length > 0
      ? query.metadataStatusFilters.join(",")
      : undefined,
    extraContentStatus: query.extraContentStatusFilters.length > 0
      ? query.extraContentStatusFilters.join(",")
      : undefined,
    workflow: query.workflowFilters.length > 0
      ? query.workflowFilters.join(",")
      : undefined,
    flagged: query.flaggedFilter === "FLAGGED"
      ? "true"
      : query.flaggedFilter === "UNFLAGGED"
        ? "false"
        : undefined,
    missing: query.missingFilters.length > 0
      ? query.missingFilters.join(",")
      : undefined,
    contentShape: query.contentShapeFilters.length > 0
      ? query.contentShapeFilters.join(",")
      : undefined,
  };
}
