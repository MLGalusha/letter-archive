import { useEffect, useState } from 'react';
import type { SearchFilters } from '../../utils/archiveSearch';

type Range = SearchFilters['dateRange'];

function rangeError(start: string, end: string): string {
  const validYear = (text: string) => text === '' || (/^\d{1,4}$/.test(text) && Number(text) >= 1);
  if (!validYear(start) || !validYear(end)) return 'Enter a year from 1 to 9999, or leave it blank.';
  if (start && end && Number(start) > Number(end)) return 'From year must be before or equal to To year.';
  return '';
}

/** Year entry is independent of the truncated, query-dependent year facets. */
export default function YearRangeFields({ id, value, onChange, onDraftChange }: {
  id: string;
  value: Range;
  onChange: (range: Range) => void;
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const external = `${value?.start ?? ''}:${value?.end ?? ''}`;
  const [previous, setPrevious] = useState(external);
  const [start, setStart] = useState(String(value?.start ?? ''));
  const [end, setEnd] = useState(String(value?.end ?? ''));
  const [error, setError] = useState(() => rangeError(String(value?.start ?? ''), String(value?.end ?? '')));

  const hasDraft = start !== String(value?.start ?? '') || end !== String(value?.end ?? '');
  useEffect(() => { onDraftChange?.(hasDraft); }, [hasDraft, onDraftChange]);

  // Incoming range changes replace unfinished edits. SearchBar also remounts
  // these fields on explicit Clear All, even if the applied range was empty.
  if (previous !== external) {
    setPrevious(external);
    setStart(String(value?.start ?? ''));
    setEnd(String(value?.end ?? ''));
    setError(rangeError(String(value?.start ?? ''), String(value?.end ?? '')));
  }

  const commit = () => {
    const nextError = rangeError(start, end);
    setError(nextError);
    if (nextError) return;
    onChange(start || end ? {
      ...(start ? { start: Number(start) } : {}),
      ...(end ? { end: Number(end) } : {}),
    } : undefined);
  };

  return (
    <div className="filter-group filter-group-year-range">
      <span className="filter-label">Year Range</span>
      <div className="year-range-pair">
        {(['start', 'end'] as const).map((side, index) => (
          <span className="year-range-entry" key={side}>
            {index === 1 && <span className="year-range-sep" aria-hidden="true">–</span>}
            <input
              id={`${id}-year-${side}`}
              className="filter-input"
              type="text"
              inputMode="numeric"
              aria-label={side === 'start' ? 'From year' : 'To year'}
              placeholder={side === 'start' ? 'From' : 'To'}
              value={side === 'start' ? start : end}
              aria-invalid={Boolean(error)}
              aria-describedby={`${id}-year-help`}
              onChange={(event) => (side === 'start' ? setStart : setEnd)(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); commit(); }
              }}
            />
          </span>
        ))}
      </div>
      <small id={`${id}-year-help`} role={error ? 'alert' : undefined}>
        {error || 'Leave either year blank for an open range. Unknown years are excluded.'}
      </small>
    </div>
  );
}
