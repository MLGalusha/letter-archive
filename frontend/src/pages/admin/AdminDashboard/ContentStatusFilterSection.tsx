import type { ContentStatus } from "../../../types/Letter";
import { CONTENT_STATUS_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { ContentFilterView, DashboardFilterStats } from "./types";

interface ContentStatusFilterSectionProps {
  stats: DashboardFilterStats;
  contentFilterView: ContentFilterView;
  setContentFilterView: (value: ContentFilterView) => void;
  transcriptStatusFilters: ContentStatus[];
  toggleTranscriptFilter: (value: ContentStatus) => void;
  metadataStatusFilters: ContentStatus[];
  toggleMetadataFilter: (value: ContentStatus) => void;
  extraContentStatusFilters: ContentStatus[];
  toggleExtraContentFilter: (value: ContentStatus) => void;
}

export default function ContentStatusFilterSection({
  stats,
  contentFilterView,
  setContentFilterView,
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
      <div className="content-filter-toggle">
        <button
          type="button"
          className={`content-toggle-btn ${contentFilterView === "transcript" ? "active" : ""}`}
          onClick={() => setContentFilterView("transcript")}
        >
          Transcript
          {contentFilterView !== "transcript" && transcriptStatusFilters.length > 0 && (
            <span className="toggle-badge">{transcriptStatusFilters.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`content-toggle-btn ${contentFilterView === "metadata" ? "active" : ""}`}
          onClick={() => setContentFilterView("metadata")}
        >
          Metadata
          {contentFilterView !== "metadata" && metadataStatusFilters.length > 0 && (
            <span className="toggle-badge">{metadataStatusFilters.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`content-toggle-btn ${contentFilterView === "extras" ? "active" : ""}`}
          onClick={() => setContentFilterView("extras")}
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
