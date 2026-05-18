import type React from "react";
import type { RefObject } from "react";
import type { Letter, ContentStatus } from "../../../types/Letter";
import DashboardPagination from "./DashboardPagination";
import RecentActivityRow from "./RecentActivityRow";
import RecentActivityTableHeader from "./RecentActivityTableHeader";
import type { ColumnDef, ColumnId, ExtendedSortField, PendingChange, SortInfo } from "./types";

export interface PaginationState {
  page: number;
  totalPages: number;
}

export interface TableSortingModel {
  getSortInfo: (field: ExtendedSortField) => SortInfo | null;
  onSort: (field: ExtendedSortField) => void;
}

export interface TableSelectionModel {
  selectedIds: Set<string>;
  onRowClick: (letterId: string, index: number, e: React.MouseEvent) => void;
  onRowMouseDown: (index: number, e: React.MouseEvent) => void;
  onRowMouseEnter: (index: number) => void;
  onCheckboxChange: (letterId: string, index: number, e: React.MouseEvent) => void;
}

export interface TableCopyEditModel {
  editMode: boolean;
  copyModeActive: boolean;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChanges: Map<string, PendingChange>;
  onCellClick: (
    letterId: string,
    column: "sender" | "recipient",
    value: string | null,
    e: React.MouseEvent,
  ) => void;
}

export interface TableFormattingModel {
  formatDate: (dateString: string) => string;
  formatDateRaw: (dateRaw: string | undefined) => string;
  getCombinedTranscriptStatus: (
    transcriptStatus: ContentStatus,
    extraContentStatus: ContentStatus,
    hasLetterPages: boolean,
    hasExtras: boolean,
  ) => ContentStatus;
  renderStatusIcon: (status: ContentStatus, type: "T" | "M") => React.ReactNode;
}

export interface TablePaginationModel {
  pagination: PaginationState;
  loading: boolean;
  onPageChange: (page: number) => void;
  letterCountText?: string;
}

export interface TableColumnModel {
  visibleColumns: Set<ColumnId>;
  allColumns: Array<{ id: ColumnId; label: string }>;
  orderedColumns: ColumnDef[];
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  onMoveColumn: (id: ColumnId, direction: -1 | 1) => void;
  onResetColumnOrder: () => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
}

export interface TableRowActions {
  onToggleFlag: (letterId: string, flagged: boolean) => void;
}

interface RecentActivityTableProps {
  filteredLetters: Letter[];
  columns: TableColumnModel;
  sorting: TableSortingModel;
  selection: TableSelectionModel;
  copyEdit: TableCopyEditModel;
  formatting: TableFormattingModel;
  pagination: TablePaginationModel;
  rowActions: TableRowActions;
}

export default function RecentActivityTable({
  filteredLetters,
  columns,
  sorting,
  selection,
  copyEdit,
  formatting,
  pagination,
  rowActions,
}: RecentActivityTableProps) {
  return (
    <>
      <div
        className={`letters-table-container ${filteredLetters.length === 0 ? "empty" : ""}`}
        tabIndex={0}
        role="region"
        aria-label="Letters table"
      >
        <table className="letters-table">
          <RecentActivityTableHeader
            visibleColumns={columns.visibleColumns}
            orderedColumns={columns.orderedColumns}
            getSortInfo={sorting.getSortInfo}
            onSort={sorting.onSort}
            allColumns={columns.allColumns}
            showColumnMenu={columns.showColumnMenu}
            onToggleColumnMenu={columns.onToggleColumnMenu}
            onToggleColumn={columns.onToggleColumn}
            onMoveColumn={columns.onMoveColumn}
            onResetColumnOrder={columns.onResetColumnOrder}
            columnMenuRef={columns.columnMenuRef}
          />
          <tbody>
            {filteredLetters.map((letter, index) => (
              <RecentActivityRow
                key={letter.id}
                letter={letter}
                index={index}
                columns={columns}
                selection={selection}
                copyEdit={copyEdit}
                formatting={formatting}
                rowActions={rowActions}
              />
            ))}
          </tbody>
        </table>
      </div>

      <DashboardPagination
        pagination={pagination.pagination}
        loading={pagination.loading}
        onPageChange={pagination.onPageChange}
        letterCountText={pagination.letterCountText}
      />
    </>
  );
}
