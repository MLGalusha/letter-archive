import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FilterChoiceOption } from "./searchBarUtils";
import { filterChoiceOptions, formatFacetLabel } from "./searchBarUtils";

export default memo(function FilterChoiceField({
  id,
  label,
  value,
  placeholder,
  options,
  open,
  searchable = false,
  allowClear = false,
  allowCustom = false,
  clearLabel = "Any",
  multiple = false,
  maxSelections,
  maxValueLength = 120,
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
  allowCustom?: boolean;
  clearLabel?: string;
  multiple?: boolean;
  maxSelections?: number;
  maxValueLength?: number;
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
    if (open && (allowCustom || (searchable && options.length > 6))) {
      searchInputRef.current?.focus();
    }
    if (open && !(allowCustom || (searchable && options.length > 6))) {
      {
        const target = optionsRef.current?.querySelector<HTMLButtonElement>("button.active:not(:disabled)")
          ?? optionsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
        target?.focus();
      }
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
  }, [open, searchable, allowCustom]);

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

  const hasSearch = allowCustom || (searchable && options.length > 6);
  const customValue = searchTerm.trim();
  const canAddCustom = allowCustom && customValue.length > 0 && customValue.length <= maxValueLength
    && !customValue.includes(',')
    && !options.some((option) => option.value.toLowerCase() === customValue.toLowerCase())
    && !selectedValues.some((selected) => selected.toLowerCase() === customValue.toLowerCase())
    && (!maxSelections || selectedValues.length < maxSelections)
    && [...selectedValues, customValue].join(',').length <= maxValueLength;

  const handleOptionClick = (optionValue: string) => {
    if (multiple) {
      const isSelected = selectedValues.includes(optionValue);
      if (isSelected) {
        const next = selectedValues.filter((v) => v !== optionValue);
        onChange(next.join(","));
      } else if ((!maxSelections || selectedValues.length < maxSelections)
        && [...selectedValues, optionValue].join(",").length <= maxValueLength) {
        onChange([...selectedValues, optionValue].join(","));
      }
    } else {
      onChange(optionValue);
      if (closeOnSelect) {
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    }
  };

  return (
    <div className={`filter-choice${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false);
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`filter-choice-trigger${hasValue ? " has-value" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-choices`}
        onClick={() => onOpenChange(!open)}
      >
        <span className="filter-choice-value">{triggerLabel}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`filter-choice-panel${panelDirection === "up" ? " filter-choice-panel-up" : ""}`}
        >
          {hasSearch && (
            <input
              ref={searchInputRef}
              type="search"
              aria-label={`Find ${label.toLowerCase()}`}
              className="filter-input filter-choice-search"
              placeholder={`Find ${label.toLowerCase()}`}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          )}
          <div ref={optionsRef} className={`filter-choice-options${compact ? " filter-choice-options--compact" : ""}`} id={`${id}-choices`} role="group" aria-label={label}>
            {allowCustom && (
              <button type="button" className="filter-choice-option" disabled={!canAddCustom}
                onClick={() => { if (canAddCustom) { handleOptionClick(customValue); setSearchTerm(''); } }}>
                Use typed {label.toLowerCase()}{customValue ? `: ${customValue}` : ''}
              </button>
            )}
            {allowClear && (
              <button
                type="button"
                className={`filter-choice-option${compact ? " filter-choice-option--compact" : ""}${!hasValue ? " active" : ""}`}
                aria-pressed={!hasValue}
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
                const isDisabled = multiple && !isActive && ((maxSelections != null && selectedValues.length >= maxSelections)
                  || [...selectedValues, option.value].join(",").length > maxValueLength);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`filter-choice-option${compact ? " filter-choice-option--compact" : ""}${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}`}
                    aria-pressed={isActive}
                    disabled={isDisabled}
                    onClick={() => handleOptionClick(option.value)}
                  >
                    {multiple && <span className="filter-choice-check" aria-hidden="true">{isActive ? "✓" : ""}</span>}
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
});
