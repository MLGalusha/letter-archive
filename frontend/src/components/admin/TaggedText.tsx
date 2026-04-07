/**
 * Lightweight read-only renderer that highlights sender/recipient references.
 *
 * Supports two modes:
 * 1. Tag mode (default): parses «SENDER:text» and «RECIPIENT:text» guillemet tags
 * 2. Name mode: when senderName/recipientName props are provided, highlights
 *    occurrences of those names in the text (case-insensitive, word-boundary).
 *
 * Sender references render in blue, recipient in green.
 */
import { useMemo, type ReactNode } from 'react';

const SENDER_COLOR = '#2563eb';
const RECIPIENT_COLOR = '#16a34a';

interface TaggedTextProps {
  text: string;
  /** When set, highlights occurrences of this name as sender (blue) */
  senderName?: string | null;
  /** When set, highlights occurrences of this name as recipient (green) */
  recipientName?: string | null;
}

/**
 * Build a regex that matches any of the given names (case-insensitive, word-boundary).
 * Generates variants: full name + first name (if multi-word).
 */
function buildNameRegex(
  senderName: string | null | undefined,
  recipientName: string | null | undefined,
): RegExp | null {
  const parts: string[] = [];
  const senderPatterns: string[] = [];
  const recipientPatterns: string[] = [];

  const addVariants = (name: string, target: string[]) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    target.push(escaped);
    // Also match first name if multi-word
    const firstName = name.split(/\s+/)[0];
    if (firstName && firstName !== name) {
      target.push(firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  };

  if (senderName) addVariants(senderName, senderPatterns);
  if (recipientName) addVariants(recipientName, recipientPatterns);

  // Build combined pattern with named groups
  // Sender patterns first, then recipient — order matters for alternation
  if (senderPatterns.length > 0) {
    parts.push(`(?<sender>${senderPatterns.join('|')})`);
  }
  if (recipientPatterns.length > 0) {
    parts.push(`(?<recipient>${recipientPatterns.join('|')})`);
  }

  if (parts.length === 0) return null;

  // Word boundary to avoid partial matches
  return new RegExp(`\\b(?:${parts.join('|')})\\b`, 'gi');
}

function renderWithTags(text: string): ReactNode[] {
  const TAG_REGEX = /«(SENDER|RECIPIENT):([^»]*)»/g;
  const COLORS: Record<string, string> = {
    SENDER: SENDER_COLOR,
    RECIPIENT: RECIPIENT_COLOR,
  };
  const result: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    const role = match[1];
    const inner = match[2];
    result.push(
      <span key={match.index} style={{ color: COLORS[role], fontWeight: 500 }}>
        {inner}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result;
}

function renderWithNames(
  text: string,
  regex: RegExp,
  senderName: string | null | undefined,
  recipientName: string | null | undefined,
): ReactNode[] {
  const result: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Build lookup sets for sender/recipient variants (lowercased)
  const senderVariants = new Set<string>();
  const recipientVariants = new Set<string>();
  if (senderName) {
    senderVariants.add(senderName.toLowerCase());
    const first = senderName.split(/\s+/)[0];
    if (first) senderVariants.add(first.toLowerCase());
  }
  if (recipientName) {
    recipientVariants.add(recipientName.toLowerCase());
    const first = recipientName.split(/\s+/)[0];
    if (first) recipientVariants.add(first.toLowerCase());
  }

  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    const matched = match[0].toLowerCase();
    const isSender = senderVariants.has(matched);
    const color = isSender ? SENDER_COLOR : RECIPIENT_COLOR;

    result.push(
      <span key={match.index} style={{ color, fontWeight: 500 }}>
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result;
}

export default function TaggedText({ text, senderName, recipientName }: TaggedTextProps) {
  const nameRegex = useMemo(
    () => buildNameRegex(senderName, recipientName),
    [senderName, recipientName],
  );

  const useNameMode = !!(senderName || recipientName) && nameRegex;

  // If text has guillemet tags, always use tag mode
  const hasGuillemets = text.includes('«');

  if (hasGuillemets) {
    return <>{renderWithTags(text)}</>;
  }

  if (useNameMode) {
    return <>{renderWithNames(text, nameRegex, senderName, recipientName)}</>;
  }

  return <>{text}</>;
}
