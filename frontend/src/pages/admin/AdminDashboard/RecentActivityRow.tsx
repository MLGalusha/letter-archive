import type React from "react";
import { VisibilityBadge } from "../../../components/common";
import { Icon } from "../../../components/common/Icon";
import type { ContentStatus, Letter } from "../../../types/Letter";
import {
  hasPrimaryTranscriptContent,
  hasRelatedExtraContent,
  shouldShowPhotoDescriptionWorkflow,
} from "../../../utils/letterContent";
import { FILE_TYPE_COLUMNS } from "./constants";
import type { ColumnId, PendingChange } from "./types";

interface RecentActivityRowProps {
  letter: Letter;
  index: number;
  visibleColumns: Set<ColumnId>;
  selectedIds: Set<string>;
  editMode: boolean;
  copyModeActive: boolean;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChanges: Map<string, PendingChange>;
  onRowClick: (letterId: string, index: number, e: React.MouseEvent) => void;
  onRowMouseDown: (index: number, e: React.MouseEvent) => void;
  onRowMouseEnter: (index: number) => void;
  onCheckboxChange: (letterId: string, index: number, e: React.MouseEvent) => void;
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
  onToggleFlag: (letterId: string, flagged: boolean) => void;
}

function CopyableTextCell({
  letter,
  column,
  value,
  visible,
  copyModeActive,
  sourceCell,
  pendingChanges,
  onCellClick,
}: {
  letter: Letter;
  column: "sender" | "recipient";
  value: string | null | undefined;
  visible: boolean;
  copyModeActive: boolean;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChanges: Map<string, PendingChange>;
  onCellClick: RecentActivityRowProps["onCellClick"];
}) {
  if (!visible) return null;

  const pendingValue = pendingChanges.get(letter.id)?.[column];
  const hasPendingValue = pendingChanges.has(letter.id) && pendingValue !== undefined;

  return (
    <td
      data-column={column}
      className={`
        ${copyModeActive ? "copyable-cell" : ""}
        ${sourceCell?.letterId === letter.id && sourceCell?.column === column ? "source-cell" : ""}
        ${hasPendingValue ? "changed-cell" : ""}
      `}
      onClick={(event) =>
        copyModeActive
          ? onCellClick(letter.id, column, value ?? null, event)
          : undefined
      }
    >
      {hasPendingValue ? pendingValue || "—" : value || "—"}
    </td>
  );
}

export default function RecentActivityRow({
  letter,
  index,
  visibleColumns,
  selectedIds,
  editMode,
  copyModeActive,
  sourceCell,
  pendingChanges,
  onRowClick,
  onRowMouseDown,
  onRowMouseEnter,
  onCheckboxChange,
  onCellClick,
  formatDate,
  formatDateRaw,
  getCombinedTranscriptStatus,
  renderStatusIcon,
  onToggleFlag,
}: RecentActivityRowProps) {
  const pageCount =
    letter.lettersCount ??
    letter.images.filter((image) => image.type === "letter").length;
  const extrasCount =
    letter.extrasCount ??
    letter.images.filter((image) => image.type !== "letter").length;
  const photosCount =
    letter.photosCount ??
    letter.images.filter((image) => image.type === "photo").length;
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
      onClick={(event) => onRowClick(letter.id, index, event)}
      onMouseDown={(event) => onRowMouseDown(index, event)}
      onMouseEnter={() => onRowMouseEnter(index)}
      className={`letter-row ${selectedIds.has(letter.id) ? "selected" : ""} ${editMode ? "edit-mode" : ""}`}
    >
      <td
        className="checkbox-cell"
        onClick={(event) => {
          event.stopPropagation();
          onCheckboxChange(letter.id, index, event);
        }}
      >
        <input
          type="checkbox"
          className="row-checkbox"
          checked={selectedIds.has(letter.id)}
          readOnly
          tabIndex={-1}
        />
      </td>

      <CopyableTextCell
        letter={letter}
        column="sender"
        value={letter.metadata.sender}
        visible={visibleColumns.has("sender")}
        copyModeActive={copyModeActive}
        sourceCell={sourceCell}
        pendingChanges={pendingChanges}
        onCellClick={onCellClick}
      />
      <CopyableTextCell
        letter={letter}
        column="recipient"
        value={letter.metadata.recipient}
        visible={visibleColumns.has("recipient")}
        copyModeActive={copyModeActive}
        sourceCell={sourceCell}
        pendingChanges={pendingChanges}
        onCellClick={onCellClick}
      />

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
            onClick={(event) => {
              event.stopPropagation();
              onToggleFlag(letter.id, !letter.flagged);
            }}
            aria-label={letter.flagged ? "Unflag letter" : "Flag letter"}
          >
            <Icon name={letter.flagged ? "flag-filled" : "flag"} size={16} />
          </button>
        </td>
      )}
      {FILE_TYPE_COLUMNS.filter((column) => visibleColumns.has(column.id)).map((column) => {
        const typeKey = column.id.replace("type_", "");
        const count = letter.images.filter((image) => image.type === typeKey).length;
        return <td key={column.id} data-column={column.id} className="count-cell">{count || "—"}</td>;
      })}
    </tr>
  );
}
