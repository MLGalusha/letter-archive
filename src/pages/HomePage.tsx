import { useState } from "react";
import { useNavigate } from "react-router-dom";
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