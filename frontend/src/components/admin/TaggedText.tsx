/**
 * Lightweight read-only renderer for text containing «SENDER:...» and «RECIPIENT:...» tags.
 * Renders sender references in blue and recipient references in green.
 */
import type { ReactNode } from 'react';

const TAG_REGEX = /«(SENDER|RECIPIENT):([^»]*)»/g;

const COLORS: Record<string, string> = {
  SENDER: '#2563eb',
  RECIPIENT: '#16a34a',
};

interface TaggedTextProps {
  text: string;
}

export default function TaggedText({ text }: TaggedTextProps) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state for each render
  TAG_REGEX.lastIndex = 0;

  while ((match = TAG_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const role = match[1]; // SENDER or RECIPIENT
    const inner = match[2];
    parts.push(
      <span key={match.index} style={{ color: COLORS[role], fontWeight: 500 }}>
        {inner}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
