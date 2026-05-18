import Icon from "../../../components/common/Icon";

interface DashboardCollectionFilterControlProps {
  collectionInput: string;
  collectionFilters: string[];
  onCollectionInputChange: (value: string) => void;
  onAddCollectionFilter: () => void;
  onRemoveCollectionFilter: (code: string) => void;
}

export default function DashboardCollectionFilterControl({
  collectionInput,
  collectionFilters,
  onCollectionInputChange,
  onAddCollectionFilter,
  onRemoveCollectionFilter,
}: DashboardCollectionFilterControlProps) {
  const hasCollectionFilter = collectionFilters.length > 0;

  return (
    <section className={`filter-panel-section collection-filter-section ${hasCollectionFilter ? "collection-filter-section--active" : ""}`}>
      <div className="filter-panel-section-header">
        <div>
          <span className="filter-panel-label">Collection</span>
          <span className="filter-panel-summary">
            {hasCollectionFilter
              ? collectionFilters.length === 1 ? `Collection ${collectionFilters[0]}` : `${collectionFilters.length} collections`
              : "All collections"}
          </span>
        </div>
        {hasCollectionFilter && (
          <button
            type="button"
            className="filter-panel-clear"
            onClick={() => collectionFilters.forEach(onRemoveCollectionFilter)}
            aria-label="Clear collection filters"
          >
            Clear
          </button>
        )}
      </div>

      {hasCollectionFilter && (
        <div className="collection-rule-list">
          {collectionFilters.map((code) => (
            <div key={code} className="collection-rule-row">
              <span className="collection-rule-prefix">collection</span>
              <span className="collection-rule-code">{code}</span>
              <button
                type="button"
                className="sort-rule-remove"
                onClick={() => onRemoveCollectionFilter(code)}
                aria-label={`Remove collection ${code} filter`}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="collection-code-field">
        <span>Add code</span>
        <div className="collection-code-input-wrap">
          <input
            type="text"
            className="collection-input"
            aria-label="Collection code"
            placeholder={hasCollectionFilter ? "000" : "Any"}
            value={collectionInput}
            onChange={(event) => onCollectionInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddCollectionFilter();
              }
            }}
            maxLength={3}
            inputMode="numeric"
          />
          <button
            type="button"
            className="collection-add-btn"
            onClick={onAddCollectionFilter}
            disabled={collectionInput === "" || Number(collectionInput) === 0}
            aria-label="Add collection filter"
            title="Add collection filter"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
