import { useLayoutEffect, useRef } from 'react';
import { getImageUrl } from '../../api/client';
import type { LetterImage } from '../../types/Letter';
import { PreviewImage } from '../common/PreviewImage';

/** One native scroll owner: horizontal on phones, vertical beside the scan. */
export function ViewerPageDrawer({ id, images, selected, onSelect }: {
  id: string; images: LetterImage[]; selected: number; onSelect: (index: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = root.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    const bounds = list.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    // Scroll only the drawer. scrollIntoView could also move the reader behind it.
    list.scrollTo({
      left: list.scrollLeft + item.left + item.width / 2 - bounds.left - bounds.width / 2,
      top: list.scrollTop + item.top + item.height / 2 - bounds.top - bounds.height / 2,
      behavior: 'instant',
    });
  }, [selected]);

  return <div id={id} ref={root} className="viewer-page-drawer" role="region" aria-label="Scan pages" data-image-scroll-root>
    {images.map((image, index) => <button key={image.id || image.imageUrl} type="button" tabIndex={0}
      className="viewer-page-choice" aria-label={`Go to scan ${index + 1}: ${image.type.replace(/_/g, ' ')}`}
      aria-current={selected === index ? 'page' : undefined} onClick={() => onSelect(index)}>
      <PreviewImage src={getImageUrl(image.imageUrl, { width: 200 })} alt="" preloadMargin="120px" context="viewer-pages" />
      <span>{index + 1}<span className="viewer-page-kind">{image.type.replace(/_/g, ' ')}</span></span>
    </button>)}
  </div>;
}
