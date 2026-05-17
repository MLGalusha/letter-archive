import type React from "react";
import type { RefObject } from "react";
import { Icon } from "../../../components/common/Icon";
import type { Letter, ContentStatus } from "../../../types/Letter";
import { FILE_TYPE_COLUMNS } from "./constants";
import RecentActivityRow from "./RecentActivityRow";
import SortableTableHeader from "./SortableTableHeader";
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
          <thead>
            <tr>
              <th className="checkbox-header" ref={columnMenuRef}>
                <button
                  className={`column-toggle-btn ${showColumnMenu ? 'active' : ''}`}
                  onClick={onToggleColumnMenu}
                  title="Toggle columns"
                >
                  <Icon name="columns" size={14} />
                </button>
                {showColumnMenu && (
                  <div className="column-toggle-dropdown column-toggle-left">
                    {allColumns.map(col => (
                      <label key={col.id} className="column-toggle-item">
                        <input
                          type="checkbox"
                          checked={visibleColumns.has(col.id)}
                          onChange={() => onToggleColumn(col.id)}
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                )}
              </th>
              {visibleColumns.has("sender") && (
                <SortableTableHeader
                  field="sender"
                  dataColumn="sender"
                  label="Sender"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("recipient") && (
                <SortableTableHeader
                  field="recipient"
                  dataColumn="recipient"
                  label="Recipient"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("date") && (
                <SortableTableHeader
                  field="letterDate"
                  dataColumn="date"
                  className="date-header"
                  label="Date"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("collection") && (
                <SortableTableHeader
                  field="collection"
                  dataColumn="collection"
                  label={
                    <>
                    <span className="desktop-header-label">Collection</span>
                    <span className="mobile-header-label">Coll.</span>
                    </>
                  }
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("letters") && (
                <SortableTableHeader
                  field="letters"
                  dataColumn="letters"
                  label="Letters"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("extras") && (
                <SortableTableHeader
                  field="extras"
                  dataColumn="extras"
                  label="Extras"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("photos") && (
                <SortableTableHeader
                  field="photos"
                  dataColumn="photos"
                  label="Photos"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("transcript") && <th data-column="transcript" className="status-header">Transcript</th>}
              {visibleColumns.has("metadata") && <th data-column="metadata" className="status-header">Metadata</th>}
              {visibleColumns.has("visibility") && <th data-column="visibility">Visibility</th>}
              {visibleColumns.has("created") && (
                <SortableTableHeader
                  field="createdAt"
                  dataColumn="created"
                  label="Created"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("updated") && (
                <SortableTableHeader
                  field="updatedAt"
                  dataColumn="updated"
                  label="Updated"
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("lastOpened") && (
                <SortableTableHeader
                  field="lastOpenedAt"
                  dataColumn="lastOpened"
                  label={
                    <>
                    <span className="desktop-header-label">Last Opened</span>
                    <span className="mobile-header-label">Opened</span>
                    </>
                  }
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {visibleColumns.has("flag") && (
                <SortableTableHeader
                  field="flagged"
                  dataColumn="flag"
                  className="flag-header"
                  label={<Icon name="flag" size={14} />}
                  getSortInfo={getSortInfo}
                  onSort={onSort}
                />
              )}
              {FILE_TYPE_COLUMNS.filter(col => visibleColumns.has(col.id)).map(col => (
                <th key={col.id} data-column={col.id}>{col.label}</th>
              ))}
            </tr>
          </thead>
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

      <div className="pagination-controls">
        {pagination.totalPages > 1 ? (
          <>
            <button
              className="pagination-btn"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || loading}
            >
              ← Previous
            </button>
            <span className="pagination-info">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
            >
              Next →
            </button>
          </>
        ) : (
          <span className="pagination-info" />
        )}
        {letterCountText && (
          <span className="letter-count">{letterCountText}</span>
        )}
      </div>
    </>
  );
}
