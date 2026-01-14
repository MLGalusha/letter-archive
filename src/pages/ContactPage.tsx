import Footer from "../components/Footer/Footer";
import "./ContactPage.css";

export default function ContactPage() {
  return (
    <div className="body-layout">
      <div className="contact-page">
        <div className="contact-container">
          <h1>Contact Us</h1>

          <div className="contact-intro card">
            <p>
              We'd love to hear from you! Whether you have letters to contribute, questions about
              our archive, or research inquiries, please reach out.
            </p>
          </div>

          <div className="contact-sections">
            <section className="contact-section card">
              <h2>Contribute Letters</h2>
              <p>
                Do you have historical letters you'd like to preserve? We accept donations and
                provide digitization services for family correspondence. Your letters will be
                carefully catalogued and made available for future generations.
              </p>
              <p className="contact-detail">Email: contribute@letterarchive.org</p>
            </section>

            <section className="contact-section card">
              <h2>Research Inquiries</h2>
              <p>
                Historians, genealogists, and students are welcome to access our archive for
                research purposes. We can help you find letters relevant to your study.
              </p>
              <p className="contact-detail">Email: research@letterarchive.org</p>
            </section>

            <section className="contact-section card">
              <h2>General Questions</h2>
              <p>
                Have questions about our mission, how to use the archive, or anything else?
                We're here to help.
              </p>
              <p className="contact-detail">Email: info@letterarchive.org</p>
            </section>

            <section className="contact-section card">
              <h2>Volunteer</h2>
              <p>
                We're always looking for volunteers to help with transcription, cataloguing,
                and digitization. No experience necessary—just a passion for history and
                preserving stories.
              </p>
              <p className="contact-detail">Email: volunteer@letterarchive.org</p>
            </section>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}