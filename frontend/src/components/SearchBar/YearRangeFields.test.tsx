import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import YearRangeFields from './YearRangeFields';

describe('year range entry', () => {
  it('accepts years absent from facet suggestions and commits on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<YearRangeFields id="test" value={undefined} onChange={onChange} />);
    await user.type(screen.getByLabelText('To year'), '1863');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ end: 1863 });
  });

  it('rejects inverted and malformed ranges without changing the applied filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<YearRangeFields id="test" value={{ start: 1947, end: 1948 }} onChange={onChange} />);
    const start = screen.getByLabelText('From year');
    await user.clear(start);
    await user.type(start, '1949{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('before or equal');
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(start);
    await user.type(start, '-1{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 9999');
    expect(start).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports open ends, clearing, and external navigation while editing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<YearRangeFields id="test" value={{ start: 1860 }} onChange={onChange} />);
    await user.clear(screen.getByLabelText('From year'));
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    await user.type(screen.getByLabelText('To year'), '1863');
    rerender(<YearRangeFields id="test" value={{ start: 1947, end: 1947 }} onChange={onChange} />);
    expect(screen.getByLabelText('From year')).toHaveValue('1947');
    expect(screen.getByLabelText('To year')).toHaveValue('1947');
  });
  it('explains invalid ranges loaded from a URL or browser history', () => {
    const { rerender } = render(<YearRangeFields id="test" value={{ start: 1900, end: 1863 }} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('before or equal');
    expect(screen.getByLabelText('From year')).toHaveAttribute('aria-invalid', 'true');
    rerender(<YearRangeFields id="test" value={{ start: 1860, end: 1863 }} onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<YearRangeFields id="test" value={{ end: 10000 }} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 9999');
  });

});
