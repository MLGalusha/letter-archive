import { Link } from "react-router-dom";
import SEO from "../components/SEO";
import { useSiteSettings } from "../hooks/useSiteSettings";
import Footer from "../components/Footer/Footer";
import "./ContactPage.css";

export default function ContactPage() {
  const settings = useSiteSettings();
  const generalEmail = settings?.contact_general_email || 'info@letterarchive.org';
  const contributeEmail = settings?.contact_contribute_email || 'contribute@letterarchive.org';
  const researchEmail = settings?.contact_research_email || 'research@letterarchive.org';
  const volunteerEmail = settings?.contact_volunteer_email || 'volunteer@letterarchive.org';

  return (
    <div className="body-layout">
      <SEO
        title="Contact"
        description="Get in touch with Letter Archive. Contribute letters, ask research questions, or volunteer to help preserve historical correspondence."
        canonicalUrl="/contact"
      />
      <div className="contact-page">
        {/* Hero */}
        <header className="contact-hero">
          <p className="contact-kicker">Get in Touch</p>
          <h1 className="contact-headline">
            We'd love to hear<br />
            from you
          </h1>
          <p className="contact-subtitle">
            Whether you have letters to contribute, a research question, or just want
            to know more — every message matters to us.
          </p>
        </header>

        {/* Primary contact */}
        <section className="contact-primary">
          <div className="contact-card">
            <div className="contact-card-icon">&#9993;</div>
            <div className="contact-card-body">
              <h2>General Inquiries</h2>
              <p>
                Questions about the archive, how it works, or how to get involved?
                This is the best place to start.
              </p>
              <a href={`mailto:${generalEmail}`} className="contact-email">
                {generalEmail}
              </a>
            </div>
          </div>
        </section>

        {/* Specific channels */}
        <div className="contact-channels">
          <section className="channel-card">
            <div className="channel-eyebrow">Contribute</div>
            <h3>Share your letters</h3>
            <p>
              Old family correspondence, postcards, telegrams — we'll digitize and
              preserve them for future generations. You keep the originals.
            </p>
            <a href={`mailto:${contributeEmail}`} className="contact-email">
              {contributeEmail}
            </a>
          </section>

          <section className="channel-card">
            <div className="channel-eyebrow">Research</div>
            <h3>Academic access</h3>
            <p>
              Historians, genealogists, and students are welcome. We can help locate
              letters relevant to your area of study.
            </p>
            <a href={`mailto:${researchEmail}`} className="contact-email">
              {researchEmail}
            </a>
          </section>

          <section className="channel-card">
            <div className="channel-eyebrow">Volunteer</div>
            <h3>Join the effort</h3>
            <p>
              Help with transcription verification, metadata review, or digitization.
              No experience needed — just curiosity and care.
            </p>
            <a href={`mailto:${volunteerEmail}`} className="contact-email">
              {volunteerEmail}
            </a>
          </section>
        </div>

        {/* Explore prompt */}
        <div className="contact-explore">
          <p className="contact-explore-text">
            Not sure where to start? Browse the archive and see what we do.
          </p>
          <div className="contact-explore-links">
            <Link to="/about" className="btn-card contact-explore-btn">
              About the Project
            </Link>
            <Link to="/collections" className="btn-card contact-explore-btn">
              Browse Collections
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
