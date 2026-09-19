import { memo } from 'react';
import { getImageUrl } from '../../api/client';
import type { LetterImage } from '../../types/Letter';
import { PreviewImage } from '../common/PreviewImage';
import './ViewerPageDrawer.css';
import { usePageStripMotion } from './usePageStripMotion';
import type { PageMotion } from './pageMotion';

/** Shared filmstrip with coordinated paging and native touch scrolling. Only settled user scrolling selects a new scan. */
export const ViewerPageDrawer = memo(function ViewerPageDrawer({ id, images, selected, onSelect, motion, layout = 'viewer', enabled = true }: {
  id: string; images: LetterImage[]; selected: number; onSelect: (index: number) => void;
  motion?: PageMotion;
  layout?: 'viewer' | 'inline';
  enabled?: boolean;
}) {
  const { root, choose, suppressClick } = usePageStripMotion( selected, onSelect, motion, images.length);

  return <div id={id} ref={root} className={`viewer-page-drawer${layout === 'inline' ? ' viewer-page-drawer--inline' : ''}`} role="region" aria-label="Scan pages" data-image-scroll-root data-swipe-ignore onDragStart={event => event.preventDefault()}
    onKeyDown={event => {
      const index = event.key === 'ArrowRight' ? Math.min(images.length - 1, selected + 1)
        : event.key === 'ArrowLeft' ? Math.max(0, selected - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? images.length - 1 : undefined;
      if (index === undefined) return;
      event.preventDefault(); choose.current(index);
      root.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus({ preventScroll: true });
    }}>
    {images.map((image, index) => <button key={image.id || image.imageUrl} type="button" tabIndex={selected === index ? 0 : -1}
      className="viewer-page-choice" aria-label={`Go to scan ${index + 1}: ${image.type.replace(/_/g, ' ')}`}
      aria-current={selected === index ? 'page' : undefined} onClick={event => {
        if (event.detail > 0 && suppressClick.current) { suppressClick.current = false; return; }
        choose.current(index);
      }}>
      <PreviewImage enabled={enabled} src={getImageUrl(image.imageUrl, { width: 200 })} alt="" preloadMargin="120px" context="viewer-pages" />
      <span className="viewer-page-notch" aria-hidden="true">{index + 1}</span>
    </button>)}
  </div>;
});
