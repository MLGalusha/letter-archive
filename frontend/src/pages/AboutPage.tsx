import Footer from "../components/Footer/Footer";
import "./AboutPage.css";

export default function AboutPage() {
  return (
    <div className="body-layout">
      <div className="about-page">
        <div className="about-container">
          <h1>About Letter Archive</h1>

          <section className="about-section">
            <h2>Our Mission</h2>
            <p>
              Letter Archive is dedicated to preserving and sharing personal letters from history.
              These intimate documents reveal the everyday lives, struggles, and hopes of ordinary
              people whose stories might otherwise be lost to time.
            </p>
          </section>

          <section className="about-section">
            <h2>Why Letters Matter</h2>
            <p>
              History books tell us about wars, politics, and famous figures. But personal letters
              give us something more precious: a window into the hearts and minds of real people
              facing real challenges. From farmers worried about crop prices to factory workers
              dealing with injuries, from families separated by distance to individuals seeking
              opportunity—these letters capture authentic human experience.
            </p>
          </section>

          <section className="about-section">
            <h2>What We Do</h2>
            <p>
              We collect, digitize, and transcribe historical letters to make them accessible to
              everyone. Each letter is carefully preserved and verified to maintain historical
              accuracy. Our archive includes letters spanning multiple generations, offering insights
              into how everyday life has changed—and how it has stayed the same.
            </p>
          </section>

          <section className="about-section">
            <h2>Contribute</h2>
            <p>
              Do you have old family letters gathering dust in an attic or drawer? We'd love to
              help preserve them. Your family's correspondence could provide invaluable insights
              for future researchers and descendants. Contact us to learn more about contributing
              to the archive.
            </p>
          </section>

          <section className="about-section">
            <h2>For Researchers</h2>
            <p>
              Our archive is a valuable resource for historians, genealogists, students, and anyone
              interested in social history. Letters can reveal patterns in migration, economic
              hardship, family dynamics, and cultural change. We welcome academic inquiries and
              research collaborations.
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}