import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar, { type SearchFilters } from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";
import {
  getFeaturedLetter,
  listBlogPosts,
  type FeaturedLetter,
  type BlogPost,
} from "../api/client";
import { buildHomeSeo } from "../utils/seo";
import "./HomePage.css";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function HomePage() {
  const homeSeo = buildHomeSeo();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [featuredLetter, setFeaturedLetter] = useState<FeaturedLetter | null>(null);
  const [latestBlogPost, setLatestBlogPost] = useState<BlogPost | null>(null);

  useEffect(() => {
    getFeaturedLetter()
      .then((data) => setFeaturedLetter(data))
      .catch(() => {});

    listBlogPosts({ limit: 1 })
      .then((data) => {
        if (data.posts.length > 0) setLatestBlogPost(data.posts[0]);
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
    <div className="body-layout home-page">
      <SEO
        title={homeSeo.title}
        description={homeSeo.description}
        canonicalUrl={homeSeo.canonicalPath}
        jsonLd={homeSeo.jsonLd}
      />
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker">A Reading Room For Correspondence</p>
          <h1 className="home-headline">
            Letters, collections, and project notes arranged like an editorial archive.
          </h1>
          <p className="home-subtitle">
            Search real letters written by real people, then follow the thread through
            collections, places, and the stories that surfaced while preserving them.
          </p>
          <div className="home-hero-actions">
            <Link to="/collections" className="btn-card">
              Browse Collections
            </Link>
            <Link to="/blog" className="home-text-link">
              Read the Journal &rarr;
            </Link>
          </div>
        </div>
        <div className="home-hero-notes">
          <div className="home-note-card">
            <span className="home-note-label">Archive Focus</span>
            <p>
              Personal correspondence, family histories, wartime exchanges, and the
              smaller daily details that rarely survive outside the page.
            </p>
          </div>
          <div className="home-note-card home-note-card-accent">
            <span className="home-note-label">What You Can Do Here</span>
            <p>
              Search by person, place, date, or phrase. Then move into the original
              scans, transcripts, and collection context without losing your place.
            </p>
          </div>
        </div>
      </section>

      <section className="home-discovery-grid">
        <div className="home-search-panel">
          <SearchBar onSearch={handleSearch} />
        </div>
        <div className="home-story-column">
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
                <Link to={`/letter/${featuredLetter.id}`} className="featured-letter-link">
                  Read this letter &rarr;
                </Link>
              </div>
            </section>
          )}

          {latestBlogPost && (
            <section className="home-latest-update">
              <div className="section-eyebrow">Latest From the Blog</div>
              <Link to={`/blog/${latestBlogPost.slug}`} className="latest-update-card">
                <div className="latest-update-content">
                  <h3 className="latest-update-title">{latestBlogPost.title}</h3>
                  {latestBlogPost.excerpt && (
                    <p className="latest-update-excerpt">{latestBlogPost.excerpt}</p>
                  )}
                  <div className="latest-update-footer">
                    <span className="latest-update-date">
                      {formatDate(latestBlogPost.publishedAt || latestBlogPost.createdAt)}
                    </span>
                    <span className="latest-update-cta">Read more &rarr;</span>
                  </div>
                </div>
              </Link>
            </section>
          )}
        </div>
      </section>

      <section className="home-archive-stage">
        <div className="home-stage-header">
          <div>
            <p className="section-eyebrow">Archive Shelf</p>
            <h2 className="home-stage-title">Start with a letter and keep following the trail.</h2>
          </div>
          <p className="home-stage-copy">
            Search results stay readable, fast to skim, and grounded in the hook, date,
            and correspondents that matter most.
          </p>
        </div>
        <ArchiveList
          onLetterClick={handleLetterClick}
          searchQuery={searchQuery}
          filters={filters}
        />
      </section>

      <Footer />
    </div>
  );
}
