import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JournalImage } from '../JournalImage';
import { API_BASE_URL } from '../../../api/client';
import { journalImageSources } from '../../../utils/journalImages';

describe('journal media', () => {
  it('offers bounded owned variants while preserving originals and source versions', () => {
    const sources = journalImageSources('/blog-images/legacy.jpg?v=source-two');
    expect(sources.original).toContain('/blog-images/legacy.jpg?v=source-two');
    expect(sources.src).toContain('w=800');
    expect(sources.srcSet?.match(/ \d+w/g)).toEqual([' 480w', ' 800w', ' 1200w', ' 1600w']);
    expect(sources.srcSet).toContain('v=source-two');
    expect(sources.srcSet).toContain('rendition=1');
    expect(journalImageSources('/images/page?v=one').srcSet).not.toContain('rendition=');
  });
  it.each(['blog-images/legacy.jpg', `${new URL(API_BASE_URL).origin.replace(/^https?:/, '')}/blog-images/legacy.jpg`])('normalizes owned paths and restores the true original: %s', (source) => {
    const result = journalImageSources(`${source}?v=two&w=480&rendition=old`);
    expect(result.original).toBe(`${API_BASE_URL}/blog-images/legacy.jpg?v=two`);
    expect(result.src).toBe(`${API_BASE_URL}/blog-images/legacy.jpg?v=two&w=800&rendition=1`);
  });
  it.each(['https://external.example/photo.jpg', 'data:image/png;base64,AA', 'https://[bad'])('leaves non-owned URLs alone: %s', (source) => {
    expect(journalImageSources(source)).toEqual({ src: source, original: source, srcSet: undefined });
  });
  it('tries the original once after a variant failure, then resets recovery for another image', () => {
    const { rerender } = render(<JournalImage src="/blog-images/one.jpg" alt="Journal scan" loading="lazy" sizes="360px" />);
    const image = screen.getByAltText('Journal scan');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('sizes', '360px');
    fireEvent.error(image);
    expect(image).not.toHaveAttribute('srcset');
    expect(image.getAttribute('src')).not.toContain('w=');
    fireEvent.error(image);
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    rerender(<JournalImage src="/blog-images/two.jpg" alt="New scan" />);
    expect(screen.getByAltText('New scan')).toHaveAttribute('srcset');
  });
});
