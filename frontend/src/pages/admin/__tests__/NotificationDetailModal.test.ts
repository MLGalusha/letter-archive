import { describe, expect, it } from 'vitest';
import { humanizeKey, formatMetadataValue } from '../NotificationDetailModal';

describe('humanizeKey', () => {
  it('converts camelCase to title case', () => {
    expect(humanizeKey('pendingCount')).toBe('Pending Count');
    expect(humanizeKey('silenceWindowMinutes')).toBe('Silence Window Minutes');
  });

  it('converts snake_case to title case', () => {
    expect(humanizeKey('pending_count')).toBe('Pending count');
    expect(humanizeKey('silence_window_minutes')).toBe('Silence window minutes');
  });

  it('handles all-lowercase single words', () => {
    expect(humanizeKey('count')).toBe('Count');
  });

  it('preserves already-capitalized words', () => {
    expect(humanizeKey('LetterId')).toBe('Letter Id');
  });
});

describe('formatMetadataValue', () => {
  it('renders strings as plain text', () => {
    expect(formatMetadataValue('hello')).toEqual({ display: 'hello', isCode: false });
  });

  it('renders numbers and booleans as plain text', () => {
    expect(formatMetadataValue(109)).toEqual({ display: '109', isCode: false });
    expect(formatMetadataValue(true)).toEqual({ display: 'true', isCode: false });
    expect(formatMetadataValue(0)).toEqual({ display: '0', isCode: false });
  });

  it('renders null/undefined as an em dash', () => {
    expect(formatMetadataValue(null)).toEqual({ display: '—', isCode: false });
    expect(formatMetadataValue(undefined)).toEqual({ display: '—', isCode: false });
  });

  it('joins short primitive arrays as comma-separated text', () => {
    expect(formatMetadataValue(['a', 'b', 'c'])).toEqual({
      display: 'a, b, c',
      isCode: false,
    });
    expect(formatMetadataValue([1, 2, 3])).toEqual({
      display: '1, 2, 3',
      isCode: false,
    });
  });

  it('falls back to JSON code block for long primitive arrays', () => {
    const longArr = Array.from({ length: 12 }, (_, i) => i);
    const out = formatMetadataValue(longArr);
    expect(out.isCode).toBe(true);
    expect(out.display).toContain('0');
    expect(out.display).toContain('11');
  });

  it('renders objects as pretty JSON code blocks', () => {
    const out = formatMetadataValue({ foo: 'bar', count: 3 });
    expect(out.isCode).toBe(true);
    expect(out.display).toContain('"foo"');
    expect(out.display).toContain('"bar"');
  });

  it('renders arrays of objects as pretty JSON code blocks', () => {
    const out = formatMetadataValue([{ a: 1 }, { a: 2 }]);
    expect(out.isCode).toBe(true);
    expect(out.display).toContain('"a"');
  });
});
