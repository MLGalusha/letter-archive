import { useRef } from 'react';
import { getImageUrl } from '../../api/client';
import { ProgressiveImage, type ProgressiveImageProps } from '../common/ProgressiveImage';
import { scanVariantWidth } from './scanResolution';
import { useScanDisplayWidth } from './useScanDisplayWidth';

/** Reader previews never fetch originals; the zoomable viewer owns that decision. */
export function ReaderScanImage({ imageUrl, ...props }: Omit<ProgressiveImageProps, 'src' | 'thumbSrc' | 'midSrc' | 'containerRef'> & { imageUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = scanVariantWidth(useScanDisplayWidth(containerRef, undefined, false, true));
  return <ProgressiveImage {...props} containerRef={containerRef}
    src={getImageUrl(imageUrl, { width })}
    thumbSrc={getImageUrl(imageUrl, { width: 32 })}
  />;
}
