import { imagePreloadService } from '../../services/imagePreloadService';
import { useMemo, useRef, useState } from 'react';
import { getImageUrl } from '../../api/client';
import { ProgressiveImage, type ProgressiveImageProps } from '../common/ProgressiveImage';
import { scanVariantWidth } from './scanResolution';
import { useScanDisplayWidth } from './useScanDisplayWidth';

/** Reader previews never fetch originals; the zoomable viewer owns that decision. */
export function ReaderScanImage({ imageUrl, enabled = true, previewEnabled = false, ...props }: Omit<ProgressiveImageProps, 'src' | 'thumbSrc' | 'midSrc' | 'containerRef'> & { imageUrl: string; previewEnabled?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const physicalWidth = useScanDisplayWidth(containerRef, undefined, false, true);
  const width = scanVariantWidth(physicalWidth);
  // Admission is one-way for this scan: paging away must not remove its source
  // or restart a load when it comes back through the carousel.
  const [admission, setAdmission] = useState({ imageUrl, full: enabled, preview: previewEnabled, width });
  const current = admission.imageUrl === imageUrl ? admission : { imageUrl, full: false, preview: false, width };
  const full = current.full || enabled;
  const preview = current.preview || previewEnabled;
  const retainedWidth = enabled ? width : current.width;
  if (admission.imageUrl !== imageUrl || full !== current.full || preview !== current.preview || retainedWidth !== current.width) {
    setAdmission({ imageUrl, full, preview, width: retainedWidth });
  }
  // Cache growth must not change the hook's source identity mid-load.
  const midSrc = useMemo(() => imagePreloadService.availablePreview(imageUrl, retainedWidth), [imageUrl, retainedWidth]);
  return <ProgressiveImage {...props} preferNaturalAspectRatio containerRef={containerRef} enabled={full && physicalWidth > 0}
    previewSrc={preview ? getImageUrl(imageUrl, { width: 200 }) : undefined}
    midSrc={midSrc}
    src={getImageUrl(imageUrl, { width: retainedWidth })}
    thumbSrc={getImageUrl(imageUrl, { width: 32 })}
  />;
}
