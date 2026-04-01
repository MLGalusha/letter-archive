import { memo } from "react";

export interface FacetItem {
  key: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

export default memo(function FacetRow({
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
}, (prev, next) => {
  if (prev.label !== next.label) return false;
  if (prev.items.length !== next.items.length) return false;
  return prev.items.every((item, i) =>
    item.key === next.items[i].key &&
    item.label === next.items[i].label &&
    item.count === next.items[i].count &&
    item.active === next.items[i].active
  );
});
