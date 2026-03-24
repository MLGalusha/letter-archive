import { useState, useEffect, useMemo, useRef } from "react";
import "./ArchiveList.css";
import LetterCard from "../LetterCard/LetterCard";
import { getArchiveShelfItems } from "../../api/letters";
import type { ArchiveShelfItem } from "../../types/Letter";
import type { SearchFilters } from "../SearchBar/SearchBar";

interface ArchiveListProps {
  onLetterClick: (letterId: string) => void;
  searchQuery?: string;
  filters?: SearchFilters;
}

export default function ArchiveList({
  onLetterClick,
  searchQuery = "",
  filters = {},
}: ArchiveListProps) {
  const [letters, setLetters] = useState<ArchiveShelfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Fetch letters from API
  useEffect(() => {
    async function fetchLetters() {
      setLoading(true);
      setError(null);
      try {
        const response = await getArchiveShelfItems({ limit: 100 });
        setLetters(response.letters);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load letters");
        console.error("Failed to fetch letters:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLetters();
  }, []);

  const filteredLetters = useMemo(() => {
    let results = letters;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      results = results.filter((letter) => {
        return letter.searchText.toLowerCase().includes(query);
      });
    }

    // Filter by date range
    if (filters.dateRange?.start || filters.dateRange?.end) {
      results = results.filter((letter) => {
        const dateStr = letter.date;
        if (!dateStr) return false;

        const yearMatch = dateStr.match(/\b(\d{4})\b/);
        if (!yearMatch) return false;

        const year = parseInt(yearMatch[1]);
        const { start, end } = filters.dateRange!;

        if (start && year < start) return false;
        if (end && year > end) return false;

        return true;
      });
    }

    // Filter by location
    if (filters.location) {
      const locationQuery = filters.location.toLowerCase();
      results = results.filter((letter) => {
        const location = letter.location;
        return location && location.toLowerCase().includes(locationQuery);
      });
    }

    // Filter by verification status
    if (filters.verified !== undefined && filters.verified !== null) {
      results = results.filter(
        (letter) => letter.verified === filters.verified
      );
    }

    return results;
  }, [letters, searchQuery, filters]);

  useEffect(() => {
    setVisibleCount(24);
  }, [filteredLetters.length, searchQuery, filters]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || visibleCount >= filteredLetters.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) => Math.min(current + 24, filteredLetters.length));
      },
      {
        rootMargin: "900px 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [filteredLetters.length, visibleCount]);

  const visibleLetters = useMemo(
    () => filteredLetters.slice(0, visibleCount),
    [filteredLetters, visibleCount],
  );

  if (loading) {
    return (
      <div className="archive-section">
        <p className="loading-message">Loading letters...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="archive-section">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  return (
    <div className="archive-section">
      {filteredLetters.length > 0 ? (
        <>
          <p className="results-count">
            {filteredLetters.length}{" "}
            {filteredLetters.length === 1 ? "archive item" : "archive items"} found
          </p>
          <div className="letter-grid">
            {visibleLetters.map((letter) => (
              <LetterCard
                key={letter.id}
                card={letter}
                onClick={onLetterClick}
              />
            ))}
          </div>
          {visibleCount < filteredLetters.length && (
            <div className="archive-load-more-sentinel" ref={loadMoreRef} aria-hidden="true" />
          )}
        </>
      ) : (
        <div className="no-results">
          <p>No archive items found matching your search criteria.</p>
          <p className="no-results-hint">
            Try adjusting your filters or search terms.
          </p>
        </div>
      )}
    </div>
  );
}
