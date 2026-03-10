import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { listCollections, type CollectionInfo } from "../api/collections";
import Footer from "../components/Footer/Footer";
import "./AboutPage.css";

export default function AboutPage() {
  const [stats, setStats] = useState<{ collections: number; letters: number } | null>(null);

  useEffect(() => {
    listCollections()
      .then((data: CollectionInfo[]) => {
        const visible = data.filter((c) => (c.letterCount || 0) > 0);
        const letters = visible.reduce((sum, c) => sum + (c.letterCount || 0), 0);
        setStats({ collections: visible.length, letters });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="body-layout">
      <div className="about-page">
        {/* Hero */}
        <header className="about-hero">
          <p className="about-kicker">About the Archive</p>
          <h1 className="about-headline">
            Every letter is a conversation<br />
            across time
          </h1>
          <p className="about-subtitle">
            We preserve personal letters — the kind written at kitchen tables, in hospital
            wards, on trains between cities — so the voices inside them are never lost.
          </p>
        </header>

        {/* Stats */}
        {stats && (
          <div className="about-stats">
            <div className="stat-item">
              <span className="stat-number">{stats.letters.toLocaleString()}</span>
              <span className="stat-label">Letters preserved</span>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-number">{stats.collections}</span>
              <span className="stat-label">Collections</span>
            </div>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-number">100+</span>
              <span className="stat-label">Years of history</span>
            </div>
          </div>
        )}

        {/* Why it matters */}
        <section className="about-section about-section-featured">
          <div className="section-eyebrow">Why letters matter</div>
          <blockquote className="about-quote">
            History books record the decisions of generals and presidents. Personal letters
            record everything else — the price of bread, the ache of distance, the small
            joys that never made the newspapers.
          </blockquote>
          <p>
            These documents are fragile. Paper yellows, ink fades, and families move on. Every
            year, irreplaceable correspondence is lost to attics, floods, and estate sales.
            Letter Archive exists to intervene — to digitize, transcribe, and share these
            fragments before they disappear.
          </p>
        </section>

        {/* Process */}
        <section className="about-process">
          <div className="section-eyebrow">How it works</div>
          <h2>From shoebox to searchable archive</h2>
          <div className="process-steps">
            <div className="process-step">
              <div className="step-number">01</div>
              <h3>Digitize</h3>
              <p>
                Letters are carefully photographed at high resolution, preserving every
                crease, stain, and margin note.
              </p>
            </div>
            <div className="process-step">
              <div className="step-number">02</div>
              <h3>Transcribe</h3>
              <p>
                AI-assisted transcription converts handwriting to searchable text, then
                human reviewers verify accuracy.
              </p>
            </div>
            <div className="process-step">
              <div className="step-number">03</div>
              <h3>Contextualize</h3>
              <p>
                Each letter is annotated with dates, locations, people, and topics —
                connecting it to the broader historical record.
              </p>
            </div>
            <div className="process-step">
              <div className="step-number">04</div>
              <h3>Publish</h3>
              <p>
                Verified letters are published to the open archive where anyone can
                read, search, and explore the connections between them.
              </p>
            </div>
          </div>
        </section>

        {/* Two-column: Contribute + Researchers */}
        <div className="about-two-col">
          <section className="about-section">
            <div className="section-eyebrow">Contribute</div>
            <h2>Your letters have a story</h2>
            <p>
              Old family correspondence gathering dust in a drawer? A bundle of postcards from
              a relative you never met? We can help preserve them — digitized, transcribed, and
              made available to future generations.
            </p>
            <p>
              Every contribution enriches the archive and helps paint a fuller picture of
              everyday life across generations.
            </p>
            <Link to="/contact" className="about-link">
              Get in touch &rarr;
            </Link>
          </section>

          <section className="about-section">
            <div className="section-eyebrow">Research</div>
            <h2>A primary source collection</h2>
            <p>
              Historians, genealogists, and students will find rich material here — patterns in
              migration, economic hardship, family dynamics, and cultural change, told through
              the words of the people who lived it.
            </p>
            <p>
              The archive is fully searchable by date, location, person, topic, and full-text
              content. We welcome academic inquiries and collaborations.
            </p>
            <Link to="/collections" className="about-link">
              Browse collections &rarr;
            </Link>
          </section>
        </div>

        {/* CTA */}
        <div className="about-cta">
          <p className="cta-text">
            Start exploring — read the letters, follow the people, trace the places.
          </p>
          <div className="cta-buttons">
            <Link to="/collections" className="btn-card cta-btn">
              Browse Collections
            </Link>
            <Link to="/explore" className="btn-card cta-btn">
              Explore the Graph
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
