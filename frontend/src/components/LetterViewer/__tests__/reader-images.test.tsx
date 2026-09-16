import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LetterViewer from '../LetterViewer';
import { ReaderScanImage } from '../ReaderScanImage';
import type { LetterImage } from '../../../types/Letter';

const images: LetterImage[] = [1, 2, 3, 4, 5].map((pageNumber) => ({
  id: `scan-${pageNumber}`, type: 'letter', pageNumber,
  imageUrl: `/images/scan-${pageNumber}`, width: 2000, height: 3000,
}));
const OriginalResizeObserver = globalThis.ResizeObserver;
let requested: string[];
let resize: ResizeObserverCallback;
let cssWidth: number;
const widths = (id = 'scan-1') => requested.filter((url) => url.includes(`/images/${id}`))
  .map((url) => new URL(url, 'http://localhost').searchParams.get('w'));
const originals = () => requested.filter((url) => !new URL(url, 'http://localhost').searchParams.has('w'));

beforeEach(() => {
  requested = [];
  cssWidth = 800;
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => cssWidth);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.stubGlobal('devicePixelRatio', 2);
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = true;
    naturalWidth = 800;
    naturalHeight = 1200;
    set src(value: string) { requested.push(value); }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); globalThis.ResizeObserver = OriginalResizeObserver; });

describe('reader scan requests', () => {
  it('uses bounded, density-aware variants for carousel and original transcript previews', () => {
    render(<ReaderScanImage imageUrl={images[0].imageUrl} alt="Scan preview" />);
    expect(widths()).toContain('1600');
    expect(originals()).toEqual([]);
    expect(screen.getByAltText('Scan preview').getAttribute('src')).toContain('w=1600');
    cssWidth = 300;
    act(() => resize([], {} as ResizeObserver));
    expect(widths()).toContain('800');
    expect(originals()).toEqual([]);
  });

  it.each(['panel', 'lightbox'] as const)('keeps %s fit view bounded and requests original only beyond variant detail', async (variant) => {
    const { container } = render(<LetterViewer images={images} variant={variant} />);
    // 400 CSS px fitted to the 600px tall container, at DPR2.
    expect(widths()).toContain('800');
    expect(originals()).toEqual([]);
    const viewer = container.querySelector('.viewer-container')!;
    fireEvent.wheel(viewer, { ctrlKey: true, deltaY: -10 });
    await waitFor(() => expect(widths()).toContain('1200'));
    expect(originals()).toEqual([]);
    fireEvent.wheel(viewer, { ctrlKey: true, deltaY: -100 });
    // Panel's idle upgrade is scheduled; lightbox loads immediately.
    await waitFor(() => expect(originals()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(widths('scan-2')).not.toContain(null);
    expect(container.querySelector('.viewer-image')?.getAttribute('src')).toContain('/images/scan-2');
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(container.querySelector('.viewer-image')?.getAttribute('src')).toContain('/images/scan-1');
  });

  it('prefetches only adjacent pages at bounded resolution, including after zoom', () => {
    const { container } = render(<LetterViewer images={images} variant="lightbox" />);
    expect(widths('scan-2')).toEqual(['800']);
    expect(widths('scan-5')).toEqual(['800']);
    expect(widths('scan-3')).toEqual([]);
    fireEvent.doubleClick(container.querySelector('.viewer-container')!);
    expect(originals()).toHaveLength(1);
    expect(widths('scan-2')).toEqual(['800']);
    expect(widths('scan-5')).toEqual(['800']);
  });

  it('keeps fit view bounded after a display-density change', () => {
    render(<LetterViewer images={images} variant="lightbox" />);
    vi.stubGlobal('devicePixelRatio', 4);
    fireEvent(window, new Event('resize'));
    expect(widths()).toContain('1600');
    expect(originals()).toEqual([]);
  });

  it('uses 1600px for a high-density fit view without treating DPR as zoom', () => {
    vi.stubGlobal('devicePixelRatio', 4);
    render(<LetterViewer images={images} variant="lightbox" />);
    expect(widths()).toContain('1600');
    expect(originals()).toEqual([]);
  });
});
