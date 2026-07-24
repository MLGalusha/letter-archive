import type { ContentStatus } from "../../../types/Letter";
import { CONTENT_STATUS_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { ContentFilterView, DashboardFilterStats } from "./types";

interface ContentStatusFilterSectionProps {
  stats: DashboardFilterStats;
  contentFilterView: ContentFilterView;
  onContentFilterViewChange: (value: ContentFilterView) => void;
  transcriptStatusFilters: readonly ContentStatus[];
  toggleTranscriptFilter: (value: ContentStatus) => void;
  metadataStatusFilters: readonly ContentStatus[];
  toggleMetadataFilter: (value: ContentStatus) => void;
  extraContentStatusFilters: readonly ContentStatus[];
  toggleExtraContentFilter: (value: ContentStatus) => void;
}

export default function ContentStatusFilterSection({
  stats,
  contentFilterView,
  onContentFilterViewChange,
  transcriptStatusFilters,
  toggleTranscriptFilter,
  metadataStatusFilters,
  toggleMetadataFilter,
  extraContentStatusFilters,
  toggleExtraContentFilter,
}: ContentStatusFilterSectionProps) {
  const selectedFilters = {
    transcript: transcriptStatusFilters,
    metadata: metadataStatusFilters,
    extras: extraContentStatusFilters,
  }[contentFilterView];
  const toggleFilter = {
    transcript: toggleTranscriptFilter,
    metadata: toggleMetadataFilter,
    extras: toggleExtraContentFilter,
  }[contentFilterView];

  return (
    <section className="filter-panel-section content-filter-section">
      <span className="filter-panel-label">Content status</span>
      <div className="content-filter-toggle">
        <button
          type="button"
          className={`content-toggle-btn ${contentFilterView === "transcript" ? "active" : ""}`}
          onClick={() => onContentFilterViewChange("transcript")}
        >
          Transcript
          {contentFilterView !== "transcript" && transcriptStatusFilters.length > 0 && (
            <span className="toggle-badge">{transcriptStatusFilters.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`content-toggle-btn ${contentFilterView === "metadata" ? "active" : ""}`}
          onClick={() => onContentFilterViewChange("metadata")}
        >
          Metadata
          {contentFilterView !== "metadata" && metadataStatusFilters.length > 0 && (
            <span className="toggle-badge">{metadataStatusFilters.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`content-toggle-btn ${contentFilterView === "extras" ? "active" : ""}`}
          onClick={() => onContentFilterViewChange("extras")}
        >
          Extras
          {contentFilterView !== "extras" && extraContentStatusFilters.length > 0 && (
            <span className="toggle-badge">{extraContentStatusFilters.length}</span>
          )}
        </button>
      </div>
      <div className="filter-button-grid filter-button-grid--content">
        {CONTENT_STATUS_FILTERS.map((filter) => {
          const isActive = selectedFilters.includes(filter.value);

          return (
            <FilterOptionButton
              key={filter.value}
              className={filter.className}
              count={stats[filter.countKeys[contentFilterView]]}
              label={filter.label}
              active={isActive}
              onClick={() => toggleFilter(filter.value)}
            />
          );
        })}
      </div>
    </section>
  );
}
