interface DashboardCollectionFilterControlProps {
  collectionInput: string;
  collectionFilter: string;
  onCollectionInputChange: (value: string) => void;
}

export default function DashboardCollectionFilterControl({
  collectionInput,
  collectionFilter,
  onCollectionInputChange,
}: DashboardCollectionFilterControlProps) {
  const hasCollectionFilter = collectionFilter !== "all";

  return (
    <section className={`filter-panel-section collection-filter-section ${hasCollectionFilter ? "collection-filter-section--active" : ""}`}>
      <div className="filter-panel-section-header">
        <div>
          <span className="filter-panel-label">Collection</span>
          <span className="filter-panel-summary">
            {hasCollectionFilter ? `Collection ${collectionFilter}` : "All collections"}
          </span>
        </div>
        {hasCollectionFilter && (
          <button
            type="button"
            className="filter-panel-clear"
            onClick={() => onCollectionInputChange("")}
            aria-label="Clear collection filter"
          >
            Clear
          </button>
        )}
      </div>

      <label className="collection-code-field">
        <span>Code</span>
        <input
          type="text"
          className="collection-input"
          aria-label="Collection code"
          placeholder="Any"
          value={collectionInput}
          onChange={(event) => onCollectionInputChange(event.target.value)}
          maxLength={3}
          inputMode="numeric"
        />
      </label>
    </section>
  );
}
