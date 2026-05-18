import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../../components/common/Icon";
import type { ExtendedSortField, SortColumn, SortDirection } from "./types";
import { isServerSortField } from "./utils";

interface DashboardSortControlProps {
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
}

const SORT_OPTIONS: Array<{
  value: ExtendedSortField;
  label: string;
  description: string;
}> = [
  { value: "lastOpenedAt", label: "Last opened", description: "Recent admin activity" },
  { value: "letterDate", label: "Letter date", description: "Historical letter date" },
  { value: "collection", label: "Collection", description: "Collection number" },
  { value: "createdAt", label: "Created", description: "Upload time" },
  { value: "updatedAt", label: "Updated", description: "Last record update" },
  { value: "sender", label: "Sender", description: "Sender name" },
  { value: "recipient", label: "Recipient", description: "Recipient name" },
  { value: "visibility", label: "Visibility", description: "Public or hidden state" },
  { value: "flagged", label: "Flagged", description: "Flagged state" },
  { value: "letters", label: "Letters", description: "Letter-page count" },
  { value: "extras", label: "Extras", description: "Extra-content count" },
  { value: "photos", label: "Photos", description: "Photo count" },
];

export default function DashboardSortControl({
  sortColumns,
  setSortColumns,
}: DashboardSortControlProps) {
  const [open, setOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const availableAddOptions = useMemo(
    () => SORT_OPTIONS.filter((option) => !sortColumns.some((column) => column.field === option.value)),
    [sortColumns],
  );

  const primaryServerSortIndex = sortColumns.findIndex((column) => isServerSortField(column.field));
  const hasSecondaryRules = sortColumns.length > 1;
  const hasCurrentPageRules = sortColumns.some((column, index) => {
    if (!isServerSortField(column.field)) return true;
    return primaryServerSortIndex !== -1 && index !== primaryServerSortIndex;
  });

  const buttonSummary = getSortButtonSummary(sortColumns);

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

  const updateRule = (index: number, nextRule: SortColumn) => {
    setSortColumns((previous) => previous.map((rule, ruleIndex) => (ruleIndex === index ? nextRule : rule)));
  };

  const handleFieldChange = (index: number, field: ExtendedSortField) => {
    setSortColumns((previous) => {
      if (previous.some((rule, ruleIndex) => ruleIndex !== index && rule.field === field)) {
        return previous;
      }

      return previous.map((rule, ruleIndex) => (
        ruleIndex === index
          ? { field, direction: getDefaultDirection(field) }
          : rule
      ));
    });
  };

  const handleToggleDirection = (index: number) => {
    const currentRule = sortColumns[index];
    if (!currentRule) return;

    updateRule(index, {
      ...currentRule,
      direction: currentRule.direction === "asc" ? "desc" : "asc",
    });
  };

  const handleRemoveRule = (index: number) => {
    setSortColumns((previous) => previous.filter((_, ruleIndex) => ruleIndex !== index));
  };

  const handleAddRule = (field: ExtendedSortField) => {
    setSortColumns((previous) => {
      if (previous.some((rule) => rule.field === field)) {
        return previous;
      }

      return [...previous, { field, direction: getDefaultDirection(field) }];
    });
  };

  const handleDropRule = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }

    setSortColumns((previous) => {
      const next = [...previous];
      const [movedRule] = next.splice(dragIndex, 1);
      if (!movedRule) return previous;
      next.splice(targetIndex, 0, movedRule);
      return next;
    });
    setDragIndex(null);
  };

  return (
    <div className="dashboard-sort-manager" ref={sortMenuRef}>
      <button
        type="button"
        className={`dashboard-control-btn sort-manager-btn ${open ? "active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Icon name="table" size={15} />
        <span>{buttonSummary.label}</span>
        {buttonSummary.detail && (
          <span className="sort-manager-summary">{buttonSummary.detail}</span>
        )}
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div className="sort-manager-popover" role="dialog" aria-label="Sort rules">
          <div className="sort-manager-header">
            <div>
              <span className="sort-manager-title">
                {sortColumns.length > 0 ? `Sorted by ${sortColumns.length} rule${sortColumns.length === 1 ? "" : "s"}` : "No sorts applied"}
              </span>
              <span className="sort-manager-subtitle">
                {sortColumns.length > 0
                  ? "Drag rules to rank them. The first server-backed rule sorts the full result set."
                  : "Add a column below to sort the view."}
              </span>
            </div>
          </div>

          {sortColumns.length > 0 && (
            <div className="sort-rule-list">
              {sortColumns.map((rule, index) => (
                <div
                  key={rule.field}
                  className="sort-rule-row"
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDropRule(index)}
                >
                  <button
                    type="button"
                    className="sort-rule-grip"
                    aria-label={`Drag ${getFieldLabel(rule.field)} sort rule`}
                    title="Drag to reorder"
                  >
                    <Icon name="grip-vertical" size={16} />
                  </button>
                  <span className="sort-rule-prefix">{index === 0 ? "sort by" : "then by"}</span>
                  <select
                    className="sort-rule-field"
                    value={rule.field}
                    onChange={(event) => handleFieldChange(index, event.target.value as ExtendedSortField)}
                    aria-label={`Sort rule ${index + 1} column`}
                  >
                    {SORT_OPTIONS.filter((option) => (
                      option.value === rule.field ||
                      !sortColumns.some((column) => column.field === option.value)
                    )).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="sort-rule-direction-label">ascending</span>
                  <button
                    type="button"
                    className={`sort-rule-direction ${rule.direction === "asc" ? "active" : ""}`}
                    onClick={() => handleToggleDirection(index)}
                    aria-label={`${getFieldLabel(rule.field)} is sorted ${getDirectionLabel(rule.field, rule.direction)}. Toggle direction.`}
                    title={`${getDirectionLabel(rule.field, rule.direction)}. Toggle direction.`}
                  >
                    <span />
                  </button>
                  <button
                    type="button"
                    className="sort-rule-remove"
                    onClick={() => handleRemoveRule(index)}
                    aria-label={`Remove ${getFieldLabel(rule.field)} sort rule`}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="sort-manager-footer">
            <select
              className="sort-add-select"
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  handleAddRule(event.target.value as ExtendedSortField);
                }
              }}
              aria-label={sortColumns.length > 0 ? "Pick another column to sort by" : "Pick a column to sort by"}
            >
              <option value="">
                {sortColumns.length > 0 ? "Pick another column to sort by" : "Pick a column to sort by"}
              </option>
              {availableAddOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.description}
                </option>
              ))}
            </select>
          </div>

          {hasSecondaryRules && hasCurrentPageRules && (
            <p className="sort-manager-note">
              Secondary rules refine the currently loaded page until the API supports ranked server-side sorting.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function getSortButtonSummary(sortColumns: SortColumn[]): { label: string; detail?: string } {
  if (sortColumns.length === 0) {
    return { label: "Sort" };
  }

  if (sortColumns.length > 1) {
    return { label: `Sorted by ${sortColumns.length} rules` };
  }

  const [rule] = sortColumns;
  return {
    label: "Sort",
    detail: `${getFieldLabel(rule.field)}, ${getDirectionLabel(rule.field, rule.direction).toLowerCase()}`,
  };
}

function getDefaultDirection(field: ExtendedSortField): SortDirection {
  switch (field) {
    case "lastOpenedAt":
    case "createdAt":
    case "updatedAt":
    case "flagged":
    case "letters":
    case "extras":
    case "photos":
      return "desc";
    case "letterDate":
    case "sender":
    case "recipient":
    case "workflow":
    case "visibility":
    case "collection":
      return "asc";
  }
}

function getDirectionLabel(field: ExtendedSortField, direction: SortDirection): string {
  if (field === "flagged") {
    return direction === "asc" ? "unflagged first" : "flagged first";
  }

  if (field === "letters" || field === "extras" || field === "photos") {
    return direction === "asc" ? "low to high" : "high to low";
  }

  switch (field) {
    case "lastOpenedAt":
    case "createdAt":
    case "updatedAt":
    case "letterDate":
      return direction === "asc" ? "oldest first" : "newest first";
    case "sender":
    case "recipient":
    case "collection":
      return direction === "asc" ? "A to Z" : "Z to A";
    case "visibility":
      return direction === "asc" ? "hidden first" : "public first";
    case "workflow":
      return direction === "asc" ? "earlier stage first" : "later stage first";
  }
}

function getFieldLabel(field: ExtendedSortField): string {
  return SORT_OPTIONS.find((option) => option.value === field)?.label ?? field;
}
