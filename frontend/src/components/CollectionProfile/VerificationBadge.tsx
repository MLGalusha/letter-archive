type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

interface VerificationBadgeProps {
  status: ContentStatus;
}

function VerificationBadge({ status }: VerificationBadgeProps) {
  if (status === 'EMPTY') return null;

  if (status === 'AI_DRAFT') {
    return (
      <span className="cp-badge cp-badge--ai-draft">AI-generated profile</span>
    );
  }

  if (status === 'EDITED') {
    return (
      <span className="cp-badge cp-badge--edited">Curated profile</span>
    );
  }

  return (
    <span className="cp-badge cp-badge--verified">
      <span className="cp-badge-check" aria-hidden="true">&#10003;</span>
      Verified profile
    </span>
  );
}

export default VerificationBadge;
