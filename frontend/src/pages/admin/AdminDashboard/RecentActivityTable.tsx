import type React from "react";
import type {
  AdminLetterSummary,
  ContentStatus,
} from "../../../types/Letter";
import DashboardPagination from "./DashboardPagination";
import RecentActivityRow from "./RecentActivityRow";
import RecentActivityTableHeader from "./RecentActivityTableHeader";
import type { ColumnDef, ColumnId, PendingChange } from "./types";

export interface PaginationState {
  page: number;
  totalPages: number;
}

export interface TableSelectionModel {
  selectedIds: Set<string>;
  onRowClick: (letterId: string, index: number, e: React.MouseEvent) => void;
  onRowMouseDown: (index: number, e: React.MouseEvent) => void;
  onRowMouseEnter: (index: number) => void;
  onCheckboxChange: (letterId: string, index: number, options?: { shiftKey?: boolean }) => void;
}

export interface TableCopyEditModel {
  editMode: boolean;
  copyModeActive: boolean;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChanges: Map<string, PendingChange>;
  onCellClick: (
    letterId: string,
    primarySourceRevision: number,
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
  orderedColumns: ColumnDef[];
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onCloseColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  onMoveColumn: (id: ColumnId, direction: -1 | 1) => void;
  onReorderColumn: (id: ColumnId, targetIndex: number) => void;
  onResetColumnOrder: () => void;
}

export interface TableRowActions {
  onToggleFlag: (letterId: string, flagged: boolean) => void;
}

interface RecentActivityTableProps {
  filteredLetters: AdminLetterSummary[];
  columns: TableColumnModel;
  selection: TableSelectionModel;
  copyEdit: TableCopyEditModel;
  formatting: TableFormattingModel;
  pagination: TablePaginationModel;
  rowActions: TableRowActions;
}

export default function RecentActivityTable({
  filteredLetters,
  columns,
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
            showColumnMenu={columns.showColumnMenu}
            onToggleColumnMenu={columns.onToggleColumnMenu}
            onCloseColumnMenu={columns.onCloseColumnMenu}
            onToggleColumn={columns.onToggleColumn}
            onMoveColumn={columns.onMoveColumn}
            onReorderColumn={columns.onReorderColumn}
            onResetColumnOrder={columns.onResetColumnOrder}
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
