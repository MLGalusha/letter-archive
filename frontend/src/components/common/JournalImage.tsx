import { useState, type ImgHTMLAttributes } from 'react';
import { journalImageSources } from '../../utils/journalImages';

export function JournalImage({ src, alt = '', ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'onError'> & { src: string }) {
  const sources = journalImageSources(src);
  const [recovery, setRecovery] = useState({ owner: src, original: false, failed: false });
  const current = recovery.owner === src ? recovery : { owner: src, original: false, failed: false };
  if (recovery.owner !== src) setRecovery(current);
  if (current.failed) return <span role="img" aria-label={alt || 'Image unavailable'}>Image unavailable</span>;
  return <img {...props} alt={alt} decoding="async"
    src={current.original ? sources.original : sources.src}
    srcSet={current.original ? undefined : sources.srcSet}
    onError={() => setRecovery({ owner: src, original: true,
      failed: current.original || !sources.srcSet })}
  />;
}
