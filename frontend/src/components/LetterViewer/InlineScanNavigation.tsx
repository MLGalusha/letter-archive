import { useId } from 'react';
import type { LetterImage } from '../../types/Letter';
import { ViewerPageDrawer } from './ViewerPageDrawer';

export function InlineScanNavigation({ images, selected, onSelect, cornerRatios, enabled = true }: {
  enabled?: boolean; cornerRatios?: number[];
  images: LetterImage[]; selected: number; onSelect: (index: number) => void;
}) {
  const drawerId = useId();
  return <div className="scan-navigation">
    <span className="sr-only" role="status" aria-label="Scan page" aria-live="polite" aria-atomic="true">{selected + 1} / {images.length}</span>
    <ViewerPageDrawer cornerRatios={cornerRatios} enabled={enabled} id={drawerId} images={images} selected={selected} onSelect={onSelect} layout="inline" />
  </div>;
}
