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
import type { ColumnId, ExtendedSortField, PendingChange } from "./types";

interface SortInfo {
  direction: "asc" | "desc";
  priority: number;
  total: number;
}

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
  columnMenuRef: RefObject<HTMLDivElement | null>;
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
                <th
                  className={`sortable-header ${getSortInfo("sender") ? "sorted" : ""}`}
                  onClick={() => onSort("sender")}
                >
                  <span className="header-content">
                    Sender
                    {getSortInfo("sender") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("sender")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("sender")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("sender")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("recipient") && (
                <th
                  className={`sortable-header ${getSortInfo("recipient") ? "sorted" : ""}`}
                  onClick={() => onSort("recipient")}
                >
                  <span className="header-content">
                    Recipient
                    {getSortInfo("recipient") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("recipient")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("recipient")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("recipient")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("date") && (
                <th
                  className={`date-header sortable-header ${getSortInfo("letterDate") ? "sorted" : ""}`}
                  onClick={() => onSort("letterDate")}
                >
                  <span className="header-content">
                    Date
                    {getSortInfo("letterDate") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("letterDate")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("letterDate")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("letterDate")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("collection") && (
                <th
                  className={`sortable-header ${getSortInfo("collection") ? "sorted" : ""}`}
                  onClick={() => onSort("collection")}
                >
                  <span className="header-content">
                    Collection
                    {getSortInfo("collection") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("collection")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("collection")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("collection")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("letters") && (
                <th
                  className={`sortable-header ${getSortInfo("letters") ? "sorted" : ""}`}
                  onClick={() => onSort("letters")}
                >
                  <span className="header-content">
                    Letters
                    {getSortInfo("letters") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("letters")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("letters")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("letters")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("extras") && (
                <th
                  className={`sortable-header ${getSortInfo("extras") ? "sorted" : ""}`}
                  onClick={() => onSort("extras")}
                >
                  <span className="header-content">
                    Extras
                    {getSortInfo("extras") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("extras")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("extras")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("extras")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("photos") && (
                <th
                  className={`sortable-header ${getSortInfo("photos") ? "sorted" : ""}`}
                  onClick={() => onSort("photos")}
                >
                  <span className="header-content">
                    Photos
                    {getSortInfo("photos") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("photos")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("photos")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("photos")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("transcript") && <th className="status-header">Transcript</th>}
              {visibleColumns.has("metadata") && <th className="status-header">Metadata</th>}
              {visibleColumns.has("visibility") && <th>Visibility</th>}
              {visibleColumns.has("created") && (
                <th
                  className={`sortable-header ${getSortInfo("createdAt") ? "sorted" : ""}`}
                  onClick={() => onSort("createdAt")}
                >
                  <span className="header-content">
                    Created
                    {getSortInfo("createdAt") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("createdAt")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("createdAt")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("createdAt")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("updated") && (
                <th
                  className={`sortable-header ${getSortInfo("updatedAt") ? "sorted" : ""}`}
                  onClick={() => onSort("updatedAt")}
                >
                  <span className="header-content">
                    Updated
                    {getSortInfo("updatedAt") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("updatedAt")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("updatedAt")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("updatedAt")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("lastOpened") && (
                <th
                  className={`sortable-header ${getSortInfo("lastOpenedAt") ? "sorted" : ""}`}
                  onClick={() => onSort("lastOpenedAt")}
                >
                  <span className="header-content">
                    Last Opened
                    {getSortInfo("lastOpenedAt") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("lastOpenedAt")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("lastOpenedAt")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("lastOpenedAt")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
              {visibleColumns.has("flag") && (
                <th
                  className={`flag-header sortable-header ${getSortInfo("flagged") ? "sorted" : ""}`}
                  onClick={() => onSort("flagged")}
                >
                  <span className="header-content">
                    <Icon name="flag" size={14} />
                    {getSortInfo("flagged") && (
                      <span className="sort-indicator">
                        <span className="sort-arrow">
                          {getSortInfo("flagged")?.direction === "asc" ? "↑" : "↓"}
                        </span>
                        {getSortInfo("flagged")!.total > 1 && (
                          <span className="sort-priority">{getSortInfo("flagged")?.priority}</span>
                        )}
                      </span>
                    )}
                  </span>
                </th>
              )}
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

                  {visibleColumns.has("date") && <td className="date-cell">{formattedDate}</td>}
                  {visibleColumns.has("collection") && <td>{letter.collectionCode || "—"}</td>}
                  {visibleColumns.has("letters") && <td className="count-cell">{pageCount || "—"}</td>}
                  {visibleColumns.has("extras") && <td className="count-cell">{extrasCount || "—"}</td>}
                  {visibleColumns.has("photos") && <td className="count-cell">{photosCount || "—"}</td>}

                  {visibleColumns.has("transcript") && (
                    <td className="status-cell">
                      {renderStatusIcon(contentStatus, "T")}
                    </td>
                  )}

                  {visibleColumns.has("metadata") && (
                    <td className="status-cell">
                      {renderStatusIcon(letter.metadataContentStatus, "M")}
                    </td>
                  )}

                  {visibleColumns.has("visibility") && (
                    <td>
                      <VisibilityBadge state={letter.visibility} />
                    </td>
                  )}

                  {visibleColumns.has("created") && (
                    <td className="date-cell">{formatDate(letter.createdAt)}</td>
                  )}
                  {visibleColumns.has("updated") && (
                    <td className="date-cell">{letter.updatedAt ? formatDate(letter.updatedAt) : "—"}</td>
                  )}
                  {visibleColumns.has("lastOpened") && (
                    <td className="date-cell">{letter.lastOpenedAt ? formatDate(letter.lastOpenedAt) : "—"}</td>
                  )}
                  {visibleColumns.has("flag") && (
                    <td className="flag-cell">
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
