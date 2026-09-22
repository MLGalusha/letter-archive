import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { LetterImage } from '../../types/Letter';
import { useAccessibleDialog } from '../common/useAccessibleDialog';
import { useReaderViewerSurface } from '../../hooks/useReaderViewerSurface';
import LetterViewer from './LetterViewer';
import './ReaderFocusViewer.css';

/** Fullscreen owns modality and history; selection remains with ScanReader. */
export function ReaderFocusViewer({ images, letterId, selectedIndex, onClose, onPageChange, cornerRatios, entryZoom,
  opener, viewerRef }: {
  images: LetterImage[]; letterId: string; selectedIndex: number; cornerRatios: number[]; entryZoom: number;
  onClose: () => void; onPageChange: (index: number) => void;
  opener: HTMLElement | null; viewerRef: RefObject<HTMLDivElement | null>;
}) {
  const session = useId();
  const [token] = useState(() => history.state?.readerFocusLetter === letterId ? history.state.readerFocus ?? session : session);
  const closing = useRef(false);
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    // Pop first: the same history event closes the viewer for buttons and Back.
    if (history.state?.readerFocus === token) history.back();
    else onClose();
  }, [token, onClose]);
  const { dialogRef } = useAccessibleDialog({ isOpen: true, onClose: requestClose, isolateBackground: true,
    initialFocus: 'dialog', restoreFocusTo: opener });
  useReaderViewerSurface(true, dialogRef, '#f5ede1');
  useLayoutEffect(() => {
    if (history.state?.readerFocus !== token) history.pushState({ ...history.state,
      readerFocus: token, readerFocusLetter: letterId, readerFocusIndex: selectedIndex }, '');
    const pop = () => { if (history.state?.readerFocus !== token) onClose(); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
    // Selection updates replace the entry below; only the session pushes it.
  }, [token, letterId, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (history.state?.readerFocus === token) history.replaceState({ ...history.state, readerFocusIndex: selectedIndex }, '');
  }, [token, selectedIndex]);

  return <div ref={viewerRef} className="reader-focus-backdrop viewer-backdrop" data-phase="focused">
    <div ref={dialogRef} className="reader-focus viewer-modal" role="dialog" aria-modal="true" aria-label="Original scans" tabIndex={-1}>
      <LetterViewer images={images} letterId={letterId} variant="lightbox" focusMode cornerRatios={cornerRatios}
        selectedIndex={selectedIndex} entryZoom={entryZoom} onClose={requestClose} onPageChange={onPageChange} />
    </div>
  </div>;
}
