import { useState } from 'react';
import type { PublicLetter } from '../../types/Letter';
import { reflowTranscript } from '../../utils/transcriptRendering';
import useIsMobile from '../../hooks/useIsMobile';

type Props = {
  letter: PublicLetter;
};

function ReadingText({ text, saved = false, desktop }: {
  text: string; saved?: boolean; desktop: boolean;
}) {
  const lines = text.split('\n');

  return <div className={`transcript-text${saved ? ' transcript-reading-saved' : ''}`}>
      {desktop ? lines.map((line, index) => {
        const indented = /^\s{3,}\S/.test(line);
        const kind = !line.trim() ? 'blank' : indented ? (line.trim().length < 60 ? 'positioned' : 'indented') : '';
        return <span key={index} className={`transcript-reading-line${kind ? ` transcript-reading-line--${kind}` : ''}`}>
          {line}{index < lines.length - 1 ? '\n' : ''}
        </span>;
      }) : text}
  </div>;
}

/** Published wording owns reading order; the gallery owns scan viewing. */
export default function ReaderTranscript({ letter }: Props) {
  const [original, setOriginal] = useState(false);
  const desktop = !useIsMobile(900);
  const pages = letter.transcript.pages;
  const hasOriginal = !!letter.transcript.fullText.trim() || pages.some(page => page.text.trim());
  return (
    <section id="letter-transcript" tabIndex={-1} className="letter-transcript-section" aria-labelledby="transcript-heading">
      <div className="transcript-header-row">
        <h2 id="transcript-heading" className="transcript-label">Transcript</h2>
        <span className="transcript-status" data-verified={letter.transcriptStatus === 'VERIFIED'}>{letter.transcriptStatus === 'VERIFIED' ? 'Verified' : 'Unverified'}</span>
        {hasOriginal && <button type="button" className="transcript-mode-toggle" aria-pressed={original}
          onClick={() => setOriginal(value => !value)}>
          {original ? 'Reading view' : 'Original formatting'}
        </button>}
      </div>
      {!original && letter.readingText?.trim() ? (
        <ReadingText text={letter.readingText} saved desktop={desktop} />
      ) : pages.length ? pages.map(page => {
        return <div className="transcript-page-region" key={page.pageNumber}>
          {pages.length > 1 && <div className="transcript-page-heading">
            <span>Page {page.pageNumber}</span>
          </div>}
          {original ? <div className="transcript-text transcript-original">{page.text}</div>
            : <ReadingText text={reflowTranscript(page.text)} desktop={desktop} />}
        </div>;
      }) : original ? <div className="transcript-text transcript-original">{letter.transcript.fullText}</div>
        : <ReadingText text={reflowTranscript(letter.transcript.fullText)} desktop={desktop} />}
    </section>
  );
}
