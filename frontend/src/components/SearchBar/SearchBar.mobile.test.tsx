import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchBar, { type SearchFilters } from './SearchBar';

const device = vi.hoisted(() => ({ mobile: true }));
vi.mock('../../hooks/useIsMobile', () => ({ default: () => device.mobile }));
afterEach(() => { device.mobile = true; vi.unstubAllGlobals(); });

const facets = { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] };

describe('mobile search panel dismissal', () => {
  it.each([true, false])('uses touch landscape policy only when its media query matches (%s)', async (matches) => {
    device.mobile = false;
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 980px) and (pointer: coarse)' && matches,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    render(<SearchBar query="" filters={{}} facets={facets} total={0} loading={false}
      onQueryChange={vi.fn()} onFiltersChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Open archive refine/ }));
    await user.click(screen.getByRole('searchbox'));
    expect(screen.queryByLabelText('To year') !== null).toBe(!matches);
  });

  it.each(['full', 'compact'] as const)('commits the year draft and closes controlled %s panels when focusing search', async (variant) => {
    const user = userEvent.setup();
    function Harness() {
      const [filters, setFilters] = useState<SearchFilters>({});
      const [open, setOpen] = useState(false);
      return <SearchBar query="" filters={filters} facets={facets} total={0} loading={false}
        variant={variant} refineOpen={open} onRefineOpenChange={setOpen}
        onQueryChange={vi.fn()} onFiltersChange={setFilters} />;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Open archive refine/ }));
    await user.type(screen.getByLabelText('To year'), '1863');
    await user.click(screen.getByRole('searchbox', { name: 'Search the archive' }));
    expect(screen.queryByLabelText('To year')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Open archive refine/ }));
    expect(screen.getByLabelText('To year')).toHaveValue('1863');
  });

  it('closes an uncontrolled panel on focus and on a repeated input click', async () => {
    const user = userEvent.setup();
    render(<SearchBar query="" filters={{}} facets={facets} total={0} loading={false}
      onQueryChange={vi.fn()} onFiltersChange={vi.fn()} />);
    const search = screen.getByRole('searchbox');
    await user.click(screen.getByRole('button', { name: /Open archive refine/ }));
    fireEvent.focus(search);
    expect(screen.queryByLabelText('To year')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open archive refine/ }));
    fireEvent.click(search);
    expect(screen.queryByLabelText('To year')).not.toBeInTheDocument();
  });

  it('dismisses sort on search focus without changing the selection', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(<SearchBar query="" filters={{ sort: 'letterDate', sortOrder: 'asc' }} facets={facets}
      total={0} loading={false} onQueryChange={vi.fn()} onFiltersChange={onFiltersChange} />);
    await user.click(screen.getByRole('button', { name: 'Sort archive results' }));
    expect(screen.getByRole('group', { name: 'Sort options' })).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('searchbox'));
    expect(screen.queryByRole('group', { name: 'Sort options' })).not.toBeInTheDocument();
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it('preserves desktop filter visibility when search receives focus', async () => {
    device.mobile = false;
    const user = userEvent.setup();
    render(<SearchBar query="" filters={{}} facets={facets} total={0} loading={false}
      onQueryChange={vi.fn()} onFiltersChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Open archive refine/ }));
    await user.click(screen.getByRole('searchbox'));
    expect(screen.getByLabelText('To year')).toBeInTheDocument();
  });
});
