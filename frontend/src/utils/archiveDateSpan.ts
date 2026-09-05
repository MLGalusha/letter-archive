const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Filename dates retain X for unknown components; ISO dates are also accepted. */
export function archiveDateSpan(values: (string | null | undefined)[], includeDay = true) {
  const dates = values.flatMap((value) => {
    const raw = value?.replace(/-/g, '').toUpperCase();
    if (!raw || !/^\d{2}[\dX]{6}$/.test(raw)) return [];
    const year = raw.slice(0, 4);
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    let label: string;
    if (year.includes('X')) {
      const knownPrefix = year.split('X')[0];
      label = `${knownPrefix.padEnd(4, '0')}s`;
    }
    else if (!month || month > 12) label = year;
    else label = `${MONTHS[month - 1]} ${includeDay && day >= 1 && day <= 31 ? `${day}, ` : ''}${year}`;
    return [{ lower: raw.replace(/X/g, '0'), upper: raw.replace(/X/g, '9'), label }];
  });
  if (!dates.length) return null;
  const first = dates.reduce((a, b) => a.lower <= b.lower ? a : b);
  const last = dates.reduce((a, b) => a.upper >= b.upper ? a : b);
  return { start: first.label, end: last.label, label: first.label === last.label ? first.label : `${first.label} — ${last.label}` };
}
