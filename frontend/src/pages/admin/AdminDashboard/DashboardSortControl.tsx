import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../../components/common/Icon";
import type { ExtendedSortField, SortColumn, SortDirection } from "./types";

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

type SortOption = (typeof SORT_OPTIONS)[number];

export default function DashboardSortControl({
  sortColumns,
  setSortColumns,
}: DashboardSortControlProps) {
  const [open, setOpen] = useState(false);
  const [activePicker, setActivePicker] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draftSortColumns, setDraftSortColumns] = useState<SortColumn[]>(sortColumns);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const availableAddOptions = useMemo(
    () => SORT_OPTIONS.filter((option) => !draftSortColumns.some((column) => column.field === option.value)),
    [draftSortColumns],
  );

  const buttonSummary = getSortButtonSummary(sortColumns);
  const hasDraftChanges = !areSortColumnsEqual(draftSortColumns, sortColumns);

  useEffect(() => {
    if (!open) return;
    setDraftSortColumns(sortColumns);
    setActivePicker(null);

    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActivePicker(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, sortColumns]);

  const updateRule = (index: number, nextRule: SortColumn) => {
    setDraftSortColumns((previous) => previous.map((rule, ruleIndex) => (ruleIndex === index ? nextRule : rule)));
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
    setDraftSortColumns((previous) => previous.filter((_, ruleIndex) => ruleIndex !== index));
  };

  const handleAddRule = (field: ExtendedSortField) => {
    setDraftSortColumns((previous) => {
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

    setDraftSortColumns((previous) => {
      const next = [...previous];
      const [movedRule] = next.splice(dragIndex, 1);
      if (!movedRule) return previous;
      next.splice(targetIndex, 0, movedRule);
      return next;
    });
    setDragIndex(null);
  };

  const handleApplySorting = () => {
    setSortColumns(draftSortColumns);
    setActivePicker(null);
    setOpen(false);
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
          {draftSortColumns.length > 0 && (
            <div className="sort-rule-list">
              {draftSortColumns.map((rule, index) => (
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
                  <span className="sort-rule-field">
                    {getFieldLabel(rule.field)}
                  </span>
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
            {availableAddOptions.length > 0 ? (
              <SortFieldPicker
                id="add-rule"
                label="Add sort rule"
                placeholder="Add sort rule"
                options={availableAddOptions}
                activePicker={activePicker}
                onOpenChange={setActivePicker}
                onSelect={handleAddRule}
              />
            ) : (
              <span className="sort-field-empty">All sort options have been added</span>
            )}
            <button
              type="button"
              className="sort-apply-btn"
              onClick={handleApplySorting}
              disabled={!hasDraftChanges}
            >
              Apply sorting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface SortFieldPickerProps {
  id: string;
  label: string;
  value?: ExtendedSortField;
  placeholder?: string;
  options: SortOption[];
  activePicker: string | null;
  onOpenChange: (id: string | null) => void;
  onSelect: (field: ExtendedSortField) => void;
}

function SortFieldPicker({
  id,
  label,
  value,
  placeholder = "Select sort",
  options,
  activePicker,
  onOpenChange,
  onSelect,
}: SortFieldPickerProps) {
  const selectedOption = value ? SORT_OPTIONS.find((option) => option.value === value) : null;
  const open = activePicker === id;

  return (
    <div className="sort-field-picker">
      <button
        type="button"
        className={`sort-field-trigger ${open ? "active" : ""}`}
        onClick={() => onOpenChange(open ? null : id)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>{selectedOption?.label ?? placeholder}</span>
        <Icon name="chevron-down" size={14} />
      </button>

      {open && (
        <div className="sort-field-menu" role="listbox" aria-label={label}>
          {options.length > 0 ? options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`sort-field-option ${option.value === value ? "selected" : ""}`}
              onClick={() => {
                onSelect(option.value);
                onOpenChange(null);
              }}
              role="option"
              aria-selected={option.value === value}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          )) : (
            <span className="sort-field-empty">No more sort rules</span>
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

function areSortColumnsEqual(left: SortColumn[], right: SortColumn[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((column, index) => {
    const nextColumn = right[index];
    return nextColumn?.field === column.field && nextColumn.direction === column.direction;
  });
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
