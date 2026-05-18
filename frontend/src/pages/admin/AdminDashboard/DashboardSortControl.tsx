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

const PRIMARY_SORT_OPTIONS: Array<{
  value: `${ServerSortField}:${SortDirection}`;
  label: string;
  description: string;
}> = [
  { value: "lastOpenedAt:desc", label: "Last opened", description: "Recently opened first" },
  { value: "letterDate:asc", label: "Letter date oldest", description: "Earliest letter date first" },
  { value: "letterDate:desc", label: "Letter date newest", description: "Latest letter date first" },
  { value: "collection:asc", label: "Collection", description: "Collection order" },
  { value: "createdAt:desc", label: "Created newest", description: "Newest upload first" },
  { value: "sender:asc", label: "Sender", description: "Sender A to Z" },
  { value: "recipient:asc", label: "Recipient", description: "Recipient A to Z" },
  { value: "visibility:asc", label: "Visibility", description: "Visibility state" },
  { value: "flagged:desc", label: "Flagged", description: "Flagged letters first" },
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

  const primarySortValue = useMemo(() => {
    const serverSort = [...sortColumns].reverse().find((column) => isServerSortField(column.field));
    if (!serverSort) return `${DEFAULT_DASHBOARD_SORT.field}:${DEFAULT_DASHBOARD_SORT.direction}`;
    return `${serverSort.field}:${serverSort.direction}`;
  }, [sortColumns]);

  const primarySortLabel = useMemo(() => {
    return PRIMARY_SORT_OPTIONS.find((option) => option.value === primarySortValue)?.label ?? "Custom";
  }, [primarySortValue]);

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

  const handlePrimarySortChange = (value: string) => {
    const [field, direction] = value.split(":") as [ServerSortField, SortDirection];
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field, direction },
    ]);
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
        <span className="sort-manager-summary">{primarySortLabel}</span>
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
              <span className="sort-manager-subtitle">Full result set first, page sorts second</span>
            </div>
          </div>

          <section className="sort-manager-section">
            <span className="sort-manager-section-label">Primary sort</span>
            <div className="sort-option-list">
              {PRIMARY_SORT_OPTIONS.map((option) => (
                <label key={option.value} className="sort-option">
                  <input
                    type="radio"
                    name="dashboard-primary-sort"
                    value={option.value}
                    checked={primarySortValue === option.value}
                    onChange={() => handlePrimarySortChange(option.value)}
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
