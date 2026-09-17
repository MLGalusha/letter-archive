import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JournalImageDialog from '../JournalImageDialog';

vi.mock('../../api/collections', () => ({
  getAdminCollections: vi.fn().mockResolvedValue([{ id: 'collection', collectionCode: '001', title: 'Archive', letterCount: 1 }]),
  getAdminCollectionByCode: vi.fn().mockResolvedValue({ letters: [{ id: 'letter', title: 'Private letter', images: [{ id: 'page', imageUrl: '/images/private', pageNumber: 1 }] }] }),
}));
vi.mock('../../api/letters', () => ({
  getAdminLetterById: vi.fn().mockResolvedValue({ images: [{ id: 'page', imageUrl: '/images/private', pageNumber: 1, type: 'letter', originalFilename: 'Scan.jpg' }] }),
}));

afterEach(() => vi.useRealTimers());

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
