import type { ReactNode } from "react";
import { Button } from "../../../components/common";
import DuplicateSuggestions from "../../../components/DuplicateSuggestions";

interface BaseEntityItem {
  id: string;
  canonicalName: string;
  letterCount: number;
  aliases?: string[] | null;
}

interface EntityListPanelProps<T extends BaseEntityItem> {
  entityType: "person" | "place";
  refreshKey: number;
  onSuggestionMerge: (keepId: string, mergeId: string, keepName: string, mergeName: string) => void;
  onRefreshSuggestions: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchPlaceholder: string;
  items: T[];
  loading: boolean;
  emptyMessage: string;
  selectedEntityId: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectItem: (item: T) => void;
  onSelectAll: () => void;
  onOpenBulkMerge: () => void;
  onClearSelection: () => void;
  panelClassName: string;
  listClassName: string;
  itemClassName: string;
  contentClassName: string;
  renderItemContent: (item: T) => ReactNode;
}

export default function EntityListPanel<T extends BaseEntityItem>({
  entityType,
  refreshKey,
  onSuggestionMerge,
  onRefreshSuggestions,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder,
  items,
  loading,
  emptyMessage,
  selectedEntityId,
  selectedIds,
  onToggleSelect,
  onSelectItem,
  onSelectAll,
  onOpenBulkMerge,
  onClearSelection,
  panelClassName,
  listClassName,
  itemClassName,
  contentClassName,
  renderItemContent,
}: EntityListPanelProps<T>) {
  return (
    <div className={panelClassName}>
      <DuplicateSuggestions
        key={refreshKey}
        entityType={entityType}
        onMerge={onSuggestionMerge}
        onRefresh={onRefreshSuggestions}
      />

      <div className="search-box">
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>

      {items.length > 0 && (
        <div className="bulk-controls">
          <label className="select-all-checkbox">
            <input
              type="checkbox"
              checked={selectedIds.size === items.length && items.length > 0}
              onChange={onSelectAll}
            />
            <span>Select All</span>
          </label>
          {selectedIds.size > 0 && (
            <div className="bulk-actions">
              <span className="selected-count">{selectedIds.size} selected</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={onOpenBulkMerge}
                disabled={selectedIds.size < 2}
              >
                Merge Selected
              </Button>
              <button className="clear-selection-btn" onClick={onClearSelection}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : items.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <div className={listClassName}>
          {items.map((item) => (
            <div
              key={item.id}
              className={`${itemClassName} ${selectedEntityId === item.id ? "selected" : ""} ${selectedIds.has(item.id) ? "checked" : ""}`}
            >
              <input
                type="checkbox"
                className="item-checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => onToggleSelect(item.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${item.canonicalName}`}
              />
              <div className={contentClassName} onClick={() => onSelectItem(item)}>
                {renderItemContent(item)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
