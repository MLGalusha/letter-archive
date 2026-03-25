import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import type { ArchiveSearchFacets, LetterImageType } from "../../types/Letter";
import "./SearchBar.css";

interface SearchBarProps {
  query: string;
  filters: SearchFilters;
  facets: ArchiveSearchFacets;
  total: number;
  loading: boolean;
  embedded?: boolean;
  variant?: "full" | "compact";
  dockTriggerRef?: Ref<HTMLDivElement>;
  onQueryChange: (query: string) => void;
  onFiltersChange: (filters: SearchFilters) => void;
}

export interface SearchFilters {
  format?: LetterImageType | null;
  person?: string | null;
  place?: string | null;
  year?: number | null;
  dateRange?: { start?: number; end?: number };
  verified?: boolean | null;
  sort?: "relevance" | "createdAt" | "letterDate";
  sortOrder?: "asc" | "desc";
}

const SORT_OPTIONS: Array<{
  label: string;
  sort: NonNullable<SearchFilters["sort"]>;
  sortOrder: NonNullable<SearchFilters["sortOrder"]>;
}> = [
  { label: "Best Match", sort: "relevance", sortOrder: "desc" },
  { label: "Newest Added", sort: "createdAt", sortOrder: "desc" },
  { label: "Earliest Date", sort: "letterDate", sortOrder: "asc" },
];

const COMPACT_REFINE_CLOSE_DELAY_MS = 900;

function getResolvedSort(query: string, filters: SearchFilters) {
  const hasQuery = Boolean(query.trim());
  return {
    sort: filters.sort || (hasQuery ? "relevance" : "createdAt"),
    sortOrder: filters.sortOrder || "desc",
  };
}

function sameSort(
  query: string,
  filters: SearchFilters,
  option: (typeof SORT_OPTIONS)[number],
): boolean {
  const resolved = getResolvedSort(query, filters);
  return resolved.sort === option.sort && resolved.sortOrder === option.sortOrder;
}

export default function SearchBar({
  query,
  filters,
  facets,
  total,
  loading,
  embedded = false,
  variant = "full",
  dockTriggerRef,
  onQueryChange,
  onFiltersChange,
}: SearchBarProps) {
  const isCompact = variant === "compact";
  const hasQuery = Boolean(query.trim());
  const hasRefinementFilters = Boolean(
    filters.person
      || filters.place
      || filters.year
      || filters.dateRange?.start
      || filters.dateRange?.end
      || filters.verified !== undefined && filters.verified !== null,
  );
  const [showFilters, setShowFilters] = useState(isCompact ? false : hasRefinementFilters);
  const [compactFiltersPinned, setCompactFiltersPinned] = useState(false);
  const [startYearInput, setStartYearInput] = useState(filters.dateRange?.start?.toString() || "");
  const [endYearInput, setEndYearInput] = useState(filters.dateRange?.end?.toString() || "");
  const searchIdBase = useId().replace(/:/g, "");
  const compactPanelRef = useRef<HTMLDivElement | null>(null);
  const compactCloseTimerRef = useRef<number | null>(null);

  const clearCompactCloseTimer = () => {
    if (compactCloseTimerRef.current !== null) {
      window.clearTimeout(compactCloseTimerRef.current);
      compactCloseTimerRef.current = null;
    }
  };

  const openCompactFilters = (options?: { pin?: boolean }) => {
    clearCompactCloseTimer();
    if (options?.pin) {
      setCompactFiltersPinned(true);
    }
    setShowFilters(true);
  };

  const closeCompactFilters = () => {
    clearCompactCloseTimer();
    setCompactFiltersPinned(false);
    setShowFilters(false);
  };

  const scheduleCompactFiltersClose = () => {
    clearCompactCloseTimer();
    if (compactFiltersPinned) return;

    compactCloseTimerRef.current = window.setTimeout(() => {
      setShowFilters(false);
      compactCloseTimerRef.current = null;
    }, COMPACT_REFINE_CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!isCompact && hasRefinementFilters) {
      setShowFilters(true);
    }
  }, [hasRefinementFilters, isCompact]);

  useEffect(() => {
    setStartYearInput(filters.dateRange?.start?.toString() || "");
    setEndYearInput(filters.dateRange?.end?.toString() || "");
  }, [filters.dateRange?.end, filters.dateRange?.start]);

  useEffect(() => {
    if (!isCompact || !showFilters) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!compactPanelRef.current?.contains(event.target)) {
        closeCompactFilters();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isCompact, showFilters]);

  useEffect(() => () => clearCompactCloseTimer(), []);

  const hasActiveFilters = Boolean(
    query.trim()
      || filters.format
      || filters.person
      || filters.place
      || filters.year
      || filters.dateRange?.start
      || filters.dateRange?.end
      || filters.verified !== undefined && filters.verified !== null,
  );

  const searchStatus = useMemo(() => {
    if (loading && hasQuery) return `Searching for "${query.trim()}"...`;
    if (loading && hasActiveFilters) return "Refreshing filtered archive...";
    if (loading) return "Refreshing archive browse...";
    if (hasQuery) {
      return `${total} result${total === 1 ? "" : "s"} for "${query.trim()}"`;
    }
    if (hasActiveFilters) {
      return `${total} matching archive item${total === 1 ? "" : "s"}`;
    }
    return `${total} published archive item${total === 1 ? "" : "s"}`;
  }, [hasActiveFilters, hasQuery, loading, query, total]);

  const availableSortOptions = useMemo(
    () => (hasQuery ? SORT_OPTIONS : SORT_OPTIONS.filter((option) => option.sort !== "relevance")),
    [hasQuery],
  );

  const updateFilter = (partial: Partial<SearchFilters>) => {
    onFiltersChange({
      ...filters,
      ...partial,
    });
  };

  const activePills = useMemo(() => {
    const pills: Array<{ key: string; label: string; onClear: () => void }> = [];

    if (filters.format) {
      const label = facets.formats.find((facet) => facet.value === filters.format)?.label || filters.format;
      pills.push({
        key: `format-${filters.format}`,
        label,
        onClear: () => updateFilter({ format: null }),
      });
    }
    if (filters.person) {
      pills.push({
        key: `person-${filters.person}`,
        label: filters.person,
        onClear: () => updateFilter({ person: null }),
      });
    }
    if (filters.place) {
      pills.push({
        key: `place-${filters.place}`,
        label: filters.place,
        onClear: () => updateFilter({ place: null }),
      });
    }
    if (filters.year) {
      pills.push({
        key: `year-${filters.year}`,
        label: String(filters.year),
        onClear: () => updateFilter({ year: null }),
      });
    }
    if (filters.dateRange?.start || filters.dateRange?.end) {
      pills.push({
        key: "dateRange",
        label: `${filters.dateRange.start || "Any"}-${filters.dateRange.end || "Any"}`,
        onClear: () => {
          setStartYearInput("");
          setEndYearInput("");
          updateFilter({ dateRange: undefined });
        },
      });
    }
    if (filters.verified !== undefined && filters.verified !== null) {
      pills.push({
        key: "verified",
        label: filters.verified ? "Verified" : "Unverified",
        onClear: () => updateFilter({ verified: null }),
      });
    }

    return pills;
  }, [facets.formats, filters, updateFilter]);

  const activeFilterCount = activePills.length;

  const applyDateRange = () => {
    const start = startYearInput ? Number(startYearInput) : undefined;
    const end = endYearInput ? Number(endYearInput) : undefined;

    onFiltersChange({
      ...filters,
      year: null,
      dateRange: start || end ? { start, end } : undefined,
    });
  };

  const clearAll = () => {
    setStartYearInput("");
    setEndYearInput("");
    onQueryChange("");
    onFiltersChange({});
    if (isCompact) {
      closeCompactFilters();
    }
  };

  const correspondentFilterId = `${searchIdBase}-person`;
  const placeFilterId = `${searchIdBase}-place`;
  const startYearFilterId = `${searchIdBase}-year-start`;

  const formatFacetRow = facets.formats.length > 0 ? (
    <FacetRow
      label="Browse by format"
      items={facets.formats.map((facet) => ({
        key: facet.value,
        label: facet.label,
        count: facet.count,
        active: filters.format === facet.value,
        onClick: () => updateFilter({ format: filters.format === facet.value ? null : facet.value }),
      }))}
    />
  ) : null;

  const renderActivePills = (compactLayout = false) => {
    if (activePills.length === 0) return null;

    return (
      <div
        className={`search-active-pills${compactLayout ? " search-active-pills-compact" : ""}`}
        aria-label="Active archive filters"
      >
        {activePills.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className="search-active-pill"
            onClick={pill.onClear}
          >
            <span>{pill.label}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
    );
  };

  const refinementFields = (
    <div className={`filters${isCompact ? " filters-compact" : ""}`}>
      <div className="filter-group">
        <label className="filter-label" htmlFor={correspondentFilterId}>Correspondent</label>
        <input
          id={correspondentFilterId}
          type="text"
          className="filter-input"
          placeholder="Sender or recipient"
          value={filters.person || ""}
          onChange={(event) => updateFilter({ person: event.target.value || null })}
        />
        {facets.correspondents.length > 0 && (
          <div className="filter-suggestion-row">
            {facets.correspondents.slice(0, 6).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`search-facet-chip ${filters.person === facet.value ? "active" : ""}`}
                onClick={() => updateFilter({ person: filters.person === facet.value ? null : facet.value })}
              >
                <span>{facet.value}</span>
                <span className="search-facet-count">{facet.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor={placeFilterId}>Place</label>
        <input
          id={placeFilterId}
          type="text"
          className="filter-input"
          placeholder="Town, city, or country"
          value={filters.place || ""}
          onChange={(event) => updateFilter({ place: event.target.value || null })}
        />
        {facets.places.length > 0 && (
          <div className="filter-suggestion-row">
            {facets.places.slice(0, 6).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`search-facet-chip ${filters.place === facet.value ? "active" : ""}`}
                onClick={() => updateFilter({ place: filters.place === facet.value ? null : facet.value })}
              >
                <span>{facet.value}</span>
                <span className="search-facet-count">{facet.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor={startYearFilterId}>Year Range</label>
        {facets.years.length > 0 && (
          <div className="filter-suggestion-row">
            {facets.years.slice(0, 6).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`search-facet-chip ${filters.year === facet.value ? "active" : ""}`}
                onClick={() => updateFilter({
                  year: filters.year === facet.value ? null : facet.value,
                  dateRange: undefined,
                })}
              >
                <span>{facet.value}</span>
                <span className="search-facet-count">{facet.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="date-range">
          <input
            id={startYearFilterId}
            type="number"
            className="filter-input"
            placeholder="From"
            value={startYearInput}
            onChange={(event) => setStartYearInput(event.target.value)}
            onBlur={applyDateRange}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyDateRange();
            }}
          />
          <span className="date-separator">to</span>
          <input
            type="number"
            className="filter-input"
            placeholder="To"
            value={endYearInput}
            onChange={(event) => setEndYearInput(event.target.value)}
            onBlur={applyDateRange}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyDateRange();
            }}
          />
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Verification</span>
        <div className="radio-group">
          {[
            { label: "All Items", value: null },
            { label: "Verified Only", value: true },
            { label: "Unverified", value: false },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              className={`radio-label ${filters.verified === option.value ? "active" : ""}`}
              onClick={() => updateFilter({ verified: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (isCompact) {
    return (
      <div className={`search search-compact${embedded ? " search-embedded" : ""}`} ref={compactPanelRef}>
        <div className="search-input-wrapper search-input-wrapper-compact">
          <input
            type="search"
            className="search-input"
            placeholder='Search names, places, dates, or phrases...'
            aria-label="Search the archive"
            enterKeyHint="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />

          <div className="search-compact-filter-wrap">
            <button
              type="button"
              className={`filter-toggle search-compact-filter-toggle${showFilters ? " active" : ""}`}
              aria-label="Open archive refine controls"
              aria-expanded={showFilters}
              onMouseEnter={() => openCompactFilters()}
              onMouseLeave={scheduleCompactFiltersClose}
              onFocus={() => openCompactFilters()}
              onBlur={() => {
                if (!compactFiltersPinned) {
                  scheduleCompactFiltersClose();
                }
              }}
              onClick={() => {
                if (!showFilters) {
                  openCompactFilters({ pin: true });
                  return;
                }

                if (compactFiltersPinned) {
                  closeCompactFilters();
                  return;
                }

                setCompactFiltersPinned(true);
                clearCompactCloseTimer();
              }}
            >
              Refine{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>

            {showFilters && (
              <div
                className="search-compact-flyout"
                onMouseEnter={() => openCompactFilters()}
                onMouseLeave={scheduleCompactFiltersClose}
              >
                <div className="search-compact-flyout-header">
                  <div className="search-compact-flyout-copy">
                    <span className="search-facet-label">Refine</span>
                    <p className="search-compact-flyout-status">{searchStatus}</p>
                  </div>
                  {hasActiveFilters && (
                    <button type="button" className="clear-filters" onClick={clearAll}>
                      Clear All
                    </button>
                  )}
                </div>
                {formatFacetRow}
                <div className="search-toolbar search-toolbar-compact">
                  <div className="search-sort-group" role="group" aria-label="Sort archive results">
                    {availableSortOptions.map((option) => (
                      <button
                        key={`${option.sort}-${option.sortOrder}`}
                        type="button"
                        className={`search-sort-chip ${sameSort(query, filters, option) ? "active" : ""}`}
                        onClick={() => updateFilter({ sort: option.sort, sortOrder: option.sortOrder })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {renderActivePills(true)}
                {refinementFields}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`search${embedded ? " search-embedded" : ""}`}>
      <div className="search-heading">
        <div className="search-heading-copy">
          <p className="search-kicker">Archive-Wide Search</p>
          <h2 className="search-title">Search the Archive</h2>
          <p className="search-description">
            Search names, phrases, places, dates, transcripts, telegram text, and photo descriptions.
          </p>
        </div>
        <div className="search-status-block">
          <span className="search-status-label">Now Showing</span>
          <p className="search-status">{searchStatus}</p>
        </div>
      </div>

      <div className="search-input-wrapper" ref={dockTriggerRef}>
        <input
          type="search"
          className="search-input"
          placeholder='Try "Molly", "Kansas", "George", or "marry"...'
          aria-label="Search the archive"
          enterKeyHint="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      {formatFacetRow}

      <div className="search-toolbar">
        <div className="search-sort-group" role="group" aria-label="Sort archive results">
          {availableSortOptions.map((option) => (
            <button
              key={`${option.sort}-${option.sortOrder}`}
              type="button"
              className={`search-sort-chip ${sameSort(query, filters, option) ? "active" : ""}`}
              onClick={() => updateFilter({ sort: option.sort, sortOrder: option.sortOrder })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="search-toolbar-actions">
          <button
            type="button"
            className="filter-toggle"
            aria-label="Toggle advanced search filters"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((current) => !current)}
          >
            {showFilters ? "Hide Refinements" : "Refine Results"}
          </button>
          {hasActiveFilters && (
            <button type="button" className="clear-filters" onClick={clearAll}>
              Clear All
            </button>
          )}
        </div>
      </div>

      {renderActivePills()}

      {showFilters && refinementFields}
    </div>
  );
}

interface FacetItem {
  key: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function FacetRow({
  label,
  items,
}: {
  label: string;
  items: FacetItem[];
}) {
  return (
    <div className="search-facet-row">
      <span className="search-facet-label">{label}</span>
      <div className="search-facet-chips">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`search-facet-chip ${item.active ? "active" : ""}`}
            onClick={item.onClick}
          >
            <span>{item.label}</span>
            <span className="search-facet-count">{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
