/**
 * Format a date string (ISO or similar) into a human-readable form.
 * e.g., "2026-03-30" -> "March 30, 2026"
 */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
