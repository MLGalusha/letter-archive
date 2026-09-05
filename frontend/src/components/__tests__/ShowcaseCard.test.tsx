import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(screen.getByRole('link')).toHaveAttribute('href', '/letter/letter-1?from=highlight&image=image-1');
    fireEvent.click(screen.getByRole('link'));
    expect(onNavigate).toHaveBeenCalledWith('letter-1', 'image-1');
    fireEvent.click(screen.getByLabelText('Previous'));
    fireEvent.click(screen.getByLabelText('Previous'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/image-99.jpg');
  });
  it('keeps modified clicks native and page controls separate from navigation', () => {
    const onNavigate = vi.fn();
    render(<ShowcaseCard items={items} onNavigate={onNavigate} />);
    document.addEventListener('click', (event) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault(); // jsdom cannot perform the browser's native navigation.
    }, { once: true });
    fireEvent.click(screen.getByRole('link'), { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('link')).not.toContainElement(screen.getByRole('button', { name: 'Next' }));
  });

  it('lets the keyboard change scans and open the selected destination', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<ShowcaseCard items={items} onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Next' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('img')).toHaveAttribute('src', '/image-1.jpg');
    screen.getByRole('link').focus();
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('letter-1', 'image-1');
  });

});
