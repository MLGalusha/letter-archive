import { splitByPlaceholders, hasPlaceholders } from '../utils/placeholders';
import './PlaceholderText.css';

interface Props {
  text: string;
  className?: string;
}

export default function PlaceholderText({ text, className }: Props) {
  if (!hasPlaceholders(text)) {
    return <span className={className}>{text}</span>;
  }

  const parts = splitByPlaceholders(text);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.type === 'placeholder' ? (
          <span key={i} className="placeholder-chip">{part.value}</span>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </span>
  );
}
