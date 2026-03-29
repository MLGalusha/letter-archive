import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { listCollections, type CollectionInfo } from '../api/collections';
import { getContentPage } from '../api/client';
import { resolveContentPageContent } from '../content/contentPageConfig';
import Footer from '../components/Footer/Footer';
import { useAsync } from '../hooks/useAsync';
import './AboutPage.css';

function renderParagraphs(value: string) {
  return value.split('\n\n').map((paragraph, index) => (
    <span key={`${paragraph.slice(0, 12)}-${index}`}>
      {index > 0 && (
        <>
          <br />
          <br />
        </>
      )}
      {paragraph}
    </span>
  ));
}

export default function AboutPage() {
  const { data } = useAsync(async () => {
    const [collectionsResult, contentResult] = await Promise.allSettled([
      listCollections(),
      getContentPage('about'),
    ]);

    let stats: { collections: number; letters: number } | null = null;
    if (collectionsResult.status === 'fulfilled') {
      const collections = collectionsResult.value as CollectionInfo[];
      const visible = collections.filter((collection) => (collection.letterCount || 0) > 0);
      const letters = visible.reduce((sum, collection) => sum + (collection.letterCount || 0), 0);
      stats = { collections: visible.length, letters };
    }

    let content: Record<string, string> | null = null;
    if (contentResult.status === 'fulfilled' && contentResult.value) {
      content = contentResult.value.contentJson;
    }

    return { stats, content };
  }, []);

  const stats = data?.stats ?? null;
  const resolved = resolveContentPageContent('about', data?.content);
  const secondaryCtaLabel = /explore/i.test(resolved.cta_secondary_label)
    ? 'Read the Journal'
    : resolved.cta_secondary_label;

  return (
    <div className="body-layout">
      <SEO
        title="About"
        description="Learn about Letter Archive -- a project to digitize, transcribe, and preserve personal letters and historical correspondence for future generations."
        canonicalUrl="/about"
      />
      <div className="about-page">
        {/* Hero */}
        <header className="about-hero">
          <p className="about-kicker">{resolved.hero_kicker}</p>
          <h1 className="about-headline">{resolved.hero_heading}</h1>
          <p className="about-subtitle">{resolved.hero_subtitle}</p>
        </header>

        {/* Stats */}
        {stats && (
          <div className="about-stats">
            <div className="stat-item">
              <span className="stat-number">{stats.letters.toLocaleString()}</span>
              <span className="stat-label">{resolved.stats_letters_label}</span>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-number">{stats.collections}</span>
              <span className="stat-label">{resolved.stats_collections_label}</span>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-number">{resolved.stats_years_value}</span>
              <span className="stat-label">{resolved.stats_years_label}</span>
            </div>
          </div>
        )}

        {/* Why it matters */}
        <section className="about-section about-section-featured">
          <div className="section-eyebrow">{resolved.why_eyebrow}</div>
          <blockquote className="about-quote">{resolved.quote_text}</blockquote>
          {resolved.quote_attribution && (
            <p className="about-quote-attribution">— {resolved.quote_attribution}</p>
          )}
          <p>{resolved.why_matters_text}</p>
        </section>

        {/* Process */}
        <section className="about-process">
          <div className="section-eyebrow">{resolved.process_eyebrow}</div>
          <h2>{resolved.process_heading}</h2>
          <div className="process-steps">
            <div className="process-step">
              <div className="step-number">01</div>
              <h3>{resolved.process_step_1_title}</h3>
              <p>{resolved.process_step_1_text}</p>
            </div>
            <div className="process-step">
              <div className="step-number">02</div>
              <h3>{resolved.process_step_2_title}</h3>
              <p>{resolved.process_step_2_text}</p>
            </div>
            <div className="process-step">
              <div className="step-number">03</div>
              <h3>{resolved.process_step_3_title}</h3>
              <p>{resolved.process_step_3_text}</p>
            </div>
            <div className="process-step">
              <div className="step-number">04</div>
              <h3>{resolved.process_step_4_title}</h3>
              <p>{resolved.process_step_4_text}</p>
            </div>
          </div>
        </section>

        {/* Two-column: Contribute + Researchers */}
        <div className="about-two-col">
          <section className="about-section">
            <div className="section-eyebrow">{resolved.contribute_eyebrow}</div>
            <h2>{resolved.contribute_heading}</h2>
            <p>{renderParagraphs(resolved.contribute_text)}</p>
            <Link to="/support#contact" className="about-link">
              {resolved.contribute_link_label} &rarr;
            </Link>
          </section>

          <section className="about-section">
            <div className="section-eyebrow">{resolved.research_eyebrow}</div>
            <h2>{resolved.research_heading}</h2>
            <p>{renderParagraphs(resolved.research_text)}</p>
            <Link to="/collections" className="about-link">
              {resolved.research_link_label} &rarr;
            </Link>
          </section>
        </div>

        {/* CTA */}
        <div className="about-cta">
          <p className="cta-text">{resolved.cta_text}</p>
          <div className="cta-buttons">
            <Link to="/collections" className="btn-card cta-btn">
              {resolved.cta_primary_label}
            </Link>
            <Link to="/blog" className="btn-card cta-btn">
              {secondaryCtaLabel}
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
