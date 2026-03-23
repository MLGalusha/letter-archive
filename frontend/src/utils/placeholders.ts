export const PLACEHOLDER_REGEX = /«([A-Za-z_]+)»/g;

export function hasPlaceholders(text: string): boolean {
  PLACEHOLDER_REGEX.lastIndex = 0;
  return PLACEHOLDER_REGEX.test(text);
}

export function splitByPlaceholders(text: string): Array<{ type: 'text' | 'placeholder'; value: string }> {
  const parts: Array<{ type: 'text' | 'placeholder'; value: string }> = [];
  let lastIndex = 0;
  PLACEHOLDER_REGEX.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'placeholder', value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts;
}
