import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import SEO from "../components/SEO";
import { getContentPage } from "../api/client";
import { resolveContentPageContent } from "../content/contentPageConfig";
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

  const resolved = resolveContentPageContent('support', content);
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
          <p className="support-kicker">{resolved.hero_kicker}</p>
          <h1 className="support-headline">{resolved.hero_heading}</h1>
          <p className="support-subtitle">{resolved.hero_subtitle}</p>
        </header>

        {/* Why it matters */}
        <section className="support-section support-section-featured">
          <div className="support-eyebrow">{resolved.featured_eyebrow}</div>
          <blockquote className="support-quote">{resolved.quote_text}</blockquote>
          {resolved.quote_attribution && (
            <p className="support-quote-attribution">- {resolved.quote_attribution}</p>
          )}
          <p>{resolved.impact_intro}</p>
        </section>

        {/* Where support goes */}
        <section className="support-impact">
          <div className="support-eyebrow">{resolved.impact_eyebrow}</div>
          <h2>{resolved.impact_heading}</h2>
          <div className="support-impact-cards">
            <div className="support-impact-card">
              <div className="support-impact-icon">{resolved.impact_card_1_icon}</div>
              <h3>{resolved.impact_card_1_title}</h3>
              <p>{resolved.impact_card_1_text}</p>
            </div>
            <div className="support-impact-card">
              <div className="support-impact-icon">{resolved.impact_card_2_icon}</div>
              <h3>{resolved.impact_card_2_title}</h3>
              <p>{resolved.impact_card_2_text}</p>
            </div>
            <div className="support-impact-card">
              <div className="support-impact-icon">{resolved.impact_card_3_icon}</div>
              <h3>{resolved.impact_card_3_title}</h3>
              <p>{resolved.impact_card_3_text}</p>
            </div>
          </div>
        </section>

        {/* Donation options */}
        <section className="support-options">
          <div className="support-eyebrow">{resolved.give_eyebrow}</div>
          <h2>{resolved.donation_heading}</h2>
          <div className="support-options-cards">
            <div className="support-option-card">
              <div className="support-option-eyebrow">{resolved.option_1_eyebrow}</div>
              <h3>{resolved.option_1_title}</h3>
              <p>{resolved.option_1_text}</p>
              <a
                href={onetimeUrl}
                className="support-action-btn btn-card"
                target={onetimeUrl.startsWith('http') ? '_blank' : undefined}
                rel={onetimeUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                aria-label="Make a one-time donation"
              >
                {resolved.option_1_button_label}
              </a>
            </div>

            <div className="support-option-card">
              <div className="support-option-eyebrow">{resolved.option_2_eyebrow}</div>
              <h3>{resolved.option_2_title}</h3>
              <p>{resolved.option_2_text}</p>
              <a
                href={monthlyUrl}
                className="support-action-btn btn-card"
                target={monthlyUrl.startsWith('http') ? '_blank' : undefined}
                rel={monthlyUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                aria-label="Set up monthly support"
              >
                {resolved.option_2_button_label}
              </a>
            </div>

            <div className="support-option-card">
              <div className="support-option-eyebrow">{resolved.option_3_eyebrow}</div>
              <h3>{resolved.option_3_title}</h3>
              <p>{resolved.option_3_text}</p>
              <a
                href={`mailto:${volunteerEmail}`}
                className="support-action-btn btn-card"
                aria-label="Get in touch about volunteering"
              >
                {resolved.option_3_button_label}
              </a>
            </div>
          </div>
        </section>

        {/* Contact section */}
        <section className="support-contact" id="contact">
          <div className="support-eyebrow">{resolved.contact_eyebrow}</div>
          <h2>{resolved.contact_heading}</h2>
          <p className="support-contact-intro">{resolved.contact_intro}</p>

          <div className="support-contact-primary">
            <div className="support-contact-icon">{'\u2709'}</div>
            <div className="support-contact-main">
              <h3>{resolved.contact_primary_title}</h3>
              <p>{resolved.contact_primary_text}</p>
              <a href={`mailto:${generalEmail}`} className="support-email-btn">
                {generalEmail}
              </a>
            </div>
          </div>

          <div className="support-contact-channels">
            <div className="support-channel-card">
              <div className="support-channel-eyebrow">{resolved.channel_1_eyebrow}</div>
              <h3>{resolved.channel_1_title}</h3>
              <p>{resolved.channel_1_text}</p>
              <a href={`mailto:${contributeEmail}`} className="support-email-btn">
                {contributeEmail}
              </a>
            </div>

            <div className="support-channel-card">
              <div className="support-channel-eyebrow">{resolved.channel_2_eyebrow}</div>
              <h3>{resolved.channel_2_title}</h3>
              <p>{resolved.channel_2_text}</p>
              <a href={`mailto:${researchEmail}`} className="support-email-btn">
                {researchEmail}
              </a>
            </div>

            <div className="support-channel-card">
              <div className="support-channel-eyebrow">{resolved.channel_3_eyebrow}</div>
              <h3>{resolved.channel_3_title}</h3>
              <p>{resolved.channel_3_text}</p>
              <a href={`mailto:${volunteerEmail}`} className="support-email-btn">
                {volunteerEmail}
              </a>
            </div>
          </div>
        </section>

        {/* Thank you */}
        <div className="support-thankyou">
          <div className="support-eyebrow">{resolved.thankyou_eyebrow}</div>
          <p className="support-thankyou-text">{resolved.thankyou_text}</p>
          <div className="support-thankyou-links">
            <Link to="/about" className="btn-card support-thankyou-btn">
              {resolved.thankyou_primary_label}
            </Link>
            <Link to="/collections" className="btn-card support-thankyou-btn">
              {resolved.thankyou_secondary_label}
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
