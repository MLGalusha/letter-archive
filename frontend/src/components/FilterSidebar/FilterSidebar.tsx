import { useState, useEffect, useRef } from 'react';
import type { VisibilityState, WorkflowState, ContentStatus } from '../../types/Letter';
import type { AdminCollectionInfo } from '../../api/collections';
import { Button } from '../common';
import './FilterSidebar.css';

// Filter state interface
export interface FilterState {
  collection: string; // 'all' or collection code
  visibility: VisibilityState[];
  transcriptStatus: ContentStatus[];
  metadataStatus: ContentStatus[];
  workflow: WorkflowState[];
}

// Stats interface for displaying counts
export interface FilterStats {
  total: number;
  published: number;
  hidden: number;
  transcriptEmpty: number;
  transcriptAiDraft: number;
  transcriptEdited: number;
  transcriptVerified: number;
  metadataEmpty: number;
  metadataAiDraft: number;
  metadataEdited: number;
  metadataVerified: number;
  uploaded: number;
  transcribed: number;
  metadataReady: number;
}

interface FilterSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  appliedFilters: FilterState;
  stats: FilterStats;
  collections: AdminCollectionInfo[];
  onApply: (filters: FilterState) => void;
}

// Default empty filter state
export const emptyFilterState: FilterState = {
  collection: 'all',
  visibility: [],
  transcriptStatus: [],
  metadataStatus: [],
  workflow: [],
};

// Collapsible section component
function FilterSection({
  title,
  isExpanded,
  onToggle,
  activeCount,
  children,
}: {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  activeCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="filter-section">
      <button className="section-header" onClick={onToggle} type="button">
        <span className="section-arrow">{isExpanded ? '▼' : '▶'}</span>
        <span className="section-title">{title}</span>
        {activeCount !== undefined && activeCount > 0 && (
          <span className="section-badge">{activeCount}</span>
        )}
      </button>
      {isExpanded && <div className="section-content">{children}</div>}
    </div>
  );
}

// Checkbox option component
function FilterCheckbox({
  label,
  checked,
  count,
  onChange,
}: {
  label: string;
  checked: boolean;
  count?: number;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="filter-option">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="filter-label">{label}</span>
      {count !== undefined && <span className="filter-count">{count}</span>}
    </label>
  );
}

export default function FilterSidebar({
  isOpen,
  onClose,
  appliedFilters,
  stats,
  collections,
  onApply,
}: FilterSidebarProps) {
  // Staged filters (changes before Apply)
  const [staged, setStaged] = useState<FilterState>(appliedFilters);

  // Expanded sections
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['collection', 'visibility', 'transcript', 'metadata'])
  );

  // Collection search input
  const [collectionSearch, setCollectionSearch] = useState('');

  // Ref for clicking outside
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Reset staged when sidebar opens (sync with applied)
  useEffect(() => {
    if (isOpen) {
      setStaged(appliedFilters);
    }
  }, [isOpen, appliedFilters]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    // Delay to avoid immediate close on open click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const toggleSection = (section: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Toggle helpers for arrays
  const toggleArrayValue = <T,>(array: T[], value: T): T[] => {
    return array.includes(value)
      ? array.filter((v) => v !== value)
      : [...array, value];
  };

  // Handle Apply
  const handleApply = () => {
    onApply(staged);
    onClose();
  };

  // Handle Reset All
  const handleResetAll = () => {
    setStaged(emptyFilterState);
  };

  // Check if staged differs from empty (has active filters)
  const hasActiveFilters =
    staged.collection !== 'all' ||
    staged.visibility.length > 0 ||
    staged.transcriptStatus.length > 0 ||
    staged.metadataStatus.length > 0 ||
    staged.workflow.length > 0;

  // Filter collections by search
  const filteredCollections = collections.filter(
    (c) =>
      collectionSearch === '' ||
      c.collectionCode.toLowerCase().includes(collectionSearch.toLowerCase()) ||
      (c.title && c.title.toLowerCase().includes(collectionSearch.toLowerCase()))
  );

  // Sort collections by total count descending
  const sortedCollections = [...filteredCollections].sort((a, b) => {
    const totalA = a.publishedCount + a.hiddenCount;
    const totalB = b.publishedCount + b.hiddenCount;
    return totalB - totalA;
  });

  return (
    <>
      {/* Overlay backdrop */}
      {isOpen && <div className="filter-sidebar-overlay" />}

      {/* Sidebar panel */}
      <div
        ref={sidebarRef}
        className={`filter-sidebar ${isOpen ? 'open' : ''}`}
      >
        {/* Header */}
        <div className="sidebar-header">
          <h2 className="sidebar-title">Filters</h2>
          <div className="sidebar-header-actions">
            {hasActiveFilters && (
              <button
                className="clear-all-btn"
                onClick={handleResetAll}
                type="button"
              >
                Clear All
              </button>
            )}
            <button className="close-btn" onClick={onClose} type="button">
              ×
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="sidebar-content">
          {/* Collection Section */}
          <FilterSection
            title="Collection"
            isExpanded={expanded.has('collection')}
            onToggle={() => toggleSection('collection')}
            activeCount={staged.collection !== 'all' ? 1 : 0}
          >
            <div className="collection-filter">
              <input
                type="text"
                className="collection-search"
                placeholder="Search collections..."
                value={collectionSearch}
                onChange={(e) => setCollectionSearch(e.target.value)}
              />
              <div className="collection-list">
                <label
                  className={`collection-option ${staged.collection === 'all' ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="collection"
                    checked={staged.collection === 'all'}
                    onChange={() => setStaged({ ...staged, collection: 'all' })}
                  />
                  <span className="collection-code">All Collections</span>
                  <span className="collection-count">{stats.total}</span>
                </label>
                {sortedCollections.map((c) => {
                  const total = c.publishedCount + c.hiddenCount;
                  return (
                    <label
                      key={c.id}
                      className={`collection-option ${staged.collection === c.collectionCode ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="collection"
                        checked={staged.collection === c.collectionCode}
                        onChange={() =>
                          setStaged({ ...staged, collection: c.collectionCode })
                        }
                      />
                      <span className="collection-code">{c.collectionCode}</span>
                      <span className="collection-count">{total}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </FilterSection>

          {/* Visibility Section */}
          <FilterSection
            title="Visibility"
            isExpanded={expanded.has('visibility')}
            onToggle={() => toggleSection('visibility')}
            activeCount={staged.visibility.length}
          >
            <FilterCheckbox
              label="Published"
              checked={staged.visibility.includes('PUBLISHED')}
              count={stats.published}
              onChange={() =>
                setStaged({
                  ...staged,
                  visibility: toggleArrayValue(staged.visibility, 'PUBLISHED'),
                })
              }
            />
            <FilterCheckbox
              label="Hidden"
              checked={staged.visibility.includes('HIDDEN')}
              count={stats.hidden}
              onChange={() =>
                setStaged({
                  ...staged,
                  visibility: toggleArrayValue(staged.visibility, 'HIDDEN'),
                })
              }
            />
          </FilterSection>

          {/* Transcript Status Section */}
          <FilterSection
            title="Transcript Status"
            isExpanded={expanded.has('transcript')}
            onToggle={() => toggleSection('transcript')}
            activeCount={staged.transcriptStatus.length}
          >
            <FilterCheckbox
              label="Empty"
              checked={staged.transcriptStatus.includes('EMPTY')}
              count={stats.transcriptEmpty}
              onChange={() =>
                setStaged({
                  ...staged,
                  transcriptStatus: toggleArrayValue(staged.transcriptStatus, 'EMPTY'),
                })
              }
            />
            <FilterCheckbox
              label="AI Draft"
              checked={staged.transcriptStatus.includes('AI_DRAFT')}
              count={stats.transcriptAiDraft}
              onChange={() =>
                setStaged({
                  ...staged,
                  transcriptStatus: toggleArrayValue(staged.transcriptStatus, 'AI_DRAFT'),
                })
              }
            />
            <FilterCheckbox
              label="Edited"
              checked={staged.transcriptStatus.includes('EDITED')}
              count={stats.transcriptEdited}
              onChange={() =>
                setStaged({
                  ...staged,
                  transcriptStatus: toggleArrayValue(staged.transcriptStatus, 'EDITED'),
                })
              }
            />
            <FilterCheckbox
              label="Verified"
              checked={staged.transcriptStatus.includes('VERIFIED')}
              count={stats.transcriptVerified}
              onChange={() =>
                setStaged({
                  ...staged,
                  transcriptStatus: toggleArrayValue(staged.transcriptStatus, 'VERIFIED'),
                })
              }
            />
          </FilterSection>

          {/* Metadata Status Section */}
          <FilterSection
            title="Metadata Status"
            isExpanded={expanded.has('metadata')}
            onToggle={() => toggleSection('metadata')}
            activeCount={staged.metadataStatus.length}
          >
            <FilterCheckbox
              label="Empty"
              checked={staged.metadataStatus.includes('EMPTY')}
              count={stats.metadataEmpty}
              onChange={() =>
                setStaged({
                  ...staged,
                  metadataStatus: toggleArrayValue(staged.metadataStatus, 'EMPTY'),
                })
              }
            />
            <FilterCheckbox
              label="AI Draft"
              checked={staged.metadataStatus.includes('AI_DRAFT')}
              count={stats.metadataAiDraft}
              onChange={() =>
                setStaged({
                  ...staged,
                  metadataStatus: toggleArrayValue(staged.metadataStatus, 'AI_DRAFT'),
                })
              }
            />
            <FilterCheckbox
              label="Edited"
              checked={staged.metadataStatus.includes('EDITED')}
              count={stats.metadataEdited}
              onChange={() =>
                setStaged({
                  ...staged,
                  metadataStatus: toggleArrayValue(staged.metadataStatus, 'EDITED'),
                })
              }
            />
            <FilterCheckbox
              label="Verified"
              checked={staged.metadataStatus.includes('VERIFIED')}
              count={stats.metadataVerified}
              onChange={() =>
                setStaged({
                  ...staged,
                  metadataStatus: toggleArrayValue(staged.metadataStatus, 'VERIFIED'),
                })
              }
            />
          </FilterSection>

          {/* Workflow Section (Legacy) */}
          <FilterSection
            title="Workflow"
            isExpanded={expanded.has('workflow')}
            onToggle={() => toggleSection('workflow')}
            activeCount={staged.workflow.length}
          >
            <FilterCheckbox
              label="Uploaded"
              checked={staged.workflow.includes('UPLOADED')}
              count={stats.uploaded}
              onChange={() =>
                setStaged({
                  ...staged,
                  workflow: toggleArrayValue(staged.workflow, 'UPLOADED'),
                })
              }
            />
            <FilterCheckbox
              label="Transcribed"
              checked={staged.workflow.includes('TRANSCRIBED')}
              count={stats.transcribed}
              onChange={() =>
                setStaged({
                  ...staged,
                  workflow: toggleArrayValue(staged.workflow, 'TRANSCRIBED'),
                })
              }
            />
            <FilterCheckbox
              label="Metadata Ready"
              checked={staged.workflow.includes('METADATA_DRAFTED')}
              count={stats.metadataReady}
              onChange={() =>
                setStaged({
                  ...staged,
                  workflow: toggleArrayValue(staged.workflow, 'METADATA_DRAFTED'),
                })
              }
            />
          </FilterSection>
        </div>

        {/* Footer with Apply/Reset buttons */}
        <div className="sidebar-footer">
          <Button variant="secondary" onClick={handleResetAll}>
            Reset All
          </Button>
          <Button variant="primary" onClick={handleApply}>
            Apply Filters
          </Button>
        </div>
      </div>
    </>
  );
}
