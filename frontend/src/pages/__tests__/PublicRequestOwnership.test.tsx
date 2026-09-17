import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PersonPage from '../PersonPage';
import UpdatesPage from '../UpdatesPage';

const person = vi.fn();
const journal = vi.fn();
vi.mock('../../api/entities', () => ({ getPersonPublic: (...args: unknown[]) => person(...args) }));
vi.mock('../../api/client', () => ({ listBlogPosts: (...args: unknown[]) => journal(...args), getImageUrl: (url: string) => url }));
vi.mock('../../hooks/useSiteSettings', () => ({ useSiteSettings: () => null }));
vi.mock('../../components/SEO', () => ({ default: () => null }));
vi.mock('../../components/Breadcrumb', () => ({ default: () => null }));
vi.mock('../../components/Footer/Footer', () => ({ default: () => null }));
vi.mock('../../utils/searchPersistence', () => ({ loadJournalSort: () => null, saveJournalSort: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const personData = (id: string) => ({ person: { id, canonicalName: id, aliases: [], biography: null },
  relationships: [], stats: { asSender: 0, asRecipient: 0, asMentioned: 0, total: 0 }, letters: [] });
const posts = (title: string) => ({ posts: [{ id: title, slug: title, title, excerpt: title,
  bodyMarkdown: '', authorDisplayName: 'Author', publishedAt: '2026-09-17', heroImageUrl: null }], total: 24 });

beforeEach(() => { person.mockReset(); journal.mockReset(); });

describe('public request ownership', () => {
  it('does not revive an old person error on A to B to A', async () => {
    const secondA = deferred<ReturnType<typeof personData>>();
    const pendingB = deferred<ReturnType<typeof personData>>();
    person.mockRejectedValueOnce(new Error('old A failure')).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(secondA.promise);
    render(<MemoryRouter initialEntries={['/people/a']}>
      <Link to="/people/a">Go to A</Link><Link to="/people/b">Go to B</Link>
      <Routes><Route path="/people/:personId" element={<PersonPage />} /></Routes></MemoryRouter>);
    await screen.findByText('old A failure');
    fireEvent.click(screen.getByText('Go to B'));
    fireEvent.click(screen.getByText('Go to A'));
    expect(screen.getByText('Loading person...')).toBeInTheDocument();
    expect(screen.queryByText('old A failure')).not.toBeInTheDocument();
    await act(async () => pendingB.resolve(personData('b')));
    expect(screen.getByText('Loading person...')).toBeInTheDocument();
    await act(async () => secondA.resolve(personData('a')));
    expect(screen.getByRole('heading', { name: 'a' })).toBeInTheDocument();
  });

  it('does not revive an old journal error on page one to two to one', async () => {
    const secondA = deferred<ReturnType<typeof posts>>();
    const pendingB = deferred<ReturnType<typeof posts>>();
    journal.mockRejectedValueOnce(new Error('old page failure')).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(secondA.promise);
    render(<MemoryRouter initialEntries={['/blog']}>
      <Link to="/blog">Go to one</Link><Link to="/blog?page=2">Go to two</Link><UpdatesPage /></MemoryRouter>);
    await screen.findByText('old page failure');
    fireEvent.click(screen.getByText('Go to two'));
    fireEvent.click(screen.getByText('Go to one'));
    expect(screen.getByText('Loading journal entries...')).toBeInTheDocument();
    expect(screen.queryByText('old page failure')).not.toBeInTheDocument();
    await act(async () => pendingB.resolve(posts('old-page-two')));
    expect(screen.getByText('Loading journal entries...')).toBeInTheDocument();
    await act(async () => secondA.resolve(posts('new-page-one')));
    expect(screen.getByRole('heading', { name: 'new-page-one' })).toBeInTheDocument();
  });
  it.each(['success', 'failure'])('ignores an old person %s after navigating to another person', async (outcome) => {
    const old = deferred<ReturnType<typeof personData>>();
    const next = deferred<ReturnType<typeof personData>>();
    person.mockImplementation((id) => id === 'a' ? old.promise : next.promise);
    const view = render(<MemoryRouter initialEntries={['/people/a']}>
      <Link to="/people/b">Go to B</Link><Routes><Route path="/people/:personId" element={<PersonPage />} /></Routes>
    </MemoryRouter>);
    const oldSignal = person.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByText('Go to B'));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.getByText('Loading person...')).toBeInTheDocument();
    await act(async () => next.resolve(personData('b')));
    expect(screen.getByRole('heading', { name: 'b' })).toBeInTheDocument();
    await act(async () => outcome === 'success' ? old.resolve(personData('a')) : old.reject(new Error('old failure')));
    expect(screen.getByRole('heading', { name: 'b' })).toBeInTheDocument();
    expect(screen.queryByText('old failure')).not.toBeInTheDocument();
    const newSignal = person.mock.calls[1][1] as AbortSignal;
    view.unmount();
    expect(newSignal.aborted).toBe(true);
  });

  it('clears a previous person error while loading a valid destination', async () => {
    const next = deferred<ReturnType<typeof personData>>();
    person.mockRejectedValueOnce(new Error('first person failed')).mockReturnValueOnce(next.promise);
    render(<MemoryRouter initialEntries={['/people/a']}><Link to="/people/b">Go to B</Link>
      <Routes><Route path="/people/:personId" element={<PersonPage />} /></Routes></MemoryRouter>);
    await screen.findByText('first person failed');
    fireEvent.click(screen.getByText('Go to B'));
    expect(screen.queryByText('first person failed')).not.toBeInTheDocument();
    expect(screen.getByText('Loading person...')).toBeInTheDocument();
    await act(async () => next.resolve(personData('b')));
    expect(screen.getByRole('heading', { name: 'b' })).toBeInTheDocument();
  });

  it.each(['success', 'failure'])('keeps the latest journal sort and page after an old %s', async (outcome) => {
    const old = deferred<ReturnType<typeof posts>>();
    const pageTwo = deferred<ReturnType<typeof posts>>();
    journal.mockImplementation((params) => params.offset === 12 ? pageTwo.promise
      : params.sort === 'title' ? old.promise : Promise.resolve(posts(params.sort)));
    const view = render(<MemoryRouter initialEntries={['/blog']}>
      <Link to="/blog?page=2">Go to page two</Link><UpdatesPage />
    </MemoryRouter>);
    await screen.findByRole('heading', { name: 'date' });
    fireEvent.click(screen.getByRole('button', { name: 'Sort journal entries' }));
    fireEvent.click(screen.getByRole('option', { name: 'Title' }));
    const oldSignal = journal.mock.calls.at(-1)![1] as AbortSignal;
    fireEvent.keyDown(screen.getByRole('option', { name: 'Author' }), { key: 'Enter' });
    await screen.findByRole('heading', { name: 'author' });
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(screen.getByText('Go to page two'));
    expect(screen.getByText('Loading journal entries...')).toBeInTheDocument();
    await act(async () => pageTwo.resolve(posts('page-two-author')));
    await act(async () => outcome === 'success' ? old.resolve(posts('old-title')) : old.reject(new Error('old failure')));
    expect(screen.getByRole('heading', { name: 'page-two-author' })).toBeInTheDocument();
    expect(screen.queryByText('old failure')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'old-title' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Author/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(journal.mock.calls.at(-1)![0].offset).toBe(12));
    const signal = journal.mock.calls.at(-1)![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
