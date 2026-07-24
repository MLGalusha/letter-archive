import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import {
  ALL_COLUMNS,
  CONTENT_SHAPE_FILTERS,
  CONTENT_STATUS_FILTERS,
  DAY_OPTIONS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_DASHBOARD_SORT,
  DEFAULT_VISIBLE_COLUMNS,
  MAX_DASHBOARD_SEARCH_LENGTH,
  MAX_DASHBOARD_SORT_RULES,
  MAX_SAVED_DASHBOARD_VIEWS,
  MISSING_FILTERS,
  MONTH_OPTIONS,
  SERVER_SORT_FIELDS,
  WORKFLOW_FILTERS,
  YEAR_OPTIONS,
} from "./constants";
import type { DashboardCommittedQuery } from "./dashboardQueryModel";
import type {
  ColumnId,
  DashboardViewState,
  DateMode,
  PersistedState,
  SavedDashboardView,
  SortColumn,
} from "./types";

const VISIBILITY_FILTERS = ["ALL", "PUBLISHED", "HIDDEN"] as const;
const FLAGGED_FILTERS = ["ALL", "FLAGGED", "UNFLAGGED"] as const;
const DATE_MODES = ["specific", "range"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;

const CONTENT_STATUS_VALUES = CONTENT_STATUS_FILTERS.map(
  (filter) => filter.value,
) as readonly ContentStatus[];
const WORKFLOW_VALUES = WORKFLOW_FILTERS.map(
  (filter) => filter.value,
) as readonly WorkflowState[];
const MISSING_VALUES = MISSING_FILTERS.map((filter) => filter.value);
const CONTENT_SHAPE_VALUES = CONTENT_SHAPE_FILTERS.map(
  (filter) => filter.value,
);
const COLUMN_IDS = ALL_COLUMNS.map((column) => column.id);
const MONTH_VALUES = MONTH_OPTIONS.map((month) => month.value);
const DAY_VALUES = DAY_OPTIONS;

const LEGACY_DEFAULT_COLUMN_ORDER: ColumnId[] = [
  "sender",
  "recipient",
  "date",
  "collection",
  "letters",
  "extras",
  "photos",
  "transcript",
  "metadata",
  "visibility",
  "created",
  "updated",
  "lastOpened",
  "flag",
  "type_letter",
  "type_cover",
  "type_telegram",
  "type_photo",
  "type_card",
  "type_ephemera",
  "type_voice",
  "type_article",
  "type_diary",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : fallback;
}

function decodeEnumArray<const T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [];

  const allowedValues = new Set<string>(allowed);
  return Array.from(new Set(
    value.filter(
      (entry): entry is T => (
        typeof entry === "string" && allowedValues.has(entry)
      ),
    ),
  ));
}

function decodeInteger(
  value: unknown,
  allowed: readonly number[],
): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && allowed.includes(value)
    ? value
    : null;
}

function decodeDateRaw(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? value
    : null;
}

export function parseDashboardCollectionFilter(value: unknown): string[] {
  if (typeof value !== "string" || value === "all") return [];
  return Array.from(new Set(
    value
      .split(",")
      .map((code) => code.replace(/\D/g, "").slice(0, 3))
      .filter((code) => code !== "" && Number(code) !== 0),
  ));
}

export function normalizeDashboardSearchQuery(value: unknown): string {
  return typeof value === "string"
    ? value.slice(0, MAX_DASHBOARD_SEARCH_LENGTH)
    : "";
}

function decodeCollectionFilter(value: unknown): string {
  const collectionCodes = parseDashboardCollectionFilter(value);
  return collectionCodes.length > 0 ? collectionCodes.join(",") : "all";
}

function decodeSortColumns(value: unknown): SortColumn[] {
  if (!Array.isArray(value)) return [{ ...DEFAULT_DASHBOARD_SORT }];

  const validFields = new Set<string>(SERVER_SORT_FIELDS);
  const validDirections = new Set<string>(SORT_DIRECTIONS);
  const seenFields = new Set<string>();
  const sortColumns: SortColumn[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { field, direction } = entry;
    if (
      typeof field !== "string"
      || typeof direction !== "string"
      || !validFields.has(field)
      || !validDirections.has(direction)
      || seenFields.has(field)
    ) {
      continue;
    }

    seenFields.add(field);
    sortColumns.push({
      field: field as SortColumn["field"],
      direction: direction as SortColumn["direction"],
    });
    if (sortColumns.length === MAX_DASHBOARD_SORT_RULES) break;
  }

  return sortColumns.length > 0
    ? sortColumns
    : [{ ...DEFAULT_DASHBOARD_SORT }];
}

function areColumnOrdersEqual(
  left: readonly ColumnId[],
  right: readonly ColumnId[],
): boolean {
  return left.length === right.length
    && left.every((id, index) => id === right[index]);
}

function decodeColumnIds(
  value: unknown,
  fallback: readonly ColumnId[],
): ColumnId[] {
  if (!Array.isArray(value)) return [...fallback];
  return decodeEnumArray(value, COLUMN_IDS);
}

export function decodeDashboardColumnState(value: unknown): {
  visibleColumns: ColumnId[];
  columnOrder: ColumnId[];
} {
  const source = Array.isArray(value)
    ? { visible: value, known: value, order: value }
    : isRecord(value)
      ? value
      : {};
  const visibleColumns = new Set(decodeColumnIds(source.visible, []));
  const knownColumns = new Set(decodeColumnIds(source.known, []));

  for (const column of ALL_COLUMNS) {
    if (column.defaultVisible && !knownColumns.has(column.id)) {
      visibleColumns.add(column.id);
    }
  }

  return {
    visibleColumns: Array.from(visibleColumns),
    columnOrder: normalizeDashboardColumnOrder(source.order),
  };
}

export function normalizeDashboardColumnOrder(value: unknown): ColumnId[] {
  const normalized = decodeColumnIds(value, []);
  if (areColumnOrdersEqual(normalized, LEGACY_DEFAULT_COLUMN_ORDER)) {
    return [...DEFAULT_COLUMN_ORDER];
  }

  const savedIds = new Set(normalized);
  return [
    ...normalized,
    ...DEFAULT_COLUMN_ORDER.filter((id) => !savedIds.has(id)),
  ];
}

function cloneStoredState(state: PersistedState): PersistedState {
  return {
    ...state,
    sortColumns: state.sortColumns.map((column) => ({ ...column })),
    transcriptStatusFilters: [...state.transcriptStatusFilters],
    metadataStatusFilters: [...state.metadataStatusFilters],
    extraContentStatusFilters: [...state.extraContentStatusFilters],
    workflowFilters: [...state.workflowFilters],
    missingFilters: [...state.missingFilters],
    contentShapeFilters: [...state.contentShapeFilters],
  };
}

export function decodeDashboardStoredState(value: unknown): PersistedState {
  const source = isRecord(value) ? value : {};
  const dateMode = decodeEnum(source.dateMode, DATE_MODES, "specific");

  return {
    visibilityFilter: decodeEnum(
      source.visibilityFilter,
      VISIBILITY_FILTERS,
      "ALL",
    ),
    collectionFilter: decodeCollectionFilter(source.collectionFilter),
    searchQuery: normalizeDashboardSearchQuery(source.searchQuery),
    sortColumns: decodeSortColumns(source.sortColumns),
    dateMode,
    year: dateMode === "specific"
      ? decodeInteger(source.year, YEAR_OPTIONS)
      : null,
    month: dateMode === "specific"
      ? decodeInteger(source.month, MONTH_VALUES)
      : null,
    day: dateMode === "specific"
      ? decodeInteger(source.day, DAY_VALUES)
      : null,
    dateFrom: dateMode === "range" ? decodeDateRaw(source.dateFrom) : null,
    dateTo: dateMode === "range" ? decodeDateRaw(source.dateTo) : null,
    transcriptStatusFilters: decodeEnumArray(
      source.transcriptStatusFilters,
      CONTENT_STATUS_VALUES,
    ),
    metadataStatusFilters: decodeEnumArray(
      source.metadataStatusFilters,
      CONTENT_STATUS_VALUES,
    ),
    extraContentStatusFilters: decodeEnumArray(
      source.extraContentStatusFilters,
      CONTENT_STATUS_VALUES,
    ),
    workflowFilters: decodeEnumArray(
      source.workflowFilters,
      WORKFLOW_VALUES,
    ),
    flaggedFilter: decodeEnum(
      source.flaggedFilter,
      FLAGGED_FILTERS,
      "ALL",
    ),
    missingFilters: decodeEnumArray(source.missingFilters, MISSING_VALUES),
    contentShapeFilters: decodeEnumArray(
      source.contentShapeFilters,
      CONTENT_SHAPE_VALUES,
    ),
  };
}

export function decodeDashboardViewState(value: unknown): DashboardViewState {
  const source = isRecord(value) ? value : {};
  return {
    ...decodeDashboardStoredState(source),
    visibleColumns: decodeColumnIds(
      source.visibleColumns,
      Array.from(DEFAULT_VISIBLE_COLUMNS),
    ),
    columnOrder: normalizeDashboardColumnOrder(source.columnOrder),
  };
}

export function decodeSavedDashboardViews(
  value: unknown,
): SavedDashboardView[] {
  if (!Array.isArray(value)) return [];

  const views: SavedDashboardView[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry)
      || typeof entry.id !== "string"
      || entry.id.trim() === ""
      || typeof entry.name !== "string"
      || entry.name.trim() === ""
      || typeof entry.createdAt !== "string"
      || entry.createdAt.trim() === ""
      || !isRecord(entry.state)
      || seenIds.has(entry.id)
    ) {
      continue;
    }

    seenIds.add(entry.id);
    views.push({
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      state: decodeDashboardViewState(entry.state),
    });
    if (views.length === MAX_SAVED_DASHBOARD_VIEWS) break;
  }
  return views;
}

export function createDashboardStoredState(
  query: DashboardCommittedQuery,
  dateMode: DateMode,
): PersistedState {
  return {
    visibilityFilter: query.visibilityFilter,
    collectionFilter: query.collectionFilter,
    searchQuery: query.searchQuery,
    sortColumns: query.sortColumns.map((column) => ({ ...column })),
    dateMode,
    year: dateMode === "specific" ? query.yearFilter : null,
    month: dateMode === "specific" ? query.monthFilter : null,
    day: dateMode === "specific" ? query.dayFilter : null,
    dateFrom: dateMode === "range" ? query.dateFromFilter : null,
    dateTo: dateMode === "range" ? query.dateToFilter : null,
    transcriptStatusFilters: [...query.transcriptStatusFilters],
    metadataStatusFilters: [...query.metadataStatusFilters],
    extraContentStatusFilters: [...query.extraContentStatusFilters],
    workflowFilters: [...query.workflowFilters],
    flaggedFilter: query.flaggedFilter,
    missingFilters: [...query.missingFilters],
    contentShapeFilters: [...query.contentShapeFilters],
  };
}

export function createDashboardViewState({
  storedState,
  visibleColumns,
  columnOrder,
}: {
  storedState: PersistedState;
  visibleColumns: ReadonlySet<ColumnId>;
  columnOrder: readonly ColumnId[];
}): DashboardViewState {
  return {
    ...cloneStoredState(storedState),
    visibleColumns: Array.from(visibleColumns),
    columnOrder: [...columnOrder],
  };
}
