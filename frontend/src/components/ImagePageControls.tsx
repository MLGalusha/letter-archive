import type { MouseEventHandler } from 'react';
import './ImagePageControls.css';

interface Props {
  onPrevious: MouseEventHandler<HTMLButtonElement>;
  onNext: MouseEventHandler<HTMLButtonElement>;
  previousLabel?: string;
  nextLabel?: string;
}

/** Large edge targets with a separate, softly fading visual surface. */
export default function ImagePageControls({ onPrevious, onNext, previousLabel = 'Previous page', nextLabel = 'Next page' }: Props) {
  return <div className="image-page-controls">
    <button type="button" className="image-page-control image-page-control--previous" aria-label={previousLabel} onClick={onPrevious} />
    <button type="button" className="image-page-control image-page-control--next" aria-label={nextLabel} onClick={onNext} />
  </div>;
}
