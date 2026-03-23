import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar, { type SearchFilters } from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";
import {
  getFeaturedLetter,
  listUpdates,
  type FeaturedLetter,
  type UpdatePost,
} from "../api/client";
import "./HomePage.css";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [featuredLetter, setFeaturedLetter] = useState<FeaturedLetter | null>(null);
  const [latestUpdate, setLatestUpdate] = useState<UpdatePost | null>(null);

  useEffect(() => {
    getFeaturedLetter()
      .then((data) => setFeaturedLetter(data))
      .catch(() => {});

    listUpdates({ limit: 1 })
      .then((data) => {
        if (data.updates.length > 0) setLatestUpdate(data.updates[0]);
      })
      .catch(() => {});
  }, []);

  const handleLetterClick = (letterId: string) => {
    navigate(`/letter/${letterId}`);
  };

  const handleSearch = (query: string, newFilters: SearchFilters) => {
    setSearchQuery(query);
    setFilters(newFilters);
  };

  const letterPeople =
    featuredLetter?.sender && featuredLetter?.recipient
      ? `${featuredLetter.sender} to ${featuredLetter.recipient}`
      : featuredLetter?.sender || featuredLetter?.recipient || null;

  return (
    <div className="body-layout">
      <SEO
        title="Preserving Personal Correspondence"
        description="A digital archive preserving personal letters and historical correspondence. Browse, search, and explore letters from across generations."
        canonicalUrl="/"
      />
      <SearchBar onSearch={handleSearch} />

      {featuredLetter && (
        <section className="home-featured-letter">
          <div className="section-eyebrow">Featured Letter</div>
          <div className="featured-letter-card">
            {featuredLetter.hook && (
              <p className="featured-letter-hook">&ldquo;{featuredLetter.hook}&rdquo;</p>
            )}
            {featuredLetter.summary && (
              <p className="featured-letter-summary">{featuredLetter.summary}</p>
            )}
            <div className="featured-letter-meta">
              {letterPeople && <span className="featured-letter-people">{letterPeople}</span>}
              {featuredLetter.letterDate && (
                <span className="featured-letter-date">{featuredLetter.letterDate}</span>
              )}
              {featuredLetter.collectionTitle && (
                <span className="featured-letter-collection">
                  {featuredLetter.collectionTitle}
                </span>
              )}
            </div>
            <Link
              to={`/letter/${featuredLetter.id}`}
              className="featured-letter-link"
            >
              Read this letter &rarr;
            </Link>
          </div>
        </section>
      )}

      <ArchiveList
        onLetterClick={handleLetterClick}
        searchQuery={searchQuery}
        filters={filters}
      />

      {latestUpdate && (
        <section className="home-latest-update">
          <div className="section-eyebrow">Latest Update</div>
          <div
            className="latest-update-card"
            onClick={() => navigate(`/updates/${latestUpdate.slug}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(`/updates/${latestUpdate.slug}`);
              }
            }}
          >
            <div className="latest-update-content">
              <h3 className="latest-update-title">{latestUpdate.title}</h3>
              {latestUpdate.excerpt && (
                <p className="latest-update-excerpt">{latestUpdate.excerpt}</p>
              )}
              <div className="latest-update-footer">
                <span className="latest-update-date">
                  {formatDate(latestUpdate.publishedAt || latestUpdate.createdAt)}
                </span>
                <span className="latest-update-cta">Read more &rarr;</span>
              </div>
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}
