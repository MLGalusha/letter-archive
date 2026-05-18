import type { RefObject, ReactNode } from "react";
import { Icon } from "../../../components/common/Icon";
import ColumnToggleHeader from "./ColumnToggleHeader";
import type { ColumnDef, ColumnId } from "./types";

interface HeaderColumn {
  dataColumn: string;
  label: ReactNode;
  className?: string;
}

const HEADER_COLUMNS: Record<ColumnId, HeaderColumn> = {
  sender: { dataColumn: "sender", label: "Sender" },
  recipient: { dataColumn: "recipient", label: "Recipient" },
  date: { dataColumn: "date", className: "date-header", label: "Date" },
  collection: {
    dataColumn: "collection",
    label: (
      <>
        <span className="desktop-header-label">Collection</span>
        <span className="mobile-header-label">Coll.</span>
      </>
    ),
  },
  letters: { dataColumn: "letters", label: "Letters" },
  extras: { dataColumn: "extras", label: "Extras" },
  photos: { dataColumn: "photos", label: "Photos" },
  transcript: { dataColumn: "transcript", className: "status-header", label: "Transcript" },
  metadata: { dataColumn: "metadata", className: "status-header", label: "Metadata" },
  visibility: { dataColumn: "visibility", label: "Visibility" },
  created: { dataColumn: "created", label: "Created" },
  updated: { dataColumn: "updated", label: "Updated" },
  lastOpened: {
    dataColumn: "lastOpened",
    label: (
      <>
        <span className="desktop-header-label">Last Opened</span>
        <span className="mobile-header-label">Opened</span>
      </>
    ),
  },
  flag: {
    dataColumn: "flag",
    className: "flag-header",
    label: <Icon name="flag" size={14} />,
  },
  type_letter: { dataColumn: "type_letter", label: "Letters" },
  type_cover: { dataColumn: "type_cover", label: "Covers" },
  type_telegram: { dataColumn: "type_telegram", label: "Telegrams" },
  type_photo: { dataColumn: "type_photo", label: "Photos" },
  type_card: { dataColumn: "type_card", label: "Cards" },
  type_ephemera: { dataColumn: "type_ephemera", label: "Ephemera" },
  type_voice: { dataColumn: "type_voice", label: "Voice" },
  type_article: { dataColumn: "type_article", label: "Articles" },
  type_diary: { dataColumn: "type_diary", label: "Diary" },
};

interface RecentActivityTableHeaderProps {
  visibleColumns: Set<ColumnId>;
  orderedColumns: ColumnDef[];
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  onMoveColumn: (id: ColumnId, direction: -1 | 1) => void;
  onReorderColumn: (id: ColumnId, targetIndex: number) => void;
  onResetColumnOrder: () => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
}

export default function RecentActivityTableHeader({
  visibleColumns,
  orderedColumns,
  showColumnMenu,
  onToggleColumnMenu,
  onToggleColumn,
  onMoveColumn,
  onReorderColumn,
  onResetColumnOrder,
  columnMenuRef,
}: RecentActivityTableHeaderProps) {
  return (
    <thead>
      <tr>
        <ColumnToggleHeader
          orderedColumns={orderedColumns}
          visibleColumns={visibleColumns}
          showColumnMenu={showColumnMenu}
          onToggleColumnMenu={onToggleColumnMenu}
          onToggleColumn={onToggleColumn}
          onMoveColumn={onMoveColumn}
          onReorderColumn={onReorderColumn}
          onResetColumnOrder={onResetColumnOrder}
          columnMenuRef={columnMenuRef}
        />
        {orderedColumns.filter((column) => visibleColumns.has(column.id)).map((column) => {
          const header = HEADER_COLUMNS[column.id];
          return (
            <th key={column.id} data-column={header.dataColumn} className={header.className}>
              {header.label}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
