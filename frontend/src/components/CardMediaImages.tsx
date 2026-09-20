import { getImageUrl } from '../api/client';
import { ProgressiveImage } from './common';

export interface CardMediaImage { key: string; imageUrl: string; alt: string }
interface Props {
  items: CardMediaImage[];
  index: number;
  className: string;
  context: string;
  midWidth?: number;
}

/** Bounded to the selected scan and its two neighbors, including inner page-button wrapping. */
export default function CardMediaImages({ items, index, className, context, midWidth = 320 }: Props) {
  return items.map((item, i) => {
    if (!item.imageUrl || ![index, (index + 1) % items.length, (index + items.length - 1) % items.length].includes(i)) return null;
    const active = i === index;
    return (
      <div key={item.key} aria-hidden={!active || undefined} style={{ display: 'contents' }}>
        <ProgressiveImage className={className}
          src={getImageUrl(item.imageUrl, { width: 640 })}
          thumbSrc={getImageUrl(item.imageUrl, { width: 32 })}
          midSrc={getImageUrl(item.imageUrl, { width: midWidth })}
          alt={active ? item.alt : ''} loading={active ? 'eager' : 'lazy'}
          fetchPriority={active ? 'high' : 'low'} decoding="async" draggable={false}
          style={{ opacity: active ? 1 : 0, pointerEvents: active ? undefined : 'none' }}
          idleUpgrade context={context} />
      </div>
    );
  });
}
