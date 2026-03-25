import { Link } from 'react-router-dom';

interface StartHereCardProps {
  letterId: string;
  reason: string;
  hook: string | null;
  date: string | null;
}

function StartHereCard({ letterId, reason, hook, date }: StartHereCardProps) {
  return (
    <Link to={`/letter/${letterId}`} className="cp-start-here">
      <p className="cp-start-here-kicker">Start here</p>
      {hook && <h3 className="cp-start-here-hook">{hook}</h3>}
      {date && <p className="cp-start-here-date">{date}</p>}
      <p className="cp-start-here-reason">{reason}</p>
      <span className="cp-start-here-arrow">Read this letter &rarr;</span>
    </Link>
  );
}

export default StartHereCard;
