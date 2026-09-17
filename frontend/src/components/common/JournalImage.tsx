import { useState, type ImgHTMLAttributes } from 'react';
import { validImageDimensions } from '../../utils/journalImageDimensions';
import { journalImageSources } from '../../utils/journalImages';

export function JournalImage({ src, alt = '', ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError'> & { src: string }) {
  const sources = journalImageSources(src);
  const [recovery, setRecovery] = useState({ owner: src, original: false, failed: false });
  const current = recovery.owner === src ? recovery : { owner: src, original: false, failed: false };
  if (recovery.owner !== src) setRecovery(current);
  const dimensions = validImageDimensions({ width: Number(props.width), height: Number(props.height) });
  const style = dimensions && (props.title === 'float-left' || props.title === 'float-right')
    ? { ...props.style, width: `${dimensions.width}px` } : props.style;
  if (current.failed && dimensions) {
    const placeholder = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 100 100"><text x="50" y="50" text-anchor="middle" font-size="5">Image unavailable</text></svg>`;
    return <img {...props} style={style} alt={alt || 'Image unavailable'} src={`data:image/svg+xml,${encodeURIComponent(placeholder)}`} />;
  }
  if (current.failed) return <span role="img" aria-label={alt || 'Image unavailable'}>Image unavailable</span>;
  return <img {...props} style={style} alt={alt} decoding="async"
    src={current.original ? sources.original : sources.src}
    srcSet={current.original ? undefined : sources.srcSet}
    onError={() => setRecovery({ owner: src, original: true,
      failed: current.original || !sources.srcSet })}
  />;
}
