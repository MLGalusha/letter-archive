import type { RefObject, ReactNode } from "react";
import { Icon } from "../../../components/common/Icon";
import ColumnToggleHeader from "./ColumnToggleHeader";
import { FILE_TYPE_COLUMNS } from "./constants";
import SortableTableHeader from "./SortableTableHeader";
import type { ColumnId, ExtendedSortField, SortInfo } from "./types";

interface HeaderColumn {
  id: ColumnId;
  field: ExtendedSortField;
  dataColumn: string;
  label: ReactNode;
  className?: string;
}

const SORTABLE_HEADER_COLUMNS: HeaderColumn[] = [
  { id: "sender", field: "sender", dataColumn: "sender", label: "Sender" },
  { id: "recipient", field: "recipient", dataColumn: "recipient", label: "Recipient" },
  { id: "date", field: "letterDate", dataColumn: "date", className: "date-header", label: "Date" },
  {
    id: "collection",
    field: "collection",
    dataColumn: "collection",
    label: (
      <>
        <span className="desktop-header-label">Collection</span>
        <span className="mobile-header-label">Coll.</span>
      </>
    ),
  },
  { id: "letters", field: "letters", dataColumn: "letters", label: "Letters" },
  { id: "extras", field: "extras", dataColumn: "extras", label: "Extras" },
  { id: "photos", field: "photos", dataColumn: "photos", label: "Photos" },
  { id: "created", field: "createdAt", dataColumn: "created", label: "Created" },
  { id: "updated", field: "updatedAt", dataColumn: "updated", label: "Updated" },
  {
    id: "lastOpened",
    field: "lastOpenedAt",
    dataColumn: "lastOpened",
    label: (
      <>
        <span className="desktop-header-label">Last Opened</span>
        <span className="mobile-header-label">Opened</span>
      </>
    ),
  },
  {
    id: "flag",
    field: "flagged",
    dataColumn: "flag",
    className: "flag-header",
    label: <Icon name="flag" size={14} />,
  },
];

interface RecentActivityTableHeaderProps {
  visibleColumns: Set<ColumnId>;
  getSortInfo: (field: ExtendedSortField) => SortInfo | null;
  onSort: (field: ExtendedSortField) => void;
  allColumns: Array<{ id: ColumnId; label: string }>;
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
}

export default function RecentActivityTableHeader({
  visibleColumns,
  getSortInfo,
  onSort,
  allColumns,
  showColumnMenu,
  onToggleColumnMenu,
  onToggleColumn,
  columnMenuRef,
}: RecentActivityTableHeaderProps) {
  return (
    <thead>
      <tr>
        <ColumnToggleHeader
          allColumns={allColumns}
          visibleColumns={visibleColumns}
          showColumnMenu={showColumnMenu}
          onToggleColumnMenu={onToggleColumnMenu}
          onToggleColumn={onToggleColumn}
          columnMenuRef={columnMenuRef}
        />
        {SORTABLE_HEADER_COLUMNS.filter((column) => visibleColumns.has(column.id)).map((column) => (
          <SortableTableHeader
            key={column.id}
            field={column.field}
            dataColumn={column.dataColumn}
            className={column.className}
            label={column.label}
            getSortInfo={getSortInfo}
            onSort={onSort}
          />
        ))}
        {visibleColumns.has("transcript") && (
          <th data-column="transcript" className="status-header">Transcript</th>
        )}
        {visibleColumns.has("metadata") && (
          <th data-column="metadata" className="status-header">Metadata</th>
        )}
        {visibleColumns.has("visibility") && (
          <th data-column="visibility">Visibility</th>
        )}
        {FILE_TYPE_COLUMNS.filter((col) => visibleColumns.has(col.id)).map((col) => (
          <th key={col.id} data-column={col.id}>{col.label}</th>
        ))}
      </tr>
    </thead>
  );
}
