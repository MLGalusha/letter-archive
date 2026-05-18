import type { Dispatch, SetStateAction } from "react";
import { useMemo, useRef, useState } from "react";
import Icon from "../../../components/common/Icon";
import DashboardManagerSurface from "./DashboardManagerSurface";
import {
  areSortColumnsEqual,
  getDefaultDirection,
  getDirectionLabel,
  getFieldLabel,
  getSortButtonSummary,
  SORT_OPTIONS,
  type SortOption,
} from "./dashboardSortModel";
import type { ExtendedSortField, SortColumn } from "./types";

interface DashboardSortControlProps {
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
}

export default function DashboardSortControl({
  sortColumns,
  setSortColumns,
}: DashboardSortControlProps) {
  const [open, setOpen] = useState(false);
  const [addRulePickerOpen, setAddRulePickerOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draftSortColumns, setDraftSortColumns] = useState<SortColumn[]>(sortColumns);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const availableAddOptions = useMemo(
    () => SORT_OPTIONS.filter((option) => !draftSortColumns.some((column) => column.field === option.value)),
    [draftSortColumns],
  );

  const buttonSummary = getSortButtonSummary(sortColumns);
  const hasDraftChanges = !areSortColumnsEqual(draftSortColumns, sortColumns);

  const handleToggleOpen = () => {
    setOpen((current) => {
      if (current) {
        setAddRulePickerOpen(false);
        return false;
      }

      setDraftSortColumns(sortColumns);
      setAddRulePickerOpen(false);
      return true;
    });
  };

  const handleToggleDirection = (index: number) => {
    setDraftSortColumns((previous) => previous.map((rule, ruleIndex) => {
      if (ruleIndex !== index) return rule;

      return {
        ...rule,
        direction: rule.direction === "asc" ? "desc" : "asc",
      };
    }));
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
    setAddRulePickerOpen(false);
    setOpen(false);
  };

  const handleClose = () => {
    setOpen(false);
    setAddRulePickerOpen(false);
  };

  return (
    <div className="dashboard-sort-manager" ref={sortMenuRef}>
      <button
        type="button"
        className={`dashboard-control-btn sort-manager-btn ${open ? "active" : ""}`}
        onClick={handleToggleOpen}
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
        <DashboardManagerSurface
          title="Sort"
          ariaLabel="Sort rules"
          closeBoundaryRef={sortMenuRef}
          className="sort-manager-popover"
          onClose={handleClose}
          footer={(
            <>
              {availableAddOptions.length > 0 ? (
                <SortFieldPicker
                  label="Add sort rule"
                  placeholder="Add sort rule"
                  options={availableAddOptions}
                  open={addRulePickerOpen}
                  onToggle={() => setAddRulePickerOpen((current) => !current)}
                  onClose={() => setAddRulePickerOpen(false)}
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
            </>
          )}
        >
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
                  <span className="sort-rule-direction-label">
                    {getDirectionLabel(rule.field, rule.direction)}
                  </span>
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
        </DashboardManagerSurface>
      )}
    </div>
  );
}

interface SortFieldPickerProps {
  label: string;
  value?: ExtendedSortField;
  placeholder?: string;
  options: SortOption[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (field: ExtendedSortField) => void;
}

function SortFieldPicker({
  label,
  value,
  placeholder = "Select sort",
  options,
  open,
  onToggle,
  onClose,
  onSelect,
}: SortFieldPickerProps) {
  const selectedOption = value ? SORT_OPTIONS.find((option) => option.value === value) : null;

  return (
    <div className="sort-field-picker">
      <button
        type="button"
        className={`sort-field-trigger ${open ? "active" : ""}`}
        onClick={onToggle}
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
                onClose();
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
