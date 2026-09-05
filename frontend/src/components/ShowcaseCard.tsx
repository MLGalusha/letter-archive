import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getImageUrl } from '../api/client';
import { ProgressiveImage } from './common';
import type { LetterImageType } from '../types/Letter';
import './ShowcaseCard.css';

export interface ShowcaseItem {
  letterId: string;
  imageId?: string;
  imageUrl: string;
  label: string;
  peopleLine: string;
  date: string;
  hook: string;
  mediaType: LetterImageType;
}

interface ShowcaseCardProps {
  items: ShowcaseItem[];
  onNavigate: (letterId: string, imageId?: string) => void;
  onInteraction?: () => void;
}

export default function ShowcaseCard({ items, onNavigate, onInteraction }: ShowcaseCardProps) {
  const [index, setIndex] = useState(0);
  const item = items[index];
  const hasMultiple = items.length > 1;

  if (!item) return null;

  const handlePrev = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setIndex((i) => (i === 0 ? items.length - 1 : i - 1));
    onInteraction?.();
  };

  const handleNext = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setIndex((i) => (i === items.length - 1 ? 0 : i + 1));
    onInteraction?.();
  };

  return (
    <button
      type="button"
      className={`cd-highlight-card cd-highlight-card--${item.mediaType}`}
      onClick={() => onNavigate(item.letterId, item.imageId)}
    >
      {items.map((gi, idx) => (
        idx === index && gi.imageUrl ? (
          <ProgressiveImage
            key={gi.imageId || idx}
            className="cd-highlight-img"
            src={getImageUrl(gi.imageUrl, { width: 640 })}
            thumbSrc={getImageUrl(gi.imageUrl, { width: 32 })}
            midSrc={getImageUrl(gi.imageUrl, { width: 320 })}
            alt={idx === index ? (gi.hook || gi.label) : ''}
            loading="eager"
            fetchPriority="high"
            style={{ opacity: idx === index ? 1 : 0 }}
            idleUpgrade
            context="showcase"
          />
        ) : null
      ))}
      {items.every((gi) => !gi.imageUrl) && (
        <div className="cd-highlight-placeholder" />
      )}
      <div className="cd-highlight-overlay" />
      <span className="cd-highlight-label">{item.label}</span>
      <div className="cd-highlight-content">
        {item.peopleLine && (
          <span className="cd-highlight-meta">{item.peopleLine}</span>
        )}
        {item.date && (
          <span className="cd-highlight-date">{item.date}</span>
        )}
        {item.hook && (
          <p className="cd-highlight-hook">{item.hook}</p>
        )}
      </div>
      {hasMultiple && (
        <>
          <span className="cd-highlight-page-counter">
            {index + 1}/{items.length}
          </span>
          <div
            className="cd-highlight-zone cd-highlight-zone--prev"
            onClick={handlePrev}
            aria-label="Previous"
          />
          <div
            className="cd-highlight-zone cd-highlight-zone--next"
            onClick={handleNext}
            aria-label="Next"
          />
        </>
      )}
    </button>
  );
}
