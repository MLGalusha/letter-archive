import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button, Icon } from '../common';
import { getDuplicateSuggestions, type DuplicateSuggestion } from '../../api/entities';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import './DuplicateSuggestions.css';

interface DuplicateSuggestionsProps {
  entityType: 'person' | 'place';
  onMerge: (keepId: string, mergeId: string, keepName: string, mergeName: string) => void;
  onRefresh?: () => void;
}

const DISMISSED_KEY_PREFIX = 'dismissed_duplicates_';

export default function DuplicateSuggestions({
  entityType,
  onMerge,
  onRefresh,
}: DuplicateSuggestionsProps) {
  const { showToast } = useToast();
  const [suggestions, setSuggestions] = useState<DuplicateSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set());

  // Load dismissed pairs from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${entityType}`);
    if (stored) {
      try {
        setDismissedPairs(new Set(JSON.parse(stored)));
      } catch {
        // Invalid data, ignore
      }
    }
  }, [entityType]);

  // Fetch suggestions
  useEffect(() => {
    async function fetchSuggestions() {
      setLoading(true);
      try {
        const response = await getDuplicateSuggestions(entityType, 50);
        setSuggestions(response.suggestions);
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to fetch duplicate suggestions'), 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchSuggestions();
  }, [entityType, onRefresh, showToast]);

  const getPairKey = useCallback((a: string, b: string) => {
    return [a, b].sort().join('|');
  }, []);

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !dismissedPairs.has(getPairKey(s.entityAId, s.entityBId))),
    [suggestions, dismissedPairs, getPairKey]
  );

  // Handle dismiss
  const handleDismiss = (suggestion: DuplicateSuggestion) => {
    const pairKey = getPairKey(suggestion.entityAId, suggestion.entityBId);
    const newDismissed = new Set(dismissedPairs);
    newDismissed.add(pairKey);
    setDismissedPairs(newDismissed);
    localStorage.setItem(
      `${DISMISSED_KEY_PREFIX}${entityType}`,
      JSON.stringify(Array.from(newDismissed))
    );
  };

  // Handle clear all dismissed
  const handleClearDismissed = () => {
    setDismissedPairs(new Set());
    localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${entityType}`);
  };

  if (loading) {
    return null; // Don't show loading state for suggestions
  }

  if (visibleSuggestions.length === 0) {
    return null; // Don't show section if no suggestions
  }

  return (
    <div className="duplicate-suggestions">
      <div
        className="suggestions-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <div className="suggestions-title">
          <Icon name={expanded ? 'down' : 'right'} size={12} />
          <span>Potential Duplicates</span>
          <span className="suggestions-count">{visibleSuggestions.length}</span>
        </div>
        {dismissedPairs.size > 0 && (
          <button
            className="clear-dismissed-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleClearDismissed();
            }}
          >
            Show {dismissedPairs.size} dismissed
          </button>
        )}
      </div>

      {expanded && (
        <div className="suggestions-list">
          {visibleSuggestions.map((suggestion) => (
            <div key={`${suggestion.entityAId}-${suggestion.entityBId}`} className="suggestion-item">
              <div className="suggestion-entities">
                <div className="entity-info">
                  <span className="entity-name">{suggestion.entityAName}</span>
                  <span className="entity-meta">
                    {suggestion.entityALetterCount} letters
                    {suggestion.entityAAliases.length > 0 && (
                      <span className="entity-aliases">
                        ({suggestion.entityAAliases.slice(0, 2).join(', ')}
                        {suggestion.entityAAliases.length > 2 && '...'})
                      </span>
                    )}
                  </span>
                </div>
                <div className="similarity-badge">{suggestion.similarity}%</div>
                <div className="entity-info">
                  <span className="entity-name">{suggestion.entityBName}</span>
                  <span className="entity-meta">
                    {suggestion.entityBLetterCount} letters
                    {suggestion.entityBAliases.length > 0 && (
                      <span className="entity-aliases">
                        ({suggestion.entityBAliases.slice(0, 2).join(', ')}
                        {suggestion.entityBAliases.length > 2 && '...'})
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <div className="suggestion-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    onMerge(
                      suggestion.entityAId,
                      suggestion.entityBId,
                      suggestion.entityAName,
                      suggestion.entityBName
                    )
                  }
                >
                  Merge
                </Button>
                <button
                  className="dismiss-btn"
                  onClick={() => handleDismiss(suggestion)}
                  title="Dismiss suggestion"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
