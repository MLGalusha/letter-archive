import { VisibilityBadge } from "../../../components/common";
import { Icon } from "../../../components/common/Icon";
import type {
  AdminLetterSummary,
  LetterImageType,
} from "../../../types/Letter";
import {
  hasPrimaryTranscriptType,
  isPrimaryPhotoType,
  isRelatedExtraType,
} from "../../../utils/letterContent";
import type {
  TableColumnModel,
  TableCopyEditModel,
  TableFormattingModel,
  TableRowActions,
  TableSelectionModel,
} from "./RecentActivityTable";
import RowSelectionCheckboxCell from "./RowSelectionCheckboxCell";
import type { PendingChange } from "./types";

interface RecentActivityRowProps {
  letter: AdminLetterSummary;
  index: number;
  columns: TableColumnModel;
  selection: TableSelectionModel;
  copyEdit: TableCopyEditModel;
  formatting: TableFormattingModel;
  rowActions: TableRowActions;
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
  letter: AdminLetterSummary;
  column: "sender" | "recipient";
  value: string | null | undefined;
  visible: boolean;
  copyModeActive: boolean;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChanges: Map<string, PendingChange>;
  onCellClick: TableCopyEditModel["onCellClick"];
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
          ? onCellClick(
              letter.id,
              letter.primarySourceRevision,
              column,
              value ?? null,
              event,
            )
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
  columns,
  selection,
  copyEdit,
  formatting,
  rowActions,
}: RecentActivityRowProps) {
  const { visibleColumns } = columns;
  const { selectedIds } = selection;
  const pageCount = letter.pageCountsByType.letter;
  const extrasCount = Object.entries(letter.pageCountsByType)
    .reduce((total, [type, count]) => (
      type === "letter" ? total : total + count
    ), 0);
  const photosCount = letter.pageCountsByType.photo;
  const formattedDate = formatting.formatDateRaw(letter.metadata.dateRaw);
  const isSelected = selectedIds.has(letter.id);
  const contentStatus = isPrimaryPhotoType(letter.primaryImageType)
    ? letter.photoDescriptionStatus
    : formatting.getCombinedTranscriptStatus(
        letter.transcriptStatus,
        letter.extraContentStatus,
        hasPrimaryTranscriptType(letter.primaryImageType),
        letter.primaryImageType === "letter"
          && Object.entries(letter.pageCountsByType).some(
            ([type, count]) => (
              count > 0 && isRelatedExtraType(type as LetterImageType)
            ),
          ),
      );
  const renderColumnCell = (columnId: string) => {
    switch (columnId) {
      case "sender":
        return (
          <CopyableTextCell
            key={columnId}
            letter={letter}
            column="sender"
            value={letter.metadata.sender}
            visible
            copyModeActive={copyEdit.copyModeActive}
            sourceCell={copyEdit.sourceCell}
            pendingChanges={copyEdit.pendingChanges}
            onCellClick={copyEdit.onCellClick}
          />
        );
      case "recipient":
        return (
          <CopyableTextCell
            key={columnId}
            letter={letter}
            column="recipient"
            value={letter.metadata.recipient}
            visible
            copyModeActive={copyEdit.copyModeActive}
            sourceCell={copyEdit.sourceCell}
            pendingChanges={copyEdit.pendingChanges}
            onCellClick={copyEdit.onCellClick}
          />
        );
      case "date":
        return <td key={columnId} data-column="date" className="date-cell">{formattedDate}</td>;
      case "collection":
        return <td key={columnId} data-column="collection">{letter.collectionCode || "—"}</td>;
      case "letters":
        return <td key={columnId} data-column="letters" className="count-cell">{pageCount || "—"}</td>;
      case "extras":
        return <td key={columnId} data-column="extras" className="count-cell">{extrasCount || "—"}</td>;
      case "photos":
        return <td key={columnId} data-column="photos" className="count-cell">{photosCount || "—"}</td>;
      case "transcript":
        return (
          <td key={columnId} data-column="transcript" className="status-cell">
            {formatting.renderStatusIcon(contentStatus, "T")}
          </td>
        );
      case "metadata":
        return (
          <td key={columnId} data-column="metadata" className="status-cell">
            {formatting.renderStatusIcon(letter.metadataContentStatus, "M")}
          </td>
        );
      case "visibility":
        return (
          <td key={columnId} data-column="visibility">
            <VisibilityBadge state={letter.visibility} />
          </td>
        );
      case "created":
        return <td key={columnId} data-column="created" className="date-cell">{formatting.formatDate(letter.createdAt)}</td>;
      case "updated":
        return <td key={columnId} data-column="updated" className="date-cell">{letter.updatedAt ? formatting.formatDate(letter.updatedAt) : "—"}</td>;
      case "lastOpened":
        return <td key={columnId} data-column="lastOpened" className="date-cell">{letter.lastOpenedAt ? formatting.formatDate(letter.lastOpenedAt) : "—"}</td>;
      case "flag":
        return (
          <td key={columnId} data-column="flag" className="flag-cell">
            <button
              type="button"
              className={`flag-btn ${letter.flagged ? "flagged" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                rowActions.onToggleFlag(letter.id, !letter.flagged);
              }}
              aria-label={letter.flagged ? "Unflag letter" : "Flag letter"}
            >
              <Icon name={letter.flagged ? "flag-filled" : "flag"} size={16} />
            </button>
          </td>
        );
      default: {
        if (!columnId.startsWith("type_")) return null;
        const typeKey = columnId.replace("type_", "") as LetterImageType;
        const count = letter.pageCountsByType[typeKey];
        return <td key={columnId} data-column={columnId} className="count-cell">{count || "—"}</td>;
      }
    }
  };

  return (
    <tr
      key={letter.id}
      onClick={(event) => selection.onRowClick(letter.id, index, event)}
      onMouseDown={(event) => selection.onRowMouseDown(index, event)}
      onMouseEnter={() => selection.onRowMouseEnter(index)}
      className={`letter-row ${isSelected ? "selected" : ""} ${copyEdit.editMode ? "edit-mode" : ""}`}
      aria-selected={isSelected}
    >
      <RowSelectionCheckboxCell
        label={`Select ${letter.title || formattedDate || "letter"}`}
        checked={isSelected}
        onChange={(options) => selection.onCheckboxChange(letter.id, index, options)}
      />

      {columns.orderedColumns
        .filter((column) => visibleColumns.has(column.id))
        .map((column) => renderColumnCell(column.id))}
    </tr>
  );
}
