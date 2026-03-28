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
  hideCollectionFilter?: boolean;
  compactPlaceholder?: string;
  searchKicker?: string;
  searchTitle?: string;
  refineOpen?: boolean;
  refinePinned?: boolean;
  sortOpen?: boolean;
  dockTriggerRef?: Ref<HTMLDivElement>;
  onRefineOpenChange?: (open: boolean) => void;
  onSortOpenChange?: (open: boolean) => void;
  onPinnedChange?: (pinned: boolean) => void;
  onQueryChange: (query: string) => void;
  onFiltersChange: (filters: SearchFilters) => void;
}

export interface SearchFilters {
  format?: LetterImageType[] | null;
  collection?: string | null;
  person?: string | null;
  personRole?: "any" | "sender" | "recipient" | null;
  sender?: string | null;
  recipient?: string | null;
  place?: string | null;
  topic?: string | null;
  tone?: string | null;
  relationship?: string | null;
  year?: number | null;
  dateRange?: { start?: number; end?: number };
  verified?: boolean | null;
  sort?: "relevance" | "createdAt" | "letterDate" | "sender" | "recipient" | "collection";
  sortOrder?: "asc" | "desc";
}

type SortFieldOption = {
  value: NonNullable<SearchFilters["sort"]>;
  label: string;
  defaultOrder: NonNullable<SearchFilters["sortOrder"]>;
};

type FilterSuggestion = {
  display: string;
  applyValue: string;
  count: number;
};

type FilterChoiceOption = {
  value: string;
  label: string;
  count?: number;
  aliases?: string[];
};

const SORT_FIELD_OPTIONS: SortFieldOption[] = [
  { label: "Best Match", value: "relevance", defaultOrder: "desc" },
  { label: "Publish Date", value: "createdAt", defaultOrder: "desc" },
  { label: "Letter Date", value: "letterDate", defaultOrder: "desc" },
  { label: "Sender", value: "sender", defaultOrder: "asc" },
  { label: "Recipient", value: "recipient", defaultOrder: "asc" },
  { label: "Collection", value: "collection", defaultOrder: "asc" },
];

type CombinedSortOption = {
  label: string;
  sort: NonNullable<SearchFilters["sort"]>;
  defaultOrder: NonNullable<SearchFilters["sortOrder"]>;
  requiresQuery?: boolean;
  canToggle?: boolean;
};

const COMBINED_SORT_OPTIONS: CombinedSortOption[] = [
  { label: "Best Match", sort: "relevance", defaultOrder: "desc", requiresQuery: true },
  { label: "Letter Date", sort: "letterDate", defaultOrder: "desc", canToggle: true },
  { label: "Date Added", sort: "createdAt", defaultOrder: "desc", canToggle: true },
  { label: "Sender", sort: "sender", defaultOrder: "asc", canToggle: true },
  { label: "Recipient", sort: "recipient", defaultOrder: "asc", canToggle: true },
  { label: "Collection", sort: "collection", defaultOrder: "asc", canToggle: true },
];

const REFINE_CLOSE_DELAY_MS = 1000;
const ARCHIVE_FORMAT_ORDER: LetterImageType[] = [
  "letter",
  "photo",
  "telegram",
  "cover",
  "card",
  "ephemera",
  "article",
  "diary",
  "voice",
];
const ARCHIVE_FORMAT_LABELS: Record<LetterImageType, string> = {
  letter: "Letters",
  photo: "Photos",
  telegram: "Telegrams",
  cover: "Covers",
  card: "Cards",
  ephemera: "Ephemera",
  article: "Articles",
  diary: "Diary",
  voice: "Voice",
};

function getResolvedSort(query: string, filters: SearchFilters) {
  const hasQuery = Boolean(query.trim());
  return {
    sort: filters.sort || (hasQuery ? "relevance" : "createdAt"),
    sortOrder: filters.sortOrder || "desc",
  };
}

function getSortValue(option: SortFieldOption) {
  return option.value;
}

function getAvailableSortFields(hasQuery: boolean) {
  return hasQuery ? SORT_FIELD_OPTIONS : SORT_FIELD_OPTIONS.filter((option) => option.value !== "relevance");
}

function parseSortValue(value: string, options: SortFieldOption[]) {
  return options.find((option) => option.value === value) || null;
}

function getSortDirectionAriaLabel(
  sort: NonNullable<SearchFilters["sort"]>,
  sortOrder: NonNullable<SearchFilters["sortOrder"]>,
) {
  switch (sort) {
    case "letterDate":
      return sortOrder === "asc" ? "Oldest letter first" : "Newest letter first";
    case "createdAt":
      return sortOrder === "asc" ? "Oldest published first" : "Newest published first";
    case "sender":
    case "recipient":
    case "collection":
      return sortOrder === "asc" ? "A to Z" : "Z to A";
    case "relevance":
    default:
      return "Best match";
  }
}

function getSortDirectionDisplayLabel(
  sort: NonNullable<SearchFilters["sort"]>,
  sortOrder: NonNullable<SearchFilters["sortOrder"]>,
) {
  switch (sort) {
    case "sender":
    case "recipient":
    case "collection":
      return sortOrder === "asc" ? "A \u2192 Z" : "Z \u2192 A";
    case "letterDate":
    case "createdAt":
      return sortOrder === "asc" ? "\u2191" : "\u2193";
    case "relevance":
    default:
      return "\u2014";
  }
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatFacetLabel(value: string) {
  return value
    .split("/")
    .map((part) => toTitleCase(part.replace(/[-_]+/g, " ").trim()))
    .join(" / ");
}

function normalizeSuggestionText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function scoreSuggestionText(needle: string, alias: string) {
  const normalizedNeedle = normalizeSuggestionText(needle);
  const normalizedAlias = normalizeSuggestionText(alias);
  if (!normalizedNeedle || !normalizedAlias) return 0;
  if (normalizedAlias === normalizedNeedle) return 500;
  if (normalizedAlias.startsWith(normalizedNeedle)) return 420 - normalizedAlias.length;
  const wordMatch = normalizedAlias
    .split(" ")
    .some((part) => part.startsWith(normalizedNeedle));
  if (wordMatch) return 320;
  if (normalizedAlias.includes(normalizedNeedle)) return 220;
  return 0;
}

function getBestSuggestion(
  inputValue: string | null | undefined,
  candidates: Array<{ value: string; display: string; count: number; aliases?: string[] }>,
): FilterSuggestion | null {
  if (!inputValue?.trim()) return null;

  let bestMatch: (FilterSuggestion & { score: number }) | null = null;

  for (const candidate of candidates) {
    const aliases = [candidate.display, candidate.value, ...(candidate.aliases || [])];
    const score = Math.max(...aliases.map((alias) => scoreSuggestionText(inputValue, alias)));
    if (score <= 0) continue;

    if (
      !bestMatch
      || score > bestMatch.score
      || (score === bestMatch.score && candidate.count > bestMatch.count)
    ) {
      bestMatch = {
        display: candidate.display,
        applyValue: candidate.value,
        count: candidate.count,
        score,
      };
    }
  }

  if (!bestMatch) return null;
  return {
    display: bestMatch.display,
    applyValue: bestMatch.applyValue,
    count: bestMatch.count,
  };
}

function getCollectionLabel(value: string, facets: ArchiveSearchFacets) {
  return facets.collections.find((facet) => facet.value === value)?.label || value;
}

function filterChoiceOptions(options: FilterChoiceOption[], query: string) {
  const needle = normalizeSuggestionText(query);
  if (!needle) return options;

  return options.filter((option) => {
    const haystacks = [option.label, option.value, ...(option.aliases || [])];
    return haystacks.some((haystack) => normalizeSuggestionText(haystack).includes(needle));
  });
}

function normalizeYearInput(value: string) {
  return value.replace(/\D+/g, "").slice(0, 4);
}

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
  searchKicker,
  searchTitle,
  refineOpen,
  refinePinned,
  sortOpen: sortOpenProp,
  dockTriggerRef,
  onRefineOpenChange,
  onSortOpenChange,
  onPinnedChange,
  onQueryChange,
  onFiltersChange,
}: SearchBarProps) {
  const isCompact = variant === "compact";
  const hasQuery = Boolean(query.trim());
  const selectedFormats = filters.format || null;
  const hasAdvancedRefinementFilters = Boolean(
    (!hideCollectionFilter && filters.collection)
      || filters.person
      || filters.sender
      || filters.recipient
      || filters.place
      || filters.topic
      || filters.tone
      || filters.relationship
      || filters.year
      || filters.dateRange?.start
      || filters.dateRange?.end
      || filters.verified !== undefined && filters.verified !== null,
  );
  const [internalShowFilters, setInternalShowFilters] = useState(
    isCompact ? false : hasAdvancedRefinementFilters,
  );
  const [filtersPinned, setFiltersPinnedRaw] = useState(false);
  const setFiltersPinned = (pinned: boolean) => {
    setFiltersPinnedRaw(pinned);
    onPinnedChange?.(pinned);
  };
  const [openChoiceField, setOpenChoiceField] = useState<string | null>(null);
  const [startYearInput, setStartYearInput] = useState(filters.dateRange?.start?.toString() || "");
  const [endYearInput, setEndYearInput] = useState(filters.dateRange?.end?.toString() || "");
  const searchIdBase = useId().replace(/:/g, "");
  const searchRootRef = useRef<HTMLDivElement | null>(null);
  const refineCloseTimerRef = useRef<number | null>(null);
  const showFilters = refineOpen ?? internalShowFilters;

  const setRefineOpen = (next: boolean) => {
    if (refineOpen === undefined) {
      setInternalShowFilters(next);
    }
    if (!next) {
      setFiltersPinned(false);
      setOpenChoiceField(null);
    }
    onRefineOpenChange?.(next);
  };

  const clearRefineCloseTimer = () => {
    if (refineCloseTimerRef.current !== null) {
      window.clearTimeout(refineCloseTimerRef.current);
      refineCloseTimerRef.current = null;
    }
  };

  const openFilters = (options?: { pin?: boolean }) => {
    clearRefineCloseTimer();
    if (options?.pin) {
      setFiltersPinned(true);
    }
    setRefineOpen(true);
    // Close sort dropdown immediately if not pinned (mirror how openSortDropdown closes filters)
    if (!sortPinned) {
      clearSortCloseTimer();
      setSortDropdownOpen(false);
    }
  };

  const closeFilters = () => {
    clearRefineCloseTimer();
    setRefineOpen(false);
  };

  const scheduleFiltersClose = () => {
    clearRefineCloseTimer();
    if (filtersPinned) return;

    refineCloseTimerRef.current = window.setTimeout(() => {
      setRefineOpen(false);
      refineCloseTimerRef.current = null;
    }, REFINE_CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (refinePinned !== undefined && refinePinned !== filtersPinned) {
      setFiltersPinnedRaw(refinePinned);
    }
  }, [refinePinned]);

  useEffect(() => {
    setStartYearInput(filters.dateRange?.start?.toString() || "");
    setEndYearInput(filters.dateRange?.end?.toString() || "");
  }, [filters.dateRange?.end, filters.dateRange?.start]);

  useEffect(() => {
    if (!showFilters) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!searchRootRef.current?.contains(event.target)) {
        closeFilters();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isCompact, showFilters]);

  useEffect(() => () => clearRefineCloseTimer(), []);

  useEffect(() => {
    if (!showFilters) {
      setOpenChoiceField(null);
    }
  }, [showFilters]);

  const hasActiveFilters = Boolean(
    query.trim()
      || selectedFormats?.length
      || (!hideCollectionFilter && filters.collection)
      || filters.person
      || filters.sender
      || filters.recipient
      || filters.place
      || filters.topic
      || filters.tone
      || filters.relationship
      || filters.year
      || filters.dateRange?.start
      || filters.dateRange?.end
      || filters.verified !== undefined && filters.verified !== null,
  );

  const searchStatus = useMemo(() => {
    if (loading && hasQuery) return `Searching for "${query.trim()}"...`;
    if (loading && hasActiveFilters) return "Refreshing refined archive...";
    if (loading) return "Refreshing archive browse...";
    if (hasQuery) {
      return `${total} result${total === 1 ? "" : "s"} for "${query.trim()}"`;
    }
    if (hasActiveFilters) {
      return `${total} matching archive item${total === 1 ? "" : "s"}`;
    }
    return `${total} published archive item${total === 1 ? "" : "s"}`;
  }, [hasActiveFilters, hasQuery, loading, query, total]);

  const availableSortFields = useMemo(() => {
    const fields = getAvailableSortFields(hasQuery);
    return hideCollectionFilter ? fields.filter((f) => f.value !== "collection") : fields;
  }, [hasQuery, hideCollectionFilter]);

  const updateFilter = (partial: Partial<SearchFilters>) => {
    onFiltersChange({
      ...filters,
      ...partial,
    });
  };

  const activePills = useMemo(() => {
    const pills: Array<{ key: string; label: string; onClear: () => void }> = [];

    if (filters.collection && !hideCollectionFilter) {
      pills.push({
        key: `collection-${filters.collection}`,
        label: `Collection: ${getCollectionLabel(filters.collection, facets)}`,
        onClear: () => updateFilter({ collection: null }),
      });
    }
    if (filters.person) {
      pills.push({
        key: `person-${filters.person}`,
        label: `Sender or recipient: ${filters.person}`,
        onClear: () => updateFilter({ person: null, personRole: null }),
      });
    }
    if (filters.sender) {
      pills.push({
        key: `sender-${filters.sender}`,
        label: `From: ${filters.sender}`,
        onClear: () => updateFilter({ sender: null }),
      });
    }
    if (filters.recipient) {
      pills.push({
        key: `recipient-${filters.recipient}`,
        label: `To: ${filters.recipient}`,
        onClear: () => updateFilter({ recipient: null }),
      });
    }
    if (filters.place) {
      pills.push({
        key: `place-${filters.place}`,
        label: `Place: ${filters.place}`,
        onClear: () => updateFilter({ place: null }),
      });
    }
    if (filters.topic) {
      pills.push({
        key: `topic-${filters.topic}`,
        label: `Topic: ${formatFacetLabel(filters.topic)}`,
        onClear: () => updateFilter({ topic: null }),
      });
    }
    if (filters.tone) {
      pills.push({
        key: `tone-${filters.tone}`,
        label: `Tone: ${formatFacetLabel(filters.tone)}`,
        onClear: () => updateFilter({ tone: null }),
      });
    }
    if (filters.relationship) {
      pills.push({
        key: `relationship-${filters.relationship}`,
        label: `Relationship: ${formatFacetLabel(filters.relationship)}`,
        onClear: () => updateFilter({ relationship: null }),
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
  }, [facets, filters, selectedFormats]);

  const activeFilterCount = activePills.length;
  const resolvedSort = getResolvedSort(query, filters);
  const resolvedSortField = availableSortFields.find((option) => option.value === resolvedSort.sort)
    || availableSortFields[0]
    || SORT_FIELD_OPTIONS[0];
  const sortChoiceOptions = useMemo<FilterChoiceOption[]>(
    () => availableSortFields.map((option) => ({
      value: getSortValue(option),
      label: option.label,
    })),
    [availableSortFields],
  );
  const sortDirectionLabel = getSortDirectionAriaLabel(resolvedSort.sort, resolvedSort.sortOrder);
  const sortDirectionDisplayLabel = getSortDirectionDisplayLabel(resolvedSort.sort, resolvedSort.sortOrder);
  const canToggleSortDirection = resolvedSort.sort !== "relevance";

  // Combined sort dropdown (replaces sort field + direction toggle in toolbar)
  const [internalSortOpen, setInternalSortOpen] = useState(false);
  const [sortPinned, setSortPinned] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownOpen = sortOpenProp ?? internalSortOpen;
  const setSortDropdownOpen = (next: boolean) => {
    if (sortOpenProp === undefined) {
      setInternalSortOpen(next);
    }
    if (!next) {
      setSortPinned(false);
    }
    onSortOpenChange?.(next);
  };
  const visibleSortOptions = useMemo(() => {
    let options = COMBINED_SORT_OPTIONS.filter((o) => !o.requiresQuery || hasQuery);
    if (hideCollectionFilter) options = options.filter((o) => o.sort !== "collection");
    return options;
  }, [hasQuery, hideCollectionFilter]);
  const currentSortOption = visibleSortOptions.find((o) => o.sort === resolvedSort.sort);
  const currentSortLabel = currentSortOption?.label || visibleSortOptions[0]?.label || "Sort";
  const showSortArrow = currentSortOption?.canToggle;
  const sortArrow = resolvedSort.sortOrder === "asc" ? "\u2191" : "\u2193";

  const sortCloseTimerRef = useRef<number | null>(null);
  const clearSortCloseTimer = () => {
    if (sortCloseTimerRef.current !== null) {
      window.clearTimeout(sortCloseTimerRef.current);
      sortCloseTimerRef.current = null;
    }
  };

  const openSortDropdown = () => {
    clearSortCloseTimer();
    setSortDropdownOpen(true);
    // Close filter dropdown if not pinned
    if (!filtersPinned) {
      clearRefineCloseTimer();
      setRefineOpen(false);
    }
  };

  const closeSortNow = () => {
    clearSortCloseTimer();
    setSortDropdownOpen(false);
  };

  const scheduleSortClose = () => {
    clearSortCloseTimer();
    if (sortPinned) return;
    sortCloseTimerRef.current = window.setTimeout(() => {
      setSortDropdownOpen(false);
      sortCloseTimerRef.current = null;
    }, REFINE_CLOSE_DELAY_MS);
  };

  const handleSortClick = () => {
    if (!sortDropdownOpen) {
      openSortDropdown();
      setSortPinned(true);
    } else if (sortPinned) {
      setSortPinned(false);
    } else {
      setSortPinned(true);
      clearSortCloseTimer();
    }
  };

  useEffect(() => {
    if (!sortDropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
        setSortPinned(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sortDropdownOpen]);

  useEffect(() => () => clearSortCloseTimer(), []);

  // Sync sort open/pinned from parent prop
  useEffect(() => {
    if (sortOpenProp === false) {
      setInternalSortOpen(false);
      setSortPinned(false);
    }
  }, [sortOpenProp]);
  const toneChoiceOptions = useMemo<FilterChoiceOption[]>(
    () => facets.tones.map((facet) => ({
      value: facet.value,
      label: formatFacetLabel(facet.value),
      count: facet.count,
    })),
    [facets.tones],
  );
  const relationshipChoiceOptions = useMemo<FilterChoiceOption[]>(
    () => facets.relationships.map((facet) => ({
      value: facet.value,
      label: formatFacetLabel(facet.value),
      count: facet.count,
    })),
    [facets.relationships],
  );
  const verificationChoiceOptions = useMemo<FilterChoiceOption[]>(
    () => [
      { value: "all", label: "All items" },
      { value: "true", label: "Verified only" },
      { value: "false", label: "Unverified" },
    ],
    [],
  );
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
  const correspondentSuggestion = useMemo(
    () => getBestSuggestion(
      filters.person,
      facets.correspondents.map((facet) => ({
        value: facet.value,
        display: facet.value,
        count: facet.count,
      })),
    ),
    [facets.correspondents, filters.person],
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
  const topicSuggestion = useMemo(
    () => getBestSuggestion(
      filters.topic,
      facets.topics.map((facet) => ({
        value: facet.value,
        display: formatFacetLabel(facet.value),
        count: facet.count,
      })),
    ),
    [facets.topics, filters.topic],
  );

  const toggleFormatFilter = (format: LetterImageType) => {
    const nextFormats = selectedFormats?.includes(format)
      ? selectedFormats.filter((value) => value !== format)
      : [...(selectedFormats || []), format];

    updateFilter({
      format: nextFormats.length > 0 ? nextFormats : null,
    });
  };

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
      closeFilters();
    }
  };

  const collectionFilterId = `${searchIdBase}-collection`;
  const correspondentFilterId = `${searchIdBase}-person`;
  const senderFilterId = `${searchIdBase}-sender`;
  const recipientFilterId = `${searchIdBase}-recipient`;
  const placeFilterId = `${searchIdBase}-place`;
  const topicFilterId = `${searchIdBase}-topic`;
  const sortFilterId = `${searchIdBase}-sort`;
  const sortDirectionLabelId = `${searchIdBase}-sort-direction`;
  const startYearFilterId = `${searchIdBase}-year-start`;

  const formatFacetItems = useMemo(() => {
    const formatCounts = new Map(
      facets.formats.map((facet) => [facet.value, facet.count] as const),
    );
    const availableFormats = new Set<LetterImageType>([
      ...facets.formats.map((facet) => facet.value),
      ...(selectedFormats || []),
    ]);

    return ARCHIVE_FORMAT_ORDER
      .filter((format) => availableFormats.has(format))
      .map((format) => ({
        key: format,
        label: ARCHIVE_FORMAT_LABELS[format],
        count: formatCounts.get(format) || 0,
        active: selectedFormats?.includes(format) || false,
        onClick: () => toggleFormatFilter(format),
      }));
  }, [facets.formats, filters, selectedFormats]);

  const formatFacetRow = formatFacetItems.length > 0 ? (
    <FacetRow
      label="Browse by format"
      items={formatFacetItems}
    />
  ) : null;
  const formatFacetToolbar = formatFacetItems.length > 0 ? (
    <div className="search-toolbar-format-group" role="group" aria-label="Browse by format">
      {formatFacetItems.map((item) => (
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

  const sortDropdown = (
    <div
      className="search-sort-dropdown"
      ref={sortDropdownRef}
    >
      <button
        type="button"
        className={`search-sort-trigger${sortPinned ? " is-pinned" : ""}`}
        onClick={handleSortClick}
        onMouseEnter={openSortDropdown}
        onMouseLeave={scheduleSortClose}
        aria-expanded={sortDropdownOpen}
        aria-label="Sort archive results"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {showSortArrow && <span className="search-sort-arrow">{sortArrow}</span>}
      </button>
      {sortDropdownOpen && (
        <ul
          className={`search-sort-menu${sortPinned ? " is-pinned" : ""}`}
          role="listbox"
          onMouseLeave={() => { if (!sortPinned) closeSortNow(); }}
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
                    setSortDropdownOpen(false);
                    setSortPinned(false);
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
      )}
    </div>
  );

  const refinementFields = (
    <div className={`filters${isCompact ? " filters-compact" : ""}`}>

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
        <label className="filter-label" htmlFor={correspondentFilterId}>Sender or Recipient</label>
        <input
          id={correspondentFilterId}
          type="text"
          className="filter-input"
          placeholder="Any sender or recipient"
          value={filters.person || ""}
          onChange={(event) => updateFilter({ person: event.target.value || null, personRole: null })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !correspondentSuggestion) return;
            event.preventDefault();
            updateFilter({ person: correspondentSuggestion.applyValue, personRole: null });
          }}
        />
        <SuggestionHint suggestion={correspondentSuggestion} />
      </div>

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

      <div className="filter-group">
        <label className="filter-label" htmlFor={startYearFilterId}>Year Range</label>
        <div className="date-range">
          <input
            id={startYearFilterId}
            type="text"
            inputMode="numeric"
            className="filter-input"
            placeholder="From year"
            value={startYearInput}
            onChange={(event) => setStartYearInput(normalizeYearInput(event.target.value))}
            onBlur={applyDateRange}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyDateRange();
            }}
          />
          <span className="date-separator">to</span>
          <input
            type="text"
            inputMode="numeric"
            className="filter-input"
            placeholder="To year"
            value={endYearInput}
            onChange={(event) => setEndYearInput(normalizeYearInput(event.target.value))}
            onBlur={applyDateRange}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyDateRange();
            }}
          />
        </div>
        <p className="filter-empty-copy">Use one year or both. Press Enter to apply.</p>
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor={topicFilterId}>Topic</label>
        <input
          id={topicFilterId}
          type="text"
          className="filter-input"
          placeholder="Topic"
          value={filters.topic || ""}
          onChange={(event) => updateFilter({ topic: event.target.value || null })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !topicSuggestion) return;
            event.preventDefault();
            updateFilter({ topic: topicSuggestion.applyValue });
          }}
        />
        <SuggestionHint suggestion={topicSuggestion} />
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor={`${searchIdBase}-tone`}>Tone</label>
        <FilterChoiceField
          id={`${searchIdBase}-tone`}
          label="Tone"
          value={filters.tone || ""}
          placeholder="Any tone"
          options={toneChoiceOptions}
          allowClear
          clearLabel="Any tone"
          searchable={toneChoiceOptions.length > 6}
          open={openChoiceField === `${searchIdBase}-tone`}
          onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-tone` : null)}
          onChange={(value) => updateFilter({ tone: value || null })}
        />
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor={`${searchIdBase}-relationship`}>Relationship</label>
        <FilterChoiceField
          id={`${searchIdBase}-relationship`}
          label="Relationship"
          value={filters.relationship || ""}
          placeholder="Any relationship"
          options={relationshipChoiceOptions}
          allowClear
          clearLabel="Any relationship"
          searchable
          open={openChoiceField === `${searchIdBase}-relationship`}
          onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-relationship` : null)}
          onChange={(value) => updateFilter({ relationship: value || null })}
        />
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor={`${searchIdBase}-verified`}>Verification</label>
        <FilterChoiceField
          id={`${searchIdBase}-verified`}
          label="Verification"
          value={filters.verified === null || filters.verified === undefined ? "all" : filters.verified ? "true" : "false"}
          placeholder="All items"
          options={verificationChoiceOptions}
          open={openChoiceField === `${searchIdBase}-verified`}
          onOpenChange={(open) => setOpenChoiceField(open ? `${searchIdBase}-verified` : null)}
          onChange={(value) => updateFilter({
            verified: value === "all" ? null : value === "true",
          })}
        />
      </div>
    </div>
  );

  if (isCompact) {
    return (
      <div className={`search search-compact${embedded ? " search-embedded" : ""}`} ref={searchRootRef}>
        <div className="search-input-wrapper search-input-wrapper-compact">
          <input
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
              className={`filter-toggle search-refine-toggle search-compact-filter-toggle${showFilters ? " active" : ""}${filtersPinned ? " is-pinned" : ""}`}
              aria-label="Open archive refine controls"
              aria-expanded={showFilters}
              aria-pressed={filtersPinned}
              onMouseEnter={() => openFilters()}
              onMouseLeave={scheduleFiltersClose}
              onFocus={() => openFilters()}
              onBlur={() => {
                if (!filtersPinned) {
                  scheduleFiltersClose();
                }
              }}
              onClick={() => {
                if (!showFilters) {
                  openFilters({ pin: true });
                  return;
                }

                if (filtersPinned) {
                  setFiltersPinned(false);
                  return;
                }

                setFiltersPinned(true);
                clearRefineCloseTimer();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1.5 2.5h11L8 7.5v4l-2 1.5V7.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {sortDropdown}

            {showFilters && (
              <div
                className={`search-compact-flyout search-refine-flyout${filtersPinned ? " is-pinned" : ""}`}
                onMouseLeave={() => { if (!filtersPinned) closeFilters(); }}
              >
                <div className="search-compact-flyout-header">
                  <div className="search-compact-flyout-header-row">
                    <div className="search-compact-flyout-copy">
                      <span className="search-facet-label">Refine</span>
                      <p className="search-compact-flyout-status">{searchStatus}</p>
                    </div>
                  </div>
                  {filtersPinned && (
                    <div className="search-compact-flyout-center">
                      <span className="search-compact-pin-indicator">Pinned open</span>
                    </div>
                  )}
                </div>
                {formatFacetRow}
                {renderActivePills(true)}
                {refinementFields}
                <div className="search-flyout-footer">
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
          <span className="search-status-label">Now Showing</span>
          <p className="search-status">{searchStatus}</p>
        </div>
      </div>

      <div className="search-input-wrapper" ref={dockTriggerRef}>
        <input
          type="search"
          className="search-input"
          placeholder="Search names, places, dates..."
          aria-label="Search the archive"
          enterKeyHint="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      <div className="search-toolbar">
        {formatFacetToolbar}
        <div className="search-toolbar-actions">
          <button
            type="button"
            className={`filter-toggle search-refine-toggle search-full-filter-toggle${showFilters ? " active" : ""}${filtersPinned ? " is-pinned" : ""}`}
            aria-label="Open archive refine controls"
            aria-expanded={showFilters}
            aria-pressed={filtersPinned}
            onMouseEnter={() => openFilters()}
            onMouseLeave={scheduleFiltersClose}
            onFocus={() => openFilters()}
            onBlur={() => {
              if (!filtersPinned) {
                scheduleFiltersClose();
              }
            }}
            onClick={() => {
              if (!showFilters) {
                openFilters({ pin: true });
                return;
              }

              if (filtersPinned) {
                setFiltersPinned(false);
                return;
              }

              setFiltersPinned(true);
              clearRefineCloseTimer();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1.5 2.5h11L8 7.5v4l-2 1.5V7.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {sortDropdown}
        </div>
      </div>

      {renderActivePills()}

      {showFilters && (
        <div
          className={`search-full-flyout search-refine-flyout${filtersPinned ? " is-pinned" : ""}`}
          onMouseLeave={() => { if (!filtersPinned) closeFilters(); }}
        >
          <div className="search-compact-flyout-header">
            <div className="search-compact-flyout-header-row">
              <div className="search-compact-flyout-copy">
                <span className="search-facet-label">Refine</span>
                <p className="search-compact-flyout-status">{searchStatus}</p>
              </div>
            </div>
            {filtersPinned && (
              <div className="search-compact-flyout-center">
                <span className="search-compact-pin-indicator">Pinned open</span>
              </div>
            )}
          </div>
          {refinementFields}
          <div className="search-flyout-footer">
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

function SuggestionHint({ suggestion }: { suggestion: FilterSuggestion | null }) {
  if (!suggestion) return null;

  return (
    <p className="filter-suggestion-hint">
      Press Enter to use <strong>{suggestion.display}</strong>
      <span> · {suggestion.count} item{suggestion.count === 1 ? "" : "s"}</span>
    </p>
  );
}

function FilterChoiceField({
  id,
  label,
  value,
  placeholder,
  options,
  open,
  searchable = false,
  allowClear = false,
  clearLabel = "Any",
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
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [panelDirection, setPanelDirection] = useState<"down" | "up">("down");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) || null;
  const filteredOptions = useMemo(
    () => filterChoiceOptions(options, searchTerm),
    [options, searchTerm],
  );

  useEffect(() => {
    if (open && searchable) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
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

  return (
    <div className={`filter-choice${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`filter-choice-trigger${selectedOption ? " has-value" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span className="filter-choice-value">{selectedOption?.label || placeholder}</span>
        <span className="filter-choice-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div ref={panelRef} className={`filter-choice-panel${panelDirection === "up" ? " filter-choice-panel-up" : ""}`}>
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
          <div className="filter-choice-options" role="listbox" aria-label={label}>
            {allowClear && (
              <button
                type="button"
                className={`filter-choice-option${!selectedOption ? " active" : ""}`}
                onClick={() => {
                  onChange("");
                  onOpenChange(false);
                }}
              >
                <span>{clearLabel}</span>
              </button>
            )}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`filter-choice-option${option.value === value ? " active" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    onOpenChange(false);
                  }}
                >
                  <span>{option.label}</span>
                  {typeof option.count === "number" && (
                    <span className="filter-choice-count">{option.count}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="filter-choice-empty">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
