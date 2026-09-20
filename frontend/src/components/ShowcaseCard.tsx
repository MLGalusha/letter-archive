import { type MouseEvent as ReactMouseEvent } from 'react';
import CardCarousel from './CardCarousel';
import ImagePageControls from './ImagePageControls';
import CardMediaImages from './CardMediaImages';
import useMediaSelection from '../hooks/useMediaSelection';
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
  swipeImages?: boolean;
  onNavigate?: (letterId: string, imageId?: string) => void;
}

export default function ShowcaseCard({ items, onNavigate, swipeImages = false }: ShowcaseCardProps) {
  const { index, step, select } = useMediaSelection(items.map(item => `${item.letterId}:${item.imageId || item.imageUrl}`));
  const item = items[index];
  const hasMultiple = items.length > 1;

  if (!item) return null;

  const handlePrev = (e: ReactMouseEvent) => {
    e.stopPropagation();
    step(-1);
  };

  const handleNext = (e: ReactMouseEvent) => {
    e.stopPropagation();
    step(1);
  };

  const Content = onNavigate ? 'a' : 'div';
  const media = items.map(gi => ({ key: `${gi.letterId}:${gi.imageId || gi.imageUrl}`, imageUrl: gi.imageUrl, alt: gi.hook || gi.label }));
  const renderPage = (pageIndex: number) => {
    const item = items[pageIndex];
    const params = new URLSearchParams({ from: 'highlight' });
    if (item.imageId) params.set('image', item.imageId);
    return (
      <Content className={`cd-highlight-open-link${swipeImages ? " card-media-page" : ""}`} data-carousel-drag={onNavigate ? true : undefined} draggable={false}
        href={onNavigate ? `/letter/${item.letterId}?${params.toString()}` : undefined}
        aria-label={[item.label, item.peopleLine, item.date, item.hook].filter(Boolean).join(', ')}
        onClick={(event: ReactMouseEvent) => {
          if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onNavigate(item.letterId, item.imageId);
        }}
      >
      {(!swipeImages || Math.abs(pageIndex - index) <= 1) && (
        <CardMediaImages items={swipeImages ? [media[pageIndex]] : media}
          index={swipeImages ? 0 : index} className="cd-highlight-img" context="showcase" />
      )}
      {!item.imageUrl && <div className="cd-highlight-placeholder" />}
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
      </Content>
    );
  };
  return (
    <div className={`cd-highlight-card cd-highlight-card--${item.mediaType}`}>
      {swipeImages ? (
        <CardCarousel className="card-media-carousel" label="Highlight images" initialIndex={index} onSlideChange={select} showDots={false}>
          {items.map((entry, i) => <div key={`${entry.letterId}:${entry.imageId || entry.imageUrl}`} className={`card-media-page cd-highlight-card--${entry.mediaType}`}>{renderPage(i)}</div>)}
        </CardCarousel>
      ) : renderPage(index)}
      {hasMultiple && (
        <>
          <span className="cd-highlight-page-counter">
            {index + 1}/{items.length}
          </span>
          {!swipeImages && <ImagePageControls onPrevious={handlePrev} onNext={handleNext} previousLabel="Previous" nextLabel="Next" />}
        </>
      )}
    </div>
  );
}
