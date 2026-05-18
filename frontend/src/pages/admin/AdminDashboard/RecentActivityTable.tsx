import type React from "react";
import type { RefObject } from "react";
import type { Letter, ContentStatus } from "../../../types/Letter";
import DashboardPagination from "./DashboardPagination";
import RecentActivityRow from "./RecentActivityRow";
import RecentActivityTableHeader from "./RecentActivityTableHeader";
import type { ColumnId, ExtendedSortField, PendingChange, SortInfo } from "./types";

interface PaginationState {
  page: number;
  totalPages: number;
}

interface RecentActivityTableProps {
  filteredLetters: Letter[];
  visibleColumns: Set<ColumnId>;
  getSortInfo: (field: ExtendedSortField) => SortInfo | null;
  onSort: (field: ExtendedSortField) => void;
  onRowClick: (letterId: string, index: number, e: React.MouseEvent) => void;
  onRowMouseDown: (index: number, e: React.MouseEvent) => void;
  onRowMouseEnter: (index: number) => void;
  onCheckboxChange: (letterId: string, index: number, e: React.MouseEvent) => void;
  selectedIds: Set<string>;
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
  formatDate: (dateString: string) => string;
  formatDateRaw: (dateRaw: string | undefined) => string;
  getCombinedTranscriptStatus: (
    transcriptStatus: ContentStatus,
    extraContentStatus: ContentStatus,
    hasLetterPages: boolean,
    hasExtras: boolean,
  ) => ContentStatus;
  renderStatusIcon: (status: ContentStatus, type: "T" | "M") => React.ReactNode;
  pagination: PaginationState;
  loading: boolean;
  onPageChange: (page: number) => void;
  letterCountText?: string;
  // Column toggle
  allColumns: Array<{ id: ColumnId; label: string }>;
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
  onToggleFlag: (letterId: string, flagged: boolean) => void;
}

export default function RecentActivityTable({
  filteredLetters,
  visibleColumns,
  getSortInfo,
  onSort,
  onRowClick,
  onRowMouseDown,
  onRowMouseEnter,
  onCheckboxChange,
  selectedIds,
  editMode,
  copyModeActive,
  sourceCell,
  pendingChanges,
  onCellClick,
  formatDate,
  formatDateRaw,
  getCombinedTranscriptStatus,
  renderStatusIcon,
  pagination,
  loading,
  onPageChange,
  letterCountText,
  allColumns,
  showColumnMenu,
  onToggleColumnMenu,
  onToggleColumn,
  columnMenuRef,
  onToggleFlag,
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
            visibleColumns={visibleColumns}
            getSortInfo={getSortInfo}
            onSort={onSort}
            allColumns={allColumns}
            showColumnMenu={showColumnMenu}
            onToggleColumnMenu={onToggleColumnMenu}
            onToggleColumn={onToggleColumn}
            columnMenuRef={columnMenuRef}
          />
          <tbody>
            {filteredLetters.map((letter, index) => (
              <RecentActivityRow
                key={letter.id}
                letter={letter}
                index={index}
                visibleColumns={visibleColumns}
                selectedIds={selectedIds}
                editMode={editMode}
                copyModeActive={copyModeActive}
                sourceCell={sourceCell}
                pendingChanges={pendingChanges}
                onRowClick={onRowClick}
                onRowMouseDown={onRowMouseDown}
                onRowMouseEnter={onRowMouseEnter}
                onCheckboxChange={onCheckboxChange}
                onCellClick={onCellClick}
                formatDate={formatDate}
                formatDateRaw={formatDateRaw}
                getCombinedTranscriptStatus={getCombinedTranscriptStatus}
                renderStatusIcon={renderStatusIcon}
                onToggleFlag={onToggleFlag}
              />
            ))}
          </tbody>
        </table>
      </div>

      <DashboardPagination
        pagination={pagination}
        loading={loading}
        onPageChange={onPageChange}
        letterCountText={letterCountText}
      />
    </>
  );
}
