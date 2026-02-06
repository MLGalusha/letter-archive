import { useState, useEffect, useMemo } from "react";
import "./ArchiveList.css";
import LetterCard from "../LetterCard/LetterCard";
import { getPublishedLetters } from "../../api/letters";
import type { Letter } from "../../types/Letter";
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
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch letters from API
  useEffect(() => {
    async function fetchLetters() {
      setLoading(true);
      setError(null);
      try {
        const response = await getPublishedLetters({ limit: 100 });
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
        const searchableText = [
          letter.metadata.sender,
          letter.metadata.recipient,
          letter.metadata.location,
          letter.metadata.description,
          letter.transcript.fullText,
        ]
          .join(" ")
          .toLowerCase();

        return searchableText.includes(query);
      });
    }

    // Filter by date range
    if (filters.dateRange?.start || filters.dateRange?.end) {
      results = results.filter((letter) => {
        const dateStr = letter.metadata.date;
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
        const location = letter.metadata.location;
        return location && location.toLowerCase().includes(locationQuery);
      });
    }

    // Filter by verification status
    if (filters.verified !== undefined && filters.verified !== null) {
      results = results.filter(
        (letter) => letter.metadata.verified === filters.verified
      );
    }

    return results;
  }, [letters, searchQuery, filters]);

  const letterSummaries = useMemo(
    () =>
      filteredLetters.map((letter) => ({
        id: letter.id,
        title: letter.title,
        date: letter.metadata.date,
        location: letter.metadata.location,
        sender: letter.metadata.sender,
        recipient: letter.metadata.recipient,
        hook: letter.metadata.hook,
      })),
    [filteredLetters]
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
      {letterSummaries.length > 0 ? (
        <>
          <p className="results-count">
            {letterSummaries.length}{" "}
            {letterSummaries.length === 1 ? "letter" : "letters"} found
          </p>
          <div className="letter-grid">
            {letterSummaries.map((letter) => (
              <LetterCard
                key={letter.id}
                id={letter.id}
                date={letter.date}
                location={letter.location}
                sender={letter.sender}
                recipient={letter.recipient}
                hook={letter.hook}
                onClick={onLetterClick}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="no-results">
          <p>No letters found matching your search criteria.</p>
          <p className="no-results-hint">
            Try adjusting your filters or search terms.
          </p>
        </div>
      )}
    </div>
  );
}
