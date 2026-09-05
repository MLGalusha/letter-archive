import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ShowcaseCard, { type ShowcaseItem } from '../ShowcaseCard';

vi.mock('../common', () => ({
  ProgressiveImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock('../../api/client', () => ({ getImageUrl: (url: string) => url }));

const items: ShowcaseItem[] = Array.from({ length: 100 }, (_, index) => ({
  letterId: `letter-${index}`, imageId: `image-${index}`, imageUrl: `/image-${index}.jpg`,
  label: `Scan ${index}`, peopleLine: '', date: '', hook: '', mediaType: 'letter',
}));

describe('ShowcaseCard image loading', () => {
  it('mounts only the active scan and keeps navigation and wrapping functional', () => {
    const onNavigate = vi.fn();
    render(<ShowcaseCard items={items} onNavigate={onNavigate} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/image-0.jpg');
    fireEvent.click(screen.getByLabelText('Next'));
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/image-1.jpg');
    fireEvent.click(screen.getByRole('button'));
    expect(onNavigate).toHaveBeenCalledWith('letter-1', 'image-1');
    fireEvent.click(screen.getByLabelText('Previous'));
    fireEvent.click(screen.getByLabelText('Previous'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/image-99.jpg');
  });
});
