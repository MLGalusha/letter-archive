import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalImageDialog from '../JournalImageDialog';

const { getAdminCollectionsMock, getAdminCollectionByCodeMock, getAdminLetterByIdMock } = vi.hoisted(() => ({
  getAdminCollectionsMock: vi.fn(),
  getAdminCollectionByCodeMock: vi.fn(),
  getAdminLetterByIdMock: vi.fn(),
}));

vi.mock('../../api/collections', () => ({
  getAdminCollections: getAdminCollectionsMock,
  getAdminCollectionByCode: getAdminCollectionByCodeMock,
}));
vi.mock('../../api/letters', () => ({
  getAdminLetterById: getAdminLetterByIdMock,
}));

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  getAdminCollectionsMock.mockResolvedValue([
    { id: 'collection', collectionCode: '001', title: 'Archive', letterCount: 1 },
  ]);
  getAdminCollectionByCodeMock.mockResolvedValue({
    letters: [{ id: 'letter', title: 'Private letter', images: [{ id: 'page', imageUrl: '/images/private', pageNumber: 1 }] }],
  });
  getAdminLetterByIdMock.mockResolvedValue({
    images: [{ id: 'page', imageUrl: '/images/private', pageNumber: 1, type: 'letter', originalFilename: 'Scan.jpg' }],
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('journal database image recovery', () => {
  it('recovers letter and page thumbnails at the same size while preserving selection', async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<JournalImageDialog isOpen onClose={onClose} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'Database' }));
    fireEvent.click(await screen.findByRole('button', { name: /001 Archive/ }));
    const first = await screen.findByAltText('Private letter');
    vi.useFakeTimers();
    fireEvent.error(first);
    expect(first).not.toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    const retry = screen.getByAltText('Private letter');
    expect(retry).not.toBe(first);
    expect(retry).toHaveAttribute('src', first.getAttribute('src'));
    expect(retry.getAttribute('src')).toContain('w=200');
    fireEvent.load(retry);
    expect(retry).toBeVisible();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: /Private letter.*1 page/ }));
    const page = await screen.findByAltText('Scan.jpg');
    vi.useFakeTimers();
    fireEvent.error(page);
    act(() => vi.advanceTimersByTime(1000));
    const pageRetry = screen.getByAltText('Scan.jpg');
    expect(pageRetry).not.toBe(page);
    expect(pageRetry).toHaveAttribute('src', page.getAttribute('src'));
    expect(pageRetry.getAttribute('src')).toContain('w=300');
    fireEvent.load(pageRetry);
    fireEvent.click(screen.getByRole('button', { name: /Page 1.*Scan.jpg/ }));
    expect(onInsert).toHaveBeenCalledWith('/images/private', 'Scan.jpg');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

it('keeps author-browser dimensions tied to the exact preview URL', () => {
  const insert = vi.fn();
  render(<JournalImageDialog isOpen onClose={() => {}} onInsert={insert} />);
  const input = screen.getByPlaceholderText('https://example.com/image.jpg');
  fireEvent.change(input, { target: { value: 'https://example.test/a.jpg' } });
  const image = screen.getByAltText('Preview');
  Object.defineProperties(image, { naturalWidth: { value: 300 }, naturalHeight: { value: 200 } });
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  expect(insert).toHaveBeenLastCalledWith('https://example.test/a.jpg', undefined, { width: 300, height: 200 });
  fireEvent.change(input, { target: { value: 'https://example.test/b.jpg' } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  expect(insert).toHaveBeenLastCalledWith('https://example.test/b.jpg', undefined, undefined);
});

it('loads collections once per database activation even when the result is empty', async () => {
  getAdminCollectionsMock.mockResolvedValue([]);
  const props = { onClose: vi.fn(), onInsert: vi.fn() };
  const { rerender } = render(<JournalImageDialog isOpen {...props} />);

  fireEvent.click(screen.getByRole('button', { name: 'Database' }));
  expect(await screen.findByText('No collections found')).toBeInTheDocument();
  expect(getAdminCollectionsMock).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'URL' }));
  fireEvent.click(screen.getByRole('button', { name: 'Database' }));
  await waitFor(() => expect(getAdminCollectionsMock).toHaveBeenCalledTimes(2));

  rerender(<JournalImageDialog isOpen={false} {...props} />);
  rerender(<JournalImageDialog isOpen {...props} />);
  await waitFor(() => expect(getAdminCollectionsMock).toHaveBeenCalledTimes(3));
});

it('settles a failed collection activation without retrying in a loop', async () => {
  getAdminCollectionsMock.mockRejectedValue(new Error('collections unavailable'));
  render(<JournalImageDialog isOpen onClose={vi.fn()} onInsert={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Database' }));
  expect(await screen.findByText('No collections found')).toBeInTheDocument();
  expect(getAdminCollectionsMock).toHaveBeenCalledTimes(1);
});

it('ignores stale collection and letter responses after database selection changes', async () => {
  const alphaLetters = deferred<{ letters: Array<Record<string, unknown>> }>();
  const betaLetters = deferred<{ letters: Array<Record<string, unknown>> }>();
  const betaOneImages = deferred<{ images: Array<Record<string, unknown>> }>();
  const betaTwoImages = deferred<{ images: Array<Record<string, unknown>> }>();
  getAdminCollectionsMock.mockResolvedValue([
    { id: 'alpha', collectionCode: '001', title: 'Alpha', letterCount: 1 },
    { id: 'beta', collectionCode: '002', title: 'Beta', letterCount: 2 },
  ]);
  getAdminCollectionByCodeMock.mockImplementation((code: string) => (
    code === '001' ? alphaLetters.promise : betaLetters.promise
  ));
  getAdminLetterByIdMock.mockImplementation((id: string) => (
    id === 'beta-one' ? betaOneImages.promise : betaTwoImages.promise
  ));

  render(<JournalImageDialog isOpen onClose={vi.fn()} onInsert={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Database' }));
  fireEvent.click(await screen.findByRole('button', { name: /001 Alpha/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Collections' }));
  fireEvent.click(screen.getByRole('button', { name: /002 Beta/ }));

  await act(async () => betaLetters.resolve({
    letters: [
      { id: 'beta-one', title: 'Beta One', images: [{ id: 'b1', imageUrl: '/b1', pageNumber: 1 }] },
      { id: 'beta-two', title: 'Beta Two', images: [{ id: 'b2', imageUrl: '/b2', pageNumber: 1 }] },
    ],
  }));
  expect(await screen.findByRole('button', { name: /Beta One.*1 page/ })).toBeInTheDocument();

  await act(async () => alphaLetters.resolve({
    letters: [{ id: 'alpha-letter', title: 'Stale Alpha', images: [] }],
  }));
  expect(screen.queryByText('Stale Alpha')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Beta One.*1 page/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
  fireEvent.click(screen.getByRole('button', { name: /Beta Two.*1 page/ }));
  await act(async () => betaTwoImages.resolve({
    images: [{ id: 'b2', imageUrl: '/b2', pageNumber: 1, type: 'letter', originalFilename: 'Beta two scan' }],
  }));
  expect(await screen.findByAltText('Beta two scan')).toBeInTheDocument();

  await act(async () => betaOneImages.resolve({
    images: [{ id: 'b1', imageUrl: '/b1', pageNumber: 1, type: 'letter', originalFilename: 'Stale beta one scan' }],
  }));
  expect(screen.queryByAltText('Stale beta one scan')).not.toBeInTheDocument();
});
