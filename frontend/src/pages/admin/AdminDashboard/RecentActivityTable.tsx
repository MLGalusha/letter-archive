import type React from "react";
import { VisibilityBadge } from "../../../components/common";
import type { Letter, ContentStatus } from "../../../types/Letter";

type ExtendedSortField =
  | "createdAt"
  | "letterDate"
  | "sender"
  | "recipient"
  | "workflow"
  | "visibility"
  | "collection"
  | "letters"
  | "extras";

type ColumnId =
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
  | "sync";

interface SortInfo {
  direction: "asc" | "desc";
  priority: number;
  total: number;
}

interface PendingChange {
  sender?: string;
  recipient?: string;
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
  checkNeedsSync: (letter: Letter) => boolean;
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
}

export default function RecentActivityTable({
  filteredLetters,
  visibleColumns,
  getSortInfo,
  onSort,
  onRowClick,
  onRowMouseDown,
  onRowMouseEnter,
  selectedIds,
  editMode,
  copyModeActive,
  sourceCell,
  pendingChanges,
  onCellClick,
  formatDate,
  formatDateRaw,
  checkNeedsSync,
  getCombinedTranscriptStatus,
  renderStatusIcon,
  pagination,
  loading,
  onPageChange,
}: RecentActivityTableProps) {
  return (
    <>
      <div className={`letters-table-container ${filteredLetters.length === 0 ? "empty" : ""}`}>
        <table className="letters-table">
          <colgroup>
            {visibleColumns.has("sender") && <col style={{ width: "12%" }} />}
            {visibleColumns.has("recipient") && <col style={{ width: "12%" }} />}
            {visibleColumns.has("date") && <col style={{ width: "100px" }} />}
            {visibleColumns.has("collection") && <col style={{ width: "80px" }} />}
            {visibleColumns.has("letters") && <col style={{ width: "55px" }} />}
            {visibleColumns.has("extras") && <col style={{ width: "50px" }} />}
            {visibleColumns.has("transcript") && <col style={{ width: "70px" }} />}
            {visibleColumns.has("metadata") && <col style={{ width: "70px" }} />}
            {visibleColumns.has("sync") && <col style={{ width: "50px" }} />}
            {visibleColumns.has("visibility") && <col style={{ width: "70px" }} />}
            {visibleColumns.has("created") && <col style={{ width: "80px" }} />}
          </colgroup>
          <thead>
            <tr>
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
              {visibleColumns.has("transcript") && <th className="status-header">Transcript</th>}
              {visibleColumns.has("metadata") && <th className="status-header">Metadata</th>}
              {visibleColumns.has("sync") && (
                <th className="status-header" title="Identity/content sync status">
                  Sync
                </th>
              )}
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
              const formattedDate = formatDateRaw(letter.metadata.dateRaw);

              return (
                <tr
                  key={letter.id}
                  onClick={(e) => onRowClick(letter.id, index, e)}
                  onMouseDown={(e) => onRowMouseDown(index, e)}
                  onMouseEnter={() => onRowMouseEnter(index)}
                  className={`letter-row ${selectedIds.has(letter.id) ? "selected" : ""} ${editMode ? "edit-mode" : ""}`}
                >
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

                  {visibleColumns.has("transcript") && (
                    <td className="status-cell">
                      {renderStatusIcon(
                        getCombinedTranscriptStatus(
                          letter.transcriptStatus,
                          letter.extraContentStatus,
                          letter.images.some((img) => img.type === "letter"),
                          letter.images.some((img) =>
                            ["telegram", "cover", "ephemera"].includes(img.type),
                          ),
                        ),
                        "T",
                      )}
                    </td>
                  )}

                  {visibleColumns.has("metadata") && (
                    <td className="status-cell">
                      {renderStatusIcon(letter.metadataContentStatus, "M")}
                    </td>
                  )}

                  {visibleColumns.has("sync") && (
                    <td className="status-cell sync-cell">
                      {checkNeedsSync(letter) ? (
                        <span
                          className="sync-indicator needs-sync"
                          title="Names may not match summary/hook"
                        >
                          ⚠
                        </span>
                      ) : (
                        <span className="sync-indicator synced" title="Synced">
                          ✓
                        </span>
                      )}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="pagination-controls">
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
        </div>
      )}
    </>
  );
}
