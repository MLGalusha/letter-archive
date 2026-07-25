import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from "react";
import type { ArchiveSearchFacets, LetterImageType } from "../../types/Letter";
import useIsMobile from "../../hooks/useIsMobile";
import type { SearchFilters } from "../../utils/archiveSearch";
import "./SearchBar.css";
import {
  ARCHIVE_FORMAT_LABELS,
  ARCHIVE_FORMAT_ORDER,
  COMBINED_SORT_OPTIONS,
  formatFacetLabel,
  getBestSuggestion,
} from "./searchBarUtils";
import type { FilterChoiceOption } from "./searchBarUtils";
import FilterChoiceField from "./FilterChoiceField";
import FacetRow from "./FacetRow";
import SuggestionHint from "./SuggestionHint";
import { useRememberedSearchFacets } from "./rememberedSearchFacets";

interface SearchBarProps {
  query: string;
  filters: SearchFilters;
  facets: ArchiveSearchFacets;
  total: number;
  loading: boolean;
  embedded?: boolean;
  variant?: "full" | "compact";
  hideCollectionFilter?: boolean;
  compactPlaceholder?: string;
  placeholder?: string;
  searchKicker?: string;
  searchTitle?: string;
  refineOpen?: boolean;
  sortOpen?: boolean;
  /**
   * Page-specific default sort used when the user hasn't explicitly picked
   * one. "Best Match" is the default default — pages like collection detail
   * pass "letterDate" to preserve chronological reading order.
   */
  defaultSort?: NonNullable<SearchFilters["sort"]>;
  dockTriggerRef?: Ref<HTMLDivElement>;
  onRefineOpenChange?: (open: boolean) => void;
  onSortOpenChange?: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onFiltersChange: (filters: SearchFilters) => void;
}

export type { SearchFilters } from "../../utils/archiveSearch";

export default function SearchBar({
  query,
  filters,
  facets,
  total,
  loading,
  embedded = false,
  variant = "full",
  hideCollectionFilter = false,
  compactPlaceholder,
  placeholder: placeholderProp,
  searchKicker,
  searchTitle,
  refineOpen,
  sortOpen: sortOpenProp,
  defaultSort = "relevance",
  dockTriggerRef,
  onRefineOpenChange,
  onSortOpenChange,
  onQueryChange,
  onFiltersChange,
}: SearchBarProps) {
  const isMobile = useIsMobile(700);
  const isCompact = variant === "compact";
  const hasQuery = Boolean(query.trim());
  const selectedFormats = filters.format || null;
  const hasAdvancedRefinementFilters = Boolean(
    (!hideCollectionFilter && filters.collection)
      || filters.sender
      || filters.recipient
      || filters.place
      || filters.topic?.length
      || filters.tone?.length
      || filters.relationship?.length
      || filters.year
      || filters.dateRange?.start
      || filters.dateRange?.end
      || filters.verified !== undefined && filters.verified !== null,
  );
  const [internalShowFilters, setInternalShowFilters] = useState(
    isCompact ? false : hasAdvancedRefinementFilters,
  );
  const [openChoiceField, setOpenChoiceField] = useState<string | null>(null);
  const searchIdBase = useId().replace(/:/g, "");
  const searchRootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const showFilters = refineOpen ?? internalShowFilters;
  if (!showFilters && openChoiceField !== null) {
    setOpenChoiceField(null);
  }

  const focusSearchInputFromWrapper = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Ignore clicks on the input itself (already handled) or on any interactive control
    // inside the wrapper (filter button, sort trigger, flyout contents). The sort menu
    // uses role="listbox"/role="option", so those must be excluded too — otherwise
    // picking a sort option would bubble up and refocus the input, popping the mobile
    // keyboard mid-interaction.
    if (
      target.closest(
        "button, input, select, textarea, [role='button'], [role='menu'], [role='menuitem'], [role='listbox'], [role='option']",
      )
    ) {
      return;
    }
    searchInputRef.current?.focus();
  }, []);

  const setRefineOpen = useCallback((next: boolean) => {
    if (refineOpen === undefined) {
      setInternalShowFilters(next);
    }
    if (!next) {
      setOpenChoiceField(null);
    }
    onRefineOpenChange?.(next);
  }, [onRefineOpenChange, refineOpen]);

  const toggleRefine = () => {
    const next = !showFilters;
    setRefineOpen(next);
    if (next) setSortDropdownOpen(false);
  };

  useEffect(() => {
    if (!showFilters) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!searchRootRef.current?.contains(event.target)) {
        setRefineOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [setRefineOpen, showFilters]);

  const hasActiveFilters = Boolean(
    query.trim()
      || selectedFormats?.length
      || (!hideCollectionFilter && filters.collection)
      || filters.sender
      || filters.recipient
      || filters.place
      || filters.topic?.length
      || filters.tone?.length
      || filters.relationship?.length
      || filters.year
      || filters.dateRange?.start
      || filters.dateRange?.end
      || (filters.hasTranscript !== undefined && filters.hasTranscript !== null)
      || (filters.verified !== undefined && filters.verified !== null),
  );

  const searchStatus = useMemo(() => {
    if (isMobile) {
      if (loading) return "Updating...";
      return `${total} archive item${total === 1 ? "" : "s"}`;
    }
    if (loading && hasQuery) return `Searching for "${query.trim()}"...`;
    if (loading && hasActiveFilters) return "Refreshing refined archive...";
    if (loading) return "Refreshing archive browse...";
    if (hasQuery) {
      return `${total} result${total === 1 ? "" : "s"} for "${query.trim()}"`;
    }
    if (hasActiveFilters) {
      return `${total} matching archive item${total === 1 ? "" : "s"}`;
    }
    return `${total} archive item${total === 1 ? "" : "s"}`;
  }, [hasActiveFilters, hasQuery, isMobile, loading, query, total]);

  const updateFilter = useCallback((partial: Partial<SearchFilters>) => {
    onFiltersChange({
      ...filters,
      ...partial,
    });
  }, [filters, onFiltersChange]);

  // Count active filters for the badge on the refine button.
  // In compact mode, format chips are inside the flyout so they count.
  // In full mode, format chips are in the toolbar so they don't count.
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedFormats?.length) count += selectedFormats.length;
    if (filters.collection && !hideCollectionFilter) count++;
    if (filters.sender) count++;
    if (filters.recipient) count++;
    if (filters.place) count++;
    if (filters.topic?.length) count += filters.topic.length;
    if (filters.tone?.length) count += filters.tone.length;
    if (filters.relationship?.length) count += filters.relationship.length;
    if (filters.year) count++;
    if (filters.dateRange?.start || filters.dateRange?.end) count++;
    if (filters.hasTranscript !== undefined && filters.hasTranscript !== null) count++;
    if (filters.verified !== undefined && filters.verified !== null) count++;
    return count;
  }, [filters, selectedFormats, hideCollectionFilter]);
  // Resolve the effective sort: user's explicit choice wins, otherwise the
  // page default. This never depends on query presence — the sort the user
  // sees should not silently flip when they start or stop typing.
  const resolvedSort = {
    sort: filters.sort || defaultSort,
    sortOrder: filters.sortOrder || "desc",
  };

  // Sort dropdown
  const [internalSortOpen, setInternalSortOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownOpen = sortOpenProp ?? internalSortOpen;
  if (sortOpenProp === false && internalSortOpen) {
    setInternalSortOpen(false);
  }
  const setSortDropdownOpen = useCallback((next: boolean) => {
    setInternalSortOpen(next);
    onSortOpenChange?.(next);
  }, [onSortOpenChange, setInternalSortOpen]);
  const visibleSortOptions = useMemo(() => {
    let options = COMBINED_SORT_OPTIONS;
    if (hideCollectionFilter) options = options.filter((o) => o.sort !== "collection");
    return options;
  }, [hideCollectionFilter]);
  const currentSortOption = visibleSortOptions.find((o) => o.sort === resolvedSort.sort);
  const showSortArrow = currentSortOption?.canToggle;
  const sortArrow = resolvedSort.sortOrder === "asc" ? "\u2191" : "\u2193";

  const handleSortClick = () => {
    const next = !sortDropdownOpen;
    setSortDropdownOpen(next);
    if (next) setRefineOpen(false);
  };

  useEffect(() => {
    if (!sortDropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [setSortDropdownOpen, sortDropdownOpen]);

  const rememberedFacets = useRememberedSearchFacets(facets);

  const toneChoiceOptions = useMemo<FilterChoiceOption[]>(() => {
    return Array.from(rememberedFacets.tones)
      .map((value) => ({
        value,
        label: formatFacetLabel(value),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rememberedFacets.tones]);
  const relationshipChoiceOptions = useMemo<FilterChoiceOption[]>(() => {
    return Array.from(rememberedFacets.relationships)
      .map((value) => ({
        value,
        label: formatFacetLabel(value),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rememberedFacets.relationships]);
  const verificationChoiceOptions = useMemo<FilterChoiceOption[]>(
    () => [
      { value: "all", label: "All" },
      { value: "true", label: "Verified only" },
      { value: "false", label: "Unverified" },
    ],
    [],
  );
  const yearChoiceOptions = useMemo<FilterChoiceOption[]>(() => {
    const dataYears = [...rememberedFacets.years];
    if (dataYears.length === 0) return [];
    const dataMin = Math.min(...dataYears);
    const dataMax = Math.max(...dataYears);
    const currentYear = new Date().getFullYear();
    const min = Math.max(1700, dataMin - 50);
    const max = Math.min(currentYear, dataMax + 50);
    const opts: FilterChoiceOption[] = [];
    for (let y = min; y <= max; y++) {
      opts.push({ value: String(y), label: String(y) });
    }
    return opts;
  }, [rememberedFacets.years]);

  const collectionSuggestion = useMemo(
    () => hideCollectionFilter ? null : getBestSuggestion(
      filters.collection,
      facets.collections.map((facet) => ({
        value: facet.label,
        display: facet.label === facet.value ? facet.label : `${facet.label} (${facet.value})`,
        count: facet.count,
        aliases: [facet.value],
      })),
    ),
    [facets.collections, filters.collection, hideCollectionFilter],
  );
  const transcriptChoiceOptions = useMemo<FilterChoiceOption[]>(
    () => [
      { value: "all", label: "All" },
      { value: "true", label: "Transcript" },
      { value: "false", label: "No transcript" },
    ],
    [],
  );
  const senderSuggestion = useMemo(
    () => getBestSuggestion(
      filters.sender,
      facets.correspondents.map((facet) => ({
        value: facet.value,
        display: facet.value,
        count: facet.count,
      })),
    ),
    [facets.correspondents, filters.sender],
  );
  const recipientSuggestion = useMemo(
    () => getBestSuggestion(
      filters.recipient,
      facets.correspondents.map((facet) => ({
        value: facet.value,
        display: facet.value,
        count: facet.count,
      })),
    ),
    [facets.correspondents, filters.recipient],
  );
  const placeSuggestion = useMemo(
    () => getBestSuggestion(
      filters.place,
      facets.places.map((facet) => ({
        value: facet.value,
        display: facet.value,
        count: facet.count,
      })),
    ),
    [facets.places, filters.place],
  );
  const topicChoiceOptions = useMemo(() => {
    return Array.from(rememberedFacets.topics)
      .map((category) => ({
        value: category,
        label: formatFacetLabel(category),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rememberedFacets.topics]);

  const toggleFormatFilter = useCallback((format: LetterImageType) => {
    const nextFormats = selectedFormats?.includes(format)
      ? selectedFormats.filter((value) => value !== format)
      : [...(selectedFormats || []), format];

    updateFilter({
      format: nextFormats.length > 0 ? nextFormats : null,
    });
  }, [selectedFormats, updateFilter]);

  const clearAll = useCallback(() => {
    onQueryChange("");
    onFiltersChange({});
    if (isCompact) {
      setRefineOpen(false);
    }
  }, [isCompact, onFiltersChange, onQueryChange, setRefineOpen]);

  const collectionFilterId = `${searchIdBase}-collection`;
  const senderFilterId = `${searchIdBase}-sender`;
  const recipientFilterId = `${searchIdBase}-recipient`;
  const placeFilterId = `${searchIdBase}-place`;
  const topicFilterId = `${searchIdBase}-topic`;

  const formatFacetItems = useMemo(() => {
    const formatCounts = new Map(
      facets.formats.map((facet) => [facet.value, facet.count] as const),
    );

    return ARCHIVE_FORMAT_ORDER.map((format) => ({
      key: format,
      label: ARCHIVE_FORMAT_LABELS[format],
      count: formatCounts.get(format) || 0,
      active: selectedFormats?.includes(format) || false,
      onClick: () => toggleFormatFilter(format),
    }));
  }, [facets.formats, selectedFormats, toggleFormatFilter]);

  const formatFacetRow = formatFacetItems.length > 0 ? (
    <FacetRow
      label="Browse by format"
      items={formatFacetItems}
    />
  ) : null;
  const sortDropdown = (
    <div
      className="search-sort-dropdown"
      ref={sortDropdownRef}
    >
      <button
        type="button"
        className="search-sort-trigger"
        onClick={handleSortClick}
        aria-expanded={sortDropdownOpen}
        aria-label="Sort archive results"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {showSortArrow && <span className="search-sort-arrow">{sortArrow}</span>}
      </button>
      <ul
          className={`search-sort-menu${sortDropdownOpen ? "" : " search-sort-menu--hidden"}`}
          role="listbox"
        >
          {visibleSortOptions.map((opt) => {
            const isActive = opt.sort === resolvedSort.sort;
            return (
              <li
                key={opt.sort}
                role="option"
                aria-selected={isActive}
                className={`search-sort-option${isActive ? " search-sort-option--active" : ""}`}
                onClick={() => {
                  if (isActive && opt.canToggle) {
                    updateFilter({ sortOrder: resolvedSort.sortOrder === "asc" ? "desc" : "asc" });
                  } else {
                    updateFilter({ sort: opt.sort, sortOrder: opt.defaultOrder });
                  }
                }}
              >
                <span>{opt.label}</span>
                {isActive && opt.canToggle && (
                  <span className="search-sort-arrow">{sortArrow}</span>
                )}
              </li>
            );
          })}
        </ul>
    </div>
  );

  const refinementFields = (
    <div className={`filters${isCompact ? " filters-compact" : ""}`}>

      <div className="filter-section">
        <span className="filter-section-label">People &amp; Location</span>
        <div className="filter-section-row">
          <div className="filter-group">
            <label className="filter-label" htmlFor={senderFilterId}>Sender</label>
            <input
              id={senderFilterId}
              type="text"
              className="filter-input"
              placeholder="Sender name"
              value={filters.sender || ""}
              onChange={(event) => updateFilter({ sender: event.target.value || null })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !senderSuggestion) return;
                event.preventDefault();
                updateFilter({ sender: senderSuggestion.applyValue });
              }}
            />
            <SuggestionHint suggestion={senderSuggestion} />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor={recipientFilterId}>Recipient</label>
            <input
              id={recipientFilterId}
              type="text"
              className="filter-input"
              placeholder="Recipient name"
              value={filters.recipient || ""}
              onChange={(event) => updateFilter({ recipient: event.target.value || null })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !recipientSuggestion) return;
                event.preventDefault();
                updateFilter({ recipient: recipientSuggestion.applyValue });
              }}
            />
            <SuggestionHint suggestion={recipientSuggestion} />
          </div>
          {!hideCollectionFilter && (
            <div className="filter-group">
              <label className="filter-label" htmlFor={collectionFilterId}>Collection</label>
              <input
                id={collectionFilterId}
                type="text"
                className="filter-input"
                placeholder="Collection"
                value={filters.collection || ""}
                onChange={(event) => updateFilter({ collection: event.target.value || null })}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !collectionSuggestion) return;
                  event.preventDefault();
                  updateFilter({ collection: collectionSuggestion.applyValue });
                }}
              />
              <SuggestionHint suggestion={collectionSuggestion} />
            </div>
          )}
          <div className="filter-group">
            <label className="filter-label" htmlFor={placeFilterId}>Place</label>
            <input
              id={placeFilterId}
              type="text"
              className="filter-input"
              placeholder="Place"
              value={filters.place || ""}
              onChange={(event) => updateFilter({ place: event.target.value || null })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !placeSuggestion) return;
                event.preventDefault();
                updateFilter({ place: placeSuggestion.applyValue });
              }}
            />
            <SuggestionHint suggestion={placeSuggestion} />
          </div>
          <div className="filter-group filter-group-year-range">
            <label className="filter-label" htmlFor={`${searchIdBase}-year-from`}>Year Range</label>
            <div className="year-range-pair">
              <FilterChoiceField
                id={`${searchIdBase}-year-from`}
                label="From year"
                value={filters.dateRange?.start ? String(filters.dateRange.start) : ""}
                placeholder="From"
                options={yearChoiceOptions}
                allowClear
                clearLabel="Any"
                compact
                closeOnSelect
                open={openChoiceField === `${searchIdBase}-year-from`}
                onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-year-from` : null)}
                onChange={(value) => {
                  const start = value ? Number(value) : undefined;
                  updateFilter({ year: null, dateRange: start || filters.dateRange?.end ? { start, end: filters.dateRange?.end } : undefined });
                }}
              />
              <span className="year-range-sep">&ndash;</span>
              <FilterChoiceField
                id={`${searchIdBase}-year-to`}
                label="To year"
                value={filters.dateRange?.end ? String(filters.dateRange.end) : ""}
                placeholder="To"
                options={yearChoiceOptions}
                allowClear
                clearLabel="Any"
                compact
                closeOnSelect
                open={openChoiceField === `${searchIdBase}-year-to`}
                onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-year-to` : null)}
                onChange={(value) => {
                  const end = value ? Number(value) : undefined;
                  updateFilter({ year: null, dateRange: filters.dateRange?.start || end ? { start: filters.dateRange?.start, end } : undefined });
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="filter-section">
        <span className="filter-section-label">Content &amp; Status</span>
        <div className="filter-section-row">
          <div className="filter-group">
            <label className="filter-label" htmlFor={topicFilterId}>Topic</label>
            <FilterChoiceField
              id={topicFilterId}
              label="Topic"
              value={filters.topic?.join(",") || ""}
              placeholder="All"
              options={topicChoiceOptions}
              allowClear
              clearLabel="All"
              searchable={topicChoiceOptions.length > 6}
              multiple
              maxSelections={2}
              compact
              open={openChoiceField === topicFilterId}
              onOpenChange={(open) => setOpenChoiceField(open ? topicFilterId : null)}
              onChange={(value) => updateFilter({ topic: value ? value.split(",") : null })}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor={`${searchIdBase}-tone`}>Tone</label>
            <FilterChoiceField
              id={`${searchIdBase}-tone`}
              label="Tone"
              value={filters.tone?.join(",") || ""}
              placeholder="All"
              options={toneChoiceOptions}
              allowClear
              clearLabel="All"
              searchable={toneChoiceOptions.length > 6}
              multiple
              compact
              open={openChoiceField === `${searchIdBase}-tone`}
              onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-tone` : null)}
              onChange={(value) => updateFilter({ tone: value ? value.split(",") : null })}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor={`${searchIdBase}-relationship`}>Relationship</label>
            <FilterChoiceField
              id={`${searchIdBase}-relationship`}
              label="Relationship"
              value={filters.relationship?.join(",") || ""}
              placeholder="All"
              options={relationshipChoiceOptions}
              allowClear
              clearLabel="All"
              searchable
              multiple
              compact
              open={openChoiceField === `${searchIdBase}-relationship`}
              onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-relationship` : null)}
              onChange={(value) => updateFilter({ relationship: value ? value.split(",") : null })}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor={`${searchIdBase}-transcript`}>Transcript</label>
            <FilterChoiceField
              id={`${searchIdBase}-transcript`}
              label="Transcript"
              value={filters.hasTranscript === null || filters.hasTranscript === undefined ? "all" : filters.hasTranscript ? "true" : "false"}
              placeholder="All"
              options={transcriptChoiceOptions}
              compact
              open={openChoiceField === `${searchIdBase}-transcript`}
              onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-transcript` : null)}
              onChange={(value) => updateFilter({
                hasTranscript: value === "all" ? null : value === "true",
              })}
            />
          </div>
          <div className="filter-group">
            <label className="filter-label" htmlFor={`${searchIdBase}-verified`}>Verification</label>
            <FilterChoiceField
              id={`${searchIdBase}-verified`}
              label="Verification"
              value={filters.verified === null || filters.verified === undefined ? "all" : filters.verified ? "true" : "false"}
              placeholder="All"
              options={verificationChoiceOptions}
              compact
              open={openChoiceField === `${searchIdBase}-verified`}
              onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-verified` : null)}
              onChange={(value) => updateFilter({
                verified: value === "all" ? null : value === "true",
              })}
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (isCompact) {
    return (
      <div className={`search search-compact${embedded ? " search-embedded" : ""}`} ref={searchRootRef}>
        <div className="search-input-wrapper search-input-wrapper-compact" onClick={focusSearchInputFromWrapper}>
          <input
            ref={searchInputRef}
            type="search"
            className="search-input"
            placeholder={compactPlaceholder || "Search archive..."}
            aria-label={compactPlaceholder || "Search the archive"}
            enterKeyHint="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />

          <div className="search-compact-filter-wrap">
            <button
              type="button"
              className={`filter-toggle search-refine-toggle search-compact-filter-toggle${showFilters ? " active" : ""}`}
              aria-label={`${showFilters ? "Close" : "Open"} archive refine controls${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
              aria-expanded={showFilters}
              onClick={toggleRefine}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1.5 2.5h11L8 7.5v4l-2 1.5V7.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
            </button>
            {sortDropdown}

            {showFilters && (
              <div className="search-compact-flyout search-refine-flyout">
                {formatFacetRow}
                {refinementFields}
                <div className="search-flyout-footer">
                  <div className="search-flyout-footer-status">
                    <span className="search-facet-label">Refine</span>
                    <p className="search-compact-flyout-status">{searchStatus}</p>
                  </div>
                  <button
                    type="button"
                    className="clear-filters"
                    onClick={clearAll}
                    disabled={!hasActiveFilters}
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`search${embedded ? " search-embedded" : ""}`} ref={searchRootRef}>
      <div className="search-heading">
        <div className="search-heading-copy">
          <p className="search-kicker">{searchKicker || "Archive-Wide Search"}</p>
          <h2 className="search-title">{searchTitle || "Search the Archive"}</h2>
          <p className="search-description">
            Search names, phrases, places, dates, transcripts, telegram text, and photo descriptions.
          </p>
        </div>
        <div className="search-status-block">
          <p className="search-status" aria-live="polite" role="status">{searchStatus}</p>
        </div>
      </div>

      <div className="search-input-wrapper search-input-wrapper-compact" ref={dockTriggerRef} onClick={focusSearchInputFromWrapper}>
        <input
          ref={searchInputRef}
          type="search"
          className="search-input"
          placeholder={placeholderProp || "Search names, places, dates..."}
          aria-label="Search the archive"
          enterKeyHint="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />

        <div className="search-compact-filter-wrap">
          <button
            type="button"
            className={`filter-toggle search-refine-toggle search-full-filter-toggle${showFilters ? " active" : ""}`}
            aria-label={`${showFilters ? "Close" : "Open"} archive refine controls${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ""}`}
            aria-expanded={showFilters}
            onClick={toggleRefine}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1.5 2.5h11L8 7.5v4l-2 1.5V7.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
          </button>
          {sortDropdown}

          {showFilters && (
            <div className="search-full-flyout search-refine-flyout">
              {formatFacetRow}
              {refinementFields}
          <div className="search-flyout-footer">
            <div className="search-flyout-footer-status">
              <span className="search-facet-label">Refine</span>
              <p className="search-compact-flyout-status">{searchStatus}</p>
            </div>
            <button
              type="button"
              className="clear-filters"
              onClick={clearAll}
              disabled={!hasActiveFilters}
            >
              Clear All
            </button>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
