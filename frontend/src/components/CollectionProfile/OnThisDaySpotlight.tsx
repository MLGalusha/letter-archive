import { Link } from 'react-router-dom';

interface OnThisDayEntry {
  letterId: string;
  date: string;
  hook: string | null;
  sender: string | null;
  recipient: string | null;
  yearsAgo: number;
}

interface OnThisDaySpotlightProps {
  entries: OnThisDayEntry[];
}

function OnThisDaySpotlight({ entries }: OnThisDaySpotlightProps) {
  if (entries.length === 0) return null;

  const primary = entries[0];
  const correspondents = [primary.sender, primary.recipient]
    .filter(Boolean)
    .join(' \u2192 ');

  return (
    <section className="cp-on-this-day">
      <p className="cp-on-this-day-kicker">On this day</p>
      <h3 className="cp-on-this-day-headline">
        {primary.yearsAgo} year{primary.yearsAgo !== 1 ? 's' : ''} ago today&hellip;
      </h3>
      {primary.hook && (
        <p className="cp-on-this-day-hook">{primary.hook}</p>
      )}
      {correspondents && (
        <p className="cp-on-this-day-correspondents">{correspondents}</p>
      )}
      <Link to={`/letter/${primary.letterId}`} className="cp-on-this-day-link">
        Read this letter &rarr;
      </Link>
    </section>
  );
}

export default OnThisDaySpotlight;
