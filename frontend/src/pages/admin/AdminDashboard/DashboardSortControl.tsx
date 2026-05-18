import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../../components/common/Icon";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { ClientSortField, ServerSortField, SortColumn, SortDirection } from "./types";
import { isServerSortField } from "./utils";

interface DashboardSortControlProps {
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
}

type PrimarySort = SortColumn & { field: ServerSortField };

const PRIMARY_SORT_OPTIONS: Array<{
  value: ServerSortField;
  label: string;
  description: string;
}> = [
  { value: "lastOpenedAt", label: "Last opened", description: "Order by recent admin activity" },
  { value: "letterDate", label: "Letter date", description: "Order by the historical letter date" },
  { value: "collection", label: "Collection", description: "Order by collection number" },
  { value: "createdAt", label: "Created", description: "Order by upload time" },
  { value: "updatedAt", label: "Updated", description: "Order by last record update" },
  { value: "sender", label: "Sender", description: "Order alphabetically by sender" },
  { value: "recipient", label: "Recipient", description: "Order alphabetically by recipient" },
  { value: "visibility", label: "Visibility", description: "Order by public or hidden state" },
  { value: "flagged", label: "Flagged", description: "Group flagged letters together" },
];

export default function DashboardSortControl({
  sortColumns,
  setSortColumns,
}: DashboardSortControlProps) {
  const [open, setOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const clientSortColumns = useMemo(
    () => sortColumns.filter((column): column is SortColumn & { field: ClientSortField } => !isServerSortField(column.field)),
    [sortColumns],
  );

  const primarySort = useMemo(() => {
    const serverSort = [...sortColumns].reverse().find((column) => isServerSortField(column.field));
    if (!serverSort || !isServerSortField(serverSort.field)) {
      return DEFAULT_DASHBOARD_SORT as PrimarySort;
    }

    return {
      field: serverSort.field,
      direction: serverSort.direction,
    };
  }, [sortColumns]);

  const primarySortLabel = useMemo(() => {
    return PRIMARY_SORT_OPTIONS.find((option) => option.value === primarySort.field)?.label ?? "Custom";
  }, [primarySort.field]);

  const primaryDirectionLabel = getDirectionLabel(primarySort.field, primarySort.direction);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handlePrimarySortFieldChange = (field: ServerSortField) => {
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field, direction: primarySort.direction },
    ]);
  };

  const handlePrimarySortDirectionChange = (direction: SortDirection) => {
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field: primarySort.field, direction },
    ]);
  };

  const handleTogglePrimarySortDirection = () => {
    handlePrimarySortDirectionChange(primarySort.direction === "asc" ? "desc" : "asc");
  };

  const handleClearPageSorts = () => {
    setSortColumns((previous) => previous.filter((column) => isServerSortField(column.field)));
  };

  const pageSortSummary = clientSortColumns
    .map((column) => `${getClientSortLabel(column.field)} ${column.direction === "asc" ? "↑" : "↓"}`)
    .join(", ");

  return (
    <div className="dashboard-sort-manager" ref={sortMenuRef}>
      <button
        type="button"
        className={`dashboard-control-btn sort-manager-btn ${open ? "active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span>Sort</span>
        <span className="sort-manager-summary">
          {primarySortLabel}, {primaryDirectionLabel.toLowerCase()}
        </span>
        {clientSortColumns.length > 0 && (
          <span className="sort-manager-badge">{clientSortColumns.length}</span>
        )}
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div className="sort-manager-popover" role="dialog" aria-label="Sort rules">
          <div className="sort-manager-header">
            <div>
              <span className="sort-manager-title">Sort</span>
              <span className="sort-manager-subtitle">
                {getSortDescription(primarySort.field, primarySort.direction)}
              </span>
            </div>
            <button
              type="button"
              className="sort-direction-toggle"
              onClick={handleTogglePrimarySortDirection}
              aria-label={`Reverse sort direction. Current order: ${primaryDirectionLabel}.`}
              title={`Reverse sort direction. Current order: ${primaryDirectionLabel}.`}
            >
              <Icon name="arrow-up-down" size={16} />
            </button>
          </div>

          <section className="sort-manager-section">
            <span className="sort-manager-section-label">Sort by</span>
            <div className="sort-option-list">
              {PRIMARY_SORT_OPTIONS.map((option) => (
                <label key={option.value} className="sort-option">
                  <input
                    type="radio"
                    name="dashboard-primary-sort-field"
                    value={option.value}
                    checked={primarySort.field === option.value}
                    onChange={() => handlePrimarySortFieldChange(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="sort-manager-section">
            <div className="sort-manager-section-heading">
              <span className="sort-manager-section-label">Page sort</span>
              {clientSortColumns.length > 0 && (
                <button type="button" onClick={handleClearPageSorts}>
                  Clear
                </button>
              )}
            </div>
            {clientSortColumns.length > 0 ? (
              <p className="sort-manager-note">
                {pageSortSummary} applies only to the currently loaded page.
              </p>
            ) : (
              <p className="sort-manager-note">
                No page-only sorts. Count columns can be sorted from the table header.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function getDirectionOptions(field: ServerSortField): Array<{ value: SortDirection; label: string }> {
  switch (field) {
    case "lastOpenedAt":
    case "createdAt":
    case "updatedAt":
      return [
        { value: "desc", label: "Newest first" },
        { value: "asc", label: "Oldest first" },
      ];
    case "letterDate":
      return [
        { value: "asc", label: "Oldest first" },
        { value: "desc", label: "Newest first" },
      ];
    case "sender":
    case "recipient":
    case "collection":
      return [
        { value: "asc", label: "A to Z" },
        { value: "desc", label: "Z to A" },
      ];
    case "flagged":
      return [
        { value: "desc", label: "Flagged first" },
        { value: "asc", label: "Unflagged first" },
      ];
    case "visibility":
      return [
        { value: "asc", label: "Hidden first" },
        { value: "desc", label: "Public first" },
      ];
    case "workflow":
      return [
        { value: "asc", label: "Earlier stage first" },
        { value: "desc", label: "Later stage first" },
      ];
  }
}

function getDirectionLabel(field: ServerSortField, direction: SortDirection): string {
  return getDirectionOptions(field).find((option) => option.value === direction)?.label ?? direction;
}

function getSortDescription(field: ServerSortField, direction: SortDirection): string {
  const directionLabel = getDirectionLabel(field, direction).toLowerCase();

  switch (field) {
    case "lastOpenedAt":
      return `Order by recent admin activity, ${directionLabel}.`;
    case "letterDate":
      return `Order by historical letter date, ${directionLabel}.`;
    case "collection":
      return `Order by collection number, ${directionLabel}.`;
    case "createdAt":
      return `Order by upload time, ${directionLabel}.`;
    case "updatedAt":
      return `Order by last record update, ${directionLabel}.`;
    case "sender":
      return `Order by sender, ${directionLabel}.`;
    case "recipient":
      return `Order by recipient, ${directionLabel}.`;
    case "visibility":
      return `Order by visibility, ${directionLabel}.`;
    case "flagged":
      return `Order by flagged state, ${directionLabel}.`;
    case "workflow":
      return `Order by pipeline stage, ${directionLabel}.`;
  }
}

function getClientSortLabel(field: ClientSortField): string {
  switch (field) {
    case "letters":
      return "Letters";
    case "extras":
      return "Extras";
    case "photos":
      return "Photos";
  }
}
