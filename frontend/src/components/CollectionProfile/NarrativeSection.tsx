import ReactMarkdown from 'react-markdown';
import VerificationBadge from './VerificationBadge';
import './CollectionProfile.css';

type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

interface NarrativeSectionProps {
  narrative: string;
  status: ContentStatus;
}

function NarrativeSection({ narrative, status }: NarrativeSectionProps) {
  if (!narrative) return null;

  return (
    <section className="cp-narrative">
      <div className="cp-narrative-header">
        <h2 className="cp-narrative-title">About This Collection</h2>
        <VerificationBadge status={status} />
      </div>
      <div className="cp-narrative-body">
        <ReactMarkdown>{narrative}</ReactMarkdown>
      </div>
    </section>
  );
}

export default NarrativeSection;
