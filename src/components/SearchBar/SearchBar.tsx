import { useState } from "react";
import "./SearchBar.css";

interface SearchBarProps {
  onSearch: (query: string, filters: SearchFilters) => void;
}

export interface SearchFilters {
  dateRange?: { start?: number; end?: number };
  location?: string;
  verified?: boolean | null;
}

export default function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [location, setLocation] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState<boolean | null>(null);

  const handleSearch = () => {
    const filters: SearchFilters = {};

    if (startYear || endYear) {
      filters.dateRange = {
        start: startYear ? parseInt(startYear) : undefined,
        end: endYear ? parseInt(endYear) : undefined,
      };
    }

    if (location) {
      filters.location = location;
    }

    if (verifiedOnly !== null) {
      filters.verified = verifiedOnly;
    }

    onSearch(query, filters);
  };

  const handleClearFilters = () => {
    setStartYear("");
    setEndYear("");
    setLocation("");
    setVerifiedOnly(null);
    setQuery("");
    onSearch("", {});
  };

  const hasActiveFilters = startYear || endYear || location || verifiedOnly !== null || query;

  return (
    <div className="search">
      <h1 className="search-title">Search the Archive</h1>
      <p className="search-description">
        Search real letters written by real people. Discover names, places, and
        stories that history books never recorded.
      </p>

      <div className="search-input-wrapper">
        <input
          type="text"
          className="search-input"
          placeholder="Search by names, places, or keywords..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button className="search-button" onClick={handleSearch}>
          Search
        </button>
      </div>

      <div className="search-controls">
        <button
          className="filter-toggle"
          onClick={() => setShowFilters(!showFilters)}
        >
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
        {hasActiveFilters && (
          <button className="clear-filters" onClick={handleClearFilters}>
            Clear All
          </button>
        )}
      </div>

      {showFilters && (
        <div className="filters">
          <div className="filter-group">
            <label className="filter-label">Date Range</label>
            <div className="date-range">
              <input
                type="number"
                className="filter-input"
                placeholder="Start year (e.g., 1890)"
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                min="1800"
                max="2000"
              />
              <span className="date-separator">to</span>
              <input
                type="number"
                className="filter-input"
                placeholder="End year (e.g., 1950)"
                value={endYear}
                onChange={(e) => setEndYear(e.target.value)}
                min="1800"
                max="2000"
              />
            </div>
          </div>

          <div className="filter-group">
            <label className="filter-label">Location</label>
            <input
              type="text"
              className="filter-input"
              placeholder="City or state (e.g., Pennsylvania)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">Verification Status</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="verified"
                  checked={verifiedOnly === null}
                  onChange={() => setVerifiedOnly(null)}
                />
                All Letters
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="verified"
                  checked={verifiedOnly === true}
                  onChange={() => setVerifiedOnly(true)}
                />
                Verified Only
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="verified"
                  checked={verifiedOnly === false}
                  onChange={() => setVerifiedOnly(false)}
                />
                Unverified Only
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
