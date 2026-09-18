import { useState } from 'react';
import type { PublicLetter } from '../../types/Letter';
import { reflowTranscript } from '../../utils/transcriptRendering';

type Props = {
  letter: PublicLetter;
  onViewSource: (index: number, opener: HTMLElement) => void;
};

/** Published wording owns reading order. Source links never imply paragraph alignment. */
export default function ReaderTranscript({ letter, onViewSource }: Props) {
  const [original, setOriginal] = useState(false);
  const pages = letter.transcript.pages;
  const hasOriginal = !!letter.transcript.fullText.trim() || pages.some(page => page.text.trim());
  return (
    <section id="letter-transcript" tabIndex={-1} className="letter-transcript-section" aria-labelledby="transcript-heading">
      <div className="transcript-header-row">
        <h2 id="transcript-heading" className="transcript-label">Transcript</h2>
        <span className="transcript-status">{letter.transcriptStatus === 'VERIFIED' ? 'Verified' : 'Unverified'}</span>
        {hasOriginal && <button type="button" className="transcript-mode-toggle" aria-pressed={original}
          onClick={() => setOriginal(value => !value)}>
          {original ? 'Reading view' : 'Original formatting'}
        </button>}
      </div>
      {!original && letter.readingText ? (
        <div className="transcript-text transcript-reading-saved">{letter.readingText}</div>
      ) : pages.length ? pages.map(page => {
        const imageIndex = letter.images.findIndex(image => image.type === 'letter' && image.pageNumber === page.pageNumber);
        return <div className="transcript-page-region" key={page.pageNumber}>
          {pages.length > 1 && <div className="transcript-page-heading">
            <span>Page {page.pageNumber}</span>
            {imageIndex >= 0 && <button type="button" className="reader-source-link"
              onClick={event => onViewSource(imageIndex, event.currentTarget)}
              aria-label={`View page ${page.pageNumber} on scan`}>View on scan ↗</button>}
          </div>}
          <div className={`transcript-text${original ? ' transcript-original' : ''}`}>
            {original ? page.text : reflowTranscript(page.text)}
          </div>
        </div>;
      }) : <div className={`transcript-text${original ? ' transcript-original' : ''}`}>
        {original ? letter.transcript.fullText : reflowTranscript(letter.transcript.fullText)}
      </div>}
    </section>
  );
}
