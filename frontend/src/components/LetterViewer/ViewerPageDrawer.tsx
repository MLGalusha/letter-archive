import { useLayoutEffect, useRef } from 'react';
import { getImageUrl } from '../../api/client';
import type { LetterImage } from '../../types/Letter';
import { PreviewImage } from '../common/PreviewImage';
import './ViewerPageDrawer.css';

/** One native scroll owner: horizontal on phones, vertical beside the scan. */
export function ViewerPageDrawer({ id, images, selected, onSelect, layout = 'viewer' }: {
  id: string; images: LetterImage[]; selected: number; onSelect: (index: number) => void;
  layout?: 'viewer' | 'inline';
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = root.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    const bounds = list.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    // Keep native browsing still when the selected thumbnail is already visible.
    if (item.left >= bounds.left && item.right <= bounds.right
      && item.top >= bounds.top && item.bottom <= bounds.bottom) return;
    // Scroll only the drawer. scrollIntoView could also move the reader behind it.
    list.scrollTo({
      left: list.scrollLeft + item.left + item.width / 2 - bounds.left - bounds.width / 2,
      top: list.scrollTop + item.top + item.height / 2 - bounds.top - bounds.height / 2,
      behavior: 'instant',
    });
  }, [selected]);

  return <div id={id} ref={root} className={`viewer-page-drawer${layout === 'inline' ? ' viewer-page-drawer--inline' : ''}`} role="region" aria-label="Scan pages" data-image-scroll-root data-swipe-ignore>
    {images.map((image, index) => <button key={image.id || image.imageUrl} type="button" tabIndex={0}
      className="viewer-page-choice" aria-label={`Go to scan ${index + 1}: ${image.type.replace(/_/g, ' ')}`}
      aria-current={selected === index ? 'page' : undefined} onClick={() => onSelect(index)}>
      <PreviewImage src={getImageUrl(image.imageUrl, { width: 200 })} alt="" preloadMargin="120px" context="viewer-pages" />
    </button>)}
  </div>;
}
