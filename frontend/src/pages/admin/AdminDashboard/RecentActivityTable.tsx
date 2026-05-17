import type React from "react";
import type { RefObject } from "react";
import { VisibilityBadge } from "../../../components/common";
import { Icon } from "../../../components/common/Icon";
import type { Letter, ContentStatus } from "../../../types/Letter";
import {
  hasPrimaryTranscriptContent,
  hasRelatedExtraContent,
  shouldShowPhotoDescriptionWorkflow,
} from "../../../utils/letterContent";
import SortableTableHeader from "./SortableTableHeader";
import type { ColumnId, ExtendedSortField, PendingChange, SortInfo } from "./types";

const FILE_TYPE_COLUMNS: Array<{ id: ColumnId; label: string }> = [
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
            {filteredLetters.map((letter, index) => {
              const pageCount =
                letter.lettersCount ??
                letter.images.filter((img) => img.type === "letter").length;
              const extrasCount =
                letter.extrasCount ??
                letter.images.filter((img) => img.type !== "letter").length;
              const photosCount =
                letter.photosCount ??
                letter.images.filter((img) => img.type === "photo").length;
              const formattedDate = formatDateRaw(letter.metadata.dateRaw);
              const contentStatus = shouldShowPhotoDescriptionWorkflow(letter)
                ? (letter.photoDescriptionStatus ?? "EMPTY")
                : getCombinedTranscriptStatus(
                    letter.transcriptStatus,
                    letter.extraContentStatus,
                    hasPrimaryTranscriptContent(letter),
                    hasRelatedExtraContent(letter),
                  );

              return (
                <tr
                  key={letter.id}
                  onClick={(e) => onRowClick(letter.id, index, e)}
                  onMouseDown={(e) => onRowMouseDown(index, e)}
                  onMouseEnter={() => onRowMouseEnter(index)}
                  className={`letter-row ${selectedIds.has(letter.id) ? "selected" : ""} ${editMode ? "edit-mode" : ""}`}
                >
                  <td className="checkbox-cell" onClick={(e) => { e.stopPropagation(); onCheckboxChange(letter.id, index, e); }}>
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={selectedIds.has(letter.id)}
                      readOnly
                      tabIndex={-1}
                    />
                  </td>
                  {visibleColumns.has("sender") && (
                    <td
                      data-column="sender"
                      className={`
                        ${copyModeActive ? "copyable-cell" : ""}
                        ${sourceCell?.letterId === letter.id && sourceCell?.column === "sender" ? "source-cell" : ""}
                        ${pendingChanges.has(letter.id) && pendingChanges.get(letter.id)?.sender !== undefined ? "changed-cell" : ""}
                      `}
                      onClick={(e) =>
                        copyModeActive
                          ? onCellClick(
                              letter.id,
                              "sender",
                              letter.metadata.sender ?? null,
                              e,
                            )
                          : undefined
                      }
                    >
                      {pendingChanges.get(letter.id)?.sender !== undefined
                        ? pendingChanges.get(letter.id)?.sender || "—"
                        : letter.metadata.sender || "—"}
                    </td>
                  )}

                  {visibleColumns.has("recipient") && (
                    <td
                      data-column="recipient"
                      className={`
                        ${copyModeActive ? "copyable-cell" : ""}
                        ${sourceCell?.letterId === letter.id && sourceCell?.column === "recipient" ? "source-cell" : ""}
                        ${pendingChanges.has(letter.id) && pendingChanges.get(letter.id)?.recipient !== undefined ? "changed-cell" : ""}
                      `}
                      onClick={(e) =>
                        copyModeActive
                          ? onCellClick(
                              letter.id,
                              "recipient",
                              letter.metadata.recipient ?? null,
                              e,
                            )
                          : undefined
                      }
                    >
                      {pendingChanges.get(letter.id)?.recipient !== undefined
                        ? pendingChanges.get(letter.id)?.recipient || "—"
                        : letter.metadata.recipient || "—"}
                    </td>
                  )}

                  {visibleColumns.has("date") && <td data-column="date" className="date-cell">{formattedDate}</td>}
                  {visibleColumns.has("collection") && <td data-column="collection">{letter.collectionCode || "—"}</td>}
                  {visibleColumns.has("letters") && <td data-column="letters" className="count-cell">{pageCount || "—"}</td>}
                  {visibleColumns.has("extras") && <td data-column="extras" className="count-cell">{extrasCount || "—"}</td>}
                  {visibleColumns.has("photos") && <td data-column="photos" className="count-cell">{photosCount || "—"}</td>}

                  {visibleColumns.has("transcript") && (
                    <td data-column="transcript" className="status-cell">
                      {renderStatusIcon(contentStatus, "T")}
                    </td>
                  )}

                  {visibleColumns.has("metadata") && (
                    <td data-column="metadata" className="status-cell">
                      {renderStatusIcon(letter.metadataContentStatus, "M")}
                    </td>
                  )}

                  {visibleColumns.has("visibility") && (
                    <td data-column="visibility">
                      <VisibilityBadge state={letter.visibility} />
                    </td>
                  )}

                  {visibleColumns.has("created") && (
                    <td data-column="created" className="date-cell">{formatDate(letter.createdAt)}</td>
                  )}
                  {visibleColumns.has("updated") && (
                    <td data-column="updated" className="date-cell">{letter.updatedAt ? formatDate(letter.updatedAt) : "—"}</td>
                  )}
                  {visibleColumns.has("lastOpened") && (
                    <td data-column="lastOpened" className="date-cell">{letter.lastOpenedAt ? formatDate(letter.lastOpenedAt) : "—"}</td>
                  )}
                  {visibleColumns.has("flag") && (
                    <td data-column="flag" className="flag-cell">
                      <button
                        className={`flag-btn ${letter.flagged ? "flagged" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFlag(letter.id, !letter.flagged);
                        }}
                        aria-label={letter.flagged ? "Unflag letter" : "Flag letter"}
                      >
                        <Icon name={letter.flagged ? "flag-filled" : "flag"} size={16} />
                      </button>
                    </td>
                  )}
                  {FILE_TYPE_COLUMNS.filter(col => visibleColumns.has(col.id)).map(col => {
                    const typeKey = col.id.replace('type_', '');
                    const count = letter.images.filter((img) => img.type === typeKey).length;
                    return <td key={col.id} data-column={col.id} className="count-cell">{count || '—'}</td>;
                  })}
                </tr>
              );
            })}
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
