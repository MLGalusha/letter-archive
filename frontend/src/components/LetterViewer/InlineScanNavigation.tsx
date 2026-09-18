import { useId, useState } from 'react';
import type { LetterImage } from '../../types/Letter';
import Icon from '../common/Icon';
import { ViewerPageDrawer } from './ViewerPageDrawer';

export function InlineScanNavigation({ images, selected, onSelect }: {
  images: LetterImage[]; selected: number; onSelect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  if (images.length < 2) return <span className="scan-caption">Scan 1 of 1</span>;
  return <>
    <div className="scan-navigation" aria-label="Scan controls" data-swipe-ignore>
      <div className="scan-navigation-pages">
        <button type="button" aria-label="Previous scan" onClick={() => onSelect((selected - 1 + images.length) % images.length)}>
          <Icon name="arrow-left" size={20} />
        </button>
        <span role="status" aria-label="Scan page" aria-live="polite" aria-atomic="true">{selected + 1} / {images.length}</span>
        <button type="button" aria-label="Next scan" onClick={() => onSelect((selected + 1) % images.length)}>
          <Icon name="arrow-right" size={20} />
        </button>
      </div>
      <button type="button" aria-expanded={open} aria-controls={drawerId} onClick={() => setOpen(value => !value)}>Pages</button>
    </div>
    {open && <ViewerPageDrawer id={drawerId} images={images} selected={selected} onSelect={onSelect} layout="inline" />}
  </>;
}
