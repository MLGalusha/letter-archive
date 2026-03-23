import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar, { type SearchFilters } from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";

export default function HomePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});

  const handleLetterClick = (letterId: string) => {
    navigate(`/letter/${letterId}`);
  };

  const handleSearch = (query: string, newFilters: SearchFilters) => {
    setSearchQuery(query);
    setFilters(newFilters);
  };

  return (
    <div className="body-layout">
      <SEO
        title="Preserving Personal Correspondence"
        description="A digital archive preserving personal letters and historical correspondence. Browse, search, and explore letters from across generations."
        canonicalUrl="/"
      />
      <SearchBar onSearch={handleSearch} />
      <ArchiveList
        onLetterClick={handleLetterClick}
        searchQuery={searchQuery}
        filters={filters}
      />
      <Footer />
    </div>
  );
}