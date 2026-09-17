import { imagePreloadService } from '../../services/imagePreloadService';
import { useRef } from 'react';
import { getImageUrl } from '../../api/client';
import { ProgressiveImage, type ProgressiveImageProps } from '../common/ProgressiveImage';
import { scanVariantWidth } from './scanResolution';
import { useScanDisplayWidth } from './useScanDisplayWidth';

/** Reader previews never fetch originals; the zoomable viewer owns that decision. */
export function ReaderScanImage({ imageUrl, enabled = true, ...props }: Omit<ProgressiveImageProps, 'src' | 'thumbSrc' | 'midSrc' | 'containerRef'> & { imageUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const physicalWidth = useScanDisplayWidth(containerRef, undefined, false, true);
  const width = scanVariantWidth(physicalWidth);
  return <ProgressiveImage {...props} preferNaturalAspectRatio containerRef={containerRef} enabled={enabled && physicalWidth > 0}
    midSrc={imagePreloadService.availablePreview(imageUrl, width)}
    src={getImageUrl(imageUrl, { width })}
    thumbSrc={getImageUrl(imageUrl, { width: 32 })}
  />;
}
