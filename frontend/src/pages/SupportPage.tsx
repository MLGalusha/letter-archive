import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import SEO from "../components/SEO";
import { getContentPage } from "../api/client";
import { useSiteSettings } from "../hooks/useSiteSettings";
import Footer from "../components/Footer/Footer";
import "./SupportPage.css";

export default function SupportPage() {
  const settings = useSiteSettings();
  const [content, setContent] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    getContentPage('support')
      .then((page) => { if (page) setContent(page.contentJson); })
      .catch(() => {});
  }, []);

  const get = (key: string, fallback: string) => content?.[key] || fallback;
  const onetimeUrl = settings?.donate_onetime_url || '#donate-once';
  const monthlyUrl = settings?.donate_monthly_url || '#donate-monthly';
  const generalEmail = settings?.contact_general_email || 'info@letterarchive.org';
  const contributeEmail = settings?.contact_contribute_email || 'contribute@letterarchive.org';
  const researchEmail = settings?.contact_research_email || 'research@letterarchive.org';
  const volunteerEmail = settings?.contact_volunteer_email || 'volunteer@letterarchive.org';

  return (
    <div className="body-layout">
      <SEO
        title="Support & Contact"
        description="Help preserve personal letters and historical correspondence. Your support funds digitization, preservation, and public access to the Letter Archive. Get in touch to contribute, research, or volunteer."
        canonicalUrl="/support"
      />
      <div className="support-page">
        {/* Hero */}
        <header className="support-hero">
          <p className="support-kicker">{get('hero_kicker', 'Support & Contact')}</p>
          <h1 className="support-headline">
            {get('hero_heading', 'Help us keep these voices alive')}
          </h1>
          <p className="support-subtitle">
            {get('hero_subtitle', 'Preserving handwritten letters takes real resources — scanning equipment, archival storage, hosting, and countless hours of careful work. Your generosity makes it possible to keep this history accessible to everyone.')}
          </p>
        </header>

        {/* Why it matters */}
        <section className="support-section support-section-featured">
          <div className="support-eyebrow">Why your support matters</div>
          <blockquote className="support-quote">
            {get('quote_text', 'Every letter in this archive was written by someone who trusted that their words would reach the people they loved. Keeping these letters alive is a way of honoring that trust — across decades, across generations.')}
          </blockquote>
          {get('quote_attribution', '') && (
            <p className="support-quote-attribution">— {content!.quote_attribution}</p>
          )}
          <p>
            {get('impact_intro', 'Letter Archive is a passion project born from one family\'s collection and grown into something bigger. There are no corporate sponsors, no institutional grants — just people who believe these voices deserve to be heard. Your support, in any form, keeps the lights on and the scanners running.')}
          </p>
        </section>

        {/* Where support goes */}
        <section className="support-impact">
          <div className="support-eyebrow">Where Your Support Goes</div>
          <h2>Every contribution makes a difference</h2>
          <div className="support-impact-cards">
            <div className="support-impact-card">
              <div className="support-impact-icon">&#128247;</div>
              <h3>Digitization</h3>
              <p>
                High-resolution scanning equipment and supplies to carefully capture
                every crease, margin note, and faded line of ink before time takes
                its toll.
              </p>
            </div>
            <div className="support-impact-card">
              <div className="support-impact-icon">&#128451;</div>
              <h3>Preservation &amp; Storage</h3>
              <p>
                Archival-quality materials for physical storage, plus secure cloud
                infrastructure to safeguard digital copies for decades to come.
              </p>
            </div>
            <div className="support-impact-card">
              <div className="support-impact-icon">&#127760;</div>
              <h3>Public Access</h3>
              <p>
                Server hosting, bandwidth, and ongoing development to keep the
                archive free and searchable for researchers, families, and the
                curious alike.
              </p>
            </div>
          </div>
        </section>

        {/* Donation options */}
        <section className="support-options">
          <div className="support-eyebrow">Ways to Give</div>
          <h2>{get('donation_heading', "Choose how you'd like to help")}</h2>
          <div className="support-options-cards">
            <div className="support-option-card">
              <div className="support-option-eyebrow">One-Time</div>
              <h3>Make a donation</h3>
              <p>
                A single contribution of any amount goes directly toward preserving
                and sharing these letters. No amount is too small — every dollar
                helps digitize another page of history.
              </p>
              <a
                href={onetimeUrl}
                className="support-action-btn btn-card"
                target={onetimeUrl.startsWith('http') ? '_blank' : undefined}
                rel={onetimeUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                aria-label="Make a one-time donation"
              >
                Donate Once
              </a>
            </div>

            <div className="support-option-card">
              <div className="support-option-eyebrow">Monthly</div>
              <h3>Become a sustainer</h3>
              <p>
                Ongoing support provides the steady foundation this project needs.
                Monthly sustainers help us plan ahead, invest in better equipment,
                and expand the collection with confidence.
              </p>
              <a
                href={monthlyUrl}
                className="support-action-btn btn-card"
                target={monthlyUrl.startsWith('http') ? '_blank' : undefined}
                rel={monthlyUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                aria-label="Set up monthly support"
              >
                Support Monthly
              </a>
            </div>

            <div className="support-option-card">
              <div className="support-option-eyebrow">Non-Monetary</div>
              <h3>Other ways to help</h3>
              <p>
                Not everyone can give financially, and that's perfectly okay. You can
                volunteer your time, contribute letters from your own family, or
                simply share the archive with someone who'd appreciate it.
              </p>
              <a
                href={`mailto:${volunteerEmail}`}
                className="support-action-btn btn-card"
                aria-label="Get in touch about volunteering"
              >
                Get in Touch
              </a>
            </div>
          </div>
        </section>

        {/* Contact section */}
        <section className="support-contact" id="contact">
          <div className="support-eyebrow">Get in Touch</div>
          <h2>{get('contact_heading', "We'd love to hear from you")}</h2>
          <p className="support-contact-intro">
            {get('contact_intro', 'Whether you have letters to contribute, a research question, or just want to know more — every message matters to us.')}
          </p>

          <div className="support-contact-primary">
            <div className="support-contact-icon">&#9993;</div>
            <div className="support-contact-main">
              <h3>General Inquiries</h3>
              <p>
                Questions about the archive, how it works, or how to get involved?
                This is the best place to start.
              </p>
              <a href={`mailto:${generalEmail}`} className="support-email-btn">
                {generalEmail}
              </a>
            </div>
          </div>

          <div className="support-contact-channels">
            <div className="support-channel-card">
              <div className="support-channel-eyebrow">Contribute</div>
              <h3>Share your letters</h3>
              <p>
                Old family correspondence, postcards, telegrams — we'll digitize and
                preserve them for future generations. You keep the originals.
              </p>
              <a href={`mailto:${contributeEmail}`} className="support-email-btn">
                {contributeEmail}
              </a>
            </div>

            <div className="support-channel-card">
              <div className="support-channel-eyebrow">Research</div>
              <h3>Academic access</h3>
              <p>
                Historians, genealogists, and students are welcome. We can help locate
                letters relevant to your area of study.
              </p>
              <a href={`mailto:${researchEmail}`} className="support-email-btn">
                {researchEmail}
              </a>
            </div>

            <div className="support-channel-card">
              <div className="support-channel-eyebrow">Volunteer</div>
              <h3>Join the effort</h3>
              <p>
                Help with transcription verification, metadata review, or digitization.
                No experience needed — just curiosity and care.
              </p>
              <a href={`mailto:${volunteerEmail}`} className="support-email-btn">
                {volunteerEmail}
              </a>
            </div>
          </div>
        </section>

        {/* Thank you */}
        <div className="support-thankyou">
          <div className="support-eyebrow">Thank You</div>
          <p className="support-thankyou-text">
            {get('thankyou_text', 'Whether you give a dollar, an hour, or a letter — you become part of the story. This archive exists because of people who care about preserving the quiet, honest words of everyday life. From our family to yours, thank you.')}
          </p>
          <div className="support-thankyou-links">
            <Link to="/about" className="btn-card support-thankyou-btn">
              About the Project
            </Link>
            <Link to="/collections" className="btn-card support-thankyou-btn">
              Browse the Archive
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
