type ScanRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

export function createScanReturnSnapshot(source: HTMLImageElement, viewport: DOMRect) {
  if (!source.complete || !source.naturalWidth) return null;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  // Freeze the complete loaded image once, at transition-appropriate detail.
  // A DOM image can change its srcset/natural size while the document returns;
  // re-reading it per frame can crop incorrectly or repeat expensive decoding.
  const maxEdge = Math.min(2048, Math.max(viewport.width, viewport.height) * density);
  const ratio = Math.min(1, maxEdge / Math.max(source.naturalWidth, source.naturalHeight));
  const snapshot = document.createElement('canvas');
  snapshot.width = Math.max(1, Math.round(source.naturalWidth * ratio));
  snapshot.height = Math.max(1, Math.round(source.naturalHeight * ratio));
  const snapshotContext = snapshot.getContext('2d');
  if (!snapshotContext) return null;
  snapshotContext.drawImage(source, 0, 0, snapshot.width, snapshot.height);
  return snapshot;
}

/** Paint only visible pixels, even when the scan's logical bounds are enormous. */
export function createScanReturnPainter(canvas: HTMLCanvasElement, snapshot: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  const sourceWidth = snapshot.width, sourceHeight = snapshot.height;

  const paint = (rect: ScanRect, cornerRatio: number) => {
    const viewport = canvas.getBoundingClientRect();
    const width = Math.ceil(viewport.width * density);
    const height = Math.ceil(viewport.height * density);
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(width / viewport.width, 0, 0, height / viewport.height, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    const x = rect.left - viewport.left;
    const y = rect.top - viewport.top;
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(viewport.width, x + rect.width);
    const bottom = Math.min(viewport.height, y + rect.height);
    if (right <= left || bottom <= top || rect.width <= 0 || rect.height <= 0) return;
    context.save();
    context.beginPath();
    context.roundRect(x, y, rect.width, rect.height, rect.width * cornerRatio);
    context.clip();
    // Crop in source coordinates before drawing so neither the canvas nor the
    // destination rectangle expands to the 50x zoomed image's dimensions.
    context.drawImage(snapshot,
      (left - x) / rect.width * sourceWidth, (top - y) / rect.height * sourceHeight,
      (right - left) / rect.width * sourceWidth, (bottom - top) / rect.height * sourceHeight,
      left, top, right - left, bottom - top);
    context.restore();
  };
  return paint;
}
