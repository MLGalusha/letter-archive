import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterChoiceOption } from "./searchBarUtils";
import { filterChoiceOptions, formatFacetLabel } from "./searchBarUtils";
import useTimerDropdown from "./useTimerDropdown";

export default function FilterChoiceField({
  id,
  label,
  value,
  placeholder,
  options,
  open,
  searchable = false,
  allowClear = false,
  clearLabel = "Any",
  multiple = false,
  maxSelections,
  compact = false,
  closeOnSelect = false,
  onChange,
  onOpenChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options: FilterChoiceOption[];
  open: boolean;
  searchable?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  multiple?: boolean;
  maxSelections?: number;
  compact?: boolean;
  closeOnSelect?: boolean;
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [panelDirection, setPanelDirection] = useState<"down" | "up">("down");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const selectedValues = multiple ? (value ? value.split(",") : []) : [];
  const selectedOption = multiple ? null : options.find((option) => option.value === value) || null;
  const hasValue = multiple ? selectedValues.length > 0 : Boolean(selectedOption);

  const triggerLabel = multiple
    ? selectedValues.length > 1
      ? `${selectedValues.length} selected`
      : selectedValues.length === 1
        ? (options.find((o) => o.value === selectedValues[0])?.label || formatFacetLabel(selectedValues[0]))
        : placeholder
    : selectedOption?.label || placeholder;

  const filteredOptions = useMemo(
    () => filterChoiceOptions(options, searchTerm),
    [options, searchTerm],
  );

  const optionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && searchable) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
    if (open && hasValue && optionsRef.current) {
      // Scroll to center the selected item
      window.requestAnimationFrame(() => {
        const container = optionsRef.current;
        if (!container) return;
        const activeEl = container.querySelector(".active") as HTMLElement | null;
        if (activeEl) {
          const containerH = container.clientHeight;
          const scrollTarget = activeEl.offsetTop - containerH / 2 + activeEl.offsetHeight / 2;
          container.scrollTop = Math.max(0, scrollTarget);
        }
      });
    }
    if (!open) {
      setSearchTerm("");
    }
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;

    const measureDirection = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!triggerRect || !panelRect) return;

      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      const nextDirection = panelRect.height > spaceBelow && spaceAbove > spaceBelow ? "up" : "down";
      setPanelDirection(nextDirection);
    };

    measureDirection();
    window.addEventListener("resize", measureDirection);
    return () => window.removeEventListener("resize", measureDirection);
  }, [filteredOptions.length, open]);

  const hasSearch = searchable && options.length > 6;

  const { clearTimer, scheduleClose } = useTimerDropdown({
    delay: 400,
    pinned: false,
    onClose: () => onOpenChange(false),
  });

  // Clear any pending close timer when this dropdown closes (prevents stale timers from closing other dropdowns)
  useEffect(() => {
    if (!open) clearTimer();
  }, [open]);

  const handleOptionClick = (optionValue: string) => {
    if (multiple) {
      const isSelected = selectedValues.includes(optionValue);
      if (isSelected) {
        const next = selectedValues.filter((v) => v !== optionValue);
        onChange(next.join(","));
      } else if (!maxSelections || selectedValues.length < maxSelections) {
        onChange([...selectedValues, optionValue].join(","));
      }
    } else {
      onChange(optionValue);
      if (closeOnSelect) {
        clearTimer();
        onOpenChange(false);
      }
    }
  };

  return (
    <div className={`filter-choice${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`filter-choice-trigger${hasValue ? " has-value" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => { clearTimer(); onOpenChange(!open); }}
        onMouseEnter={clearTimer}
        onMouseLeave={scheduleClose}
      >
        <span className="filter-choice-value">{triggerLabel}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`filter-choice-panel${panelDirection === "up" ? " filter-choice-panel-up" : ""}`}
          onMouseEnter={clearTimer}
          onMouseLeave={scheduleClose}
        >
          {hasSearch && (
            <input
              ref={searchInputRef}
              type="search"
              className="filter-input filter-choice-search"
              placeholder={`Find ${label.toLowerCase()}`}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          )}
          <div ref={optionsRef} className={`filter-choice-options${compact ? " filter-choice-options--compact" : ""}`} role="listbox" aria-label={label}>
            {allowClear && (
              <button
                type="button"
                className={`filter-choice-option${compact ? " filter-choice-option--compact" : ""}${!hasValue ? " active" : ""}`}
                onClick={() => onChange("")}
              >
                <span>{clearLabel}</span>
              </button>
            )}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isActive = multiple
                  ? selectedValues.includes(option.value)
                  : option.value === value;
                const isDisabled = multiple && !isActive && maxSelections != null && selectedValues.length >= maxSelections;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`filter-choice-option${compact ? " filter-choice-option--compact" : ""}${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}`}
                    disabled={isDisabled}
                    onClick={() => handleOptionClick(option.value)}
                  >
                    {multiple && <span className="filter-choice-check">{isActive ? "✓" : ""}</span>}
                    <span>{option.label}</span>
                    {typeof option.count === "number" && (
                      <span className="filter-choice-count">{option.count}</span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="filter-choice-empty">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
