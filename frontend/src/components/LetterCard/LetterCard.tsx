import { memo } from "react";
import "../ArchiveList/ArchiveList.css";
import type { LetterCardData } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { getMediaLabel } from "../../utils/letterPreview";

interface LetterCardProps {
  card: LetterCardData;
  onClick: (id: string) => void;
}

function getCorrespondentLine(card: LetterCardData): string | undefined {
  const sender = card.sender?.trim();
  const recipient = card.recipient?.trim();
  if (sender && recipient) return `${sender} \u2192 ${recipient}`;
  return sender || recipient || undefined;
}

function LetterCard({
  card,
  onClick,
}: LetterCardProps) {
  const mediaLabel = getMediaLabel(card.imageType);
  const primaryChip = card.primaryChip;
  const date = card.date || card.dateRaw;
  const hook = card.hook?.trim();
  const peopleLine = getCorrespondentLine(card);
  const hasImage = Boolean(card.imageUrl);
  const fallbackLabel = date || mediaLabel;
  const ariaLabel = [
    mediaLabel,
    peopleLine,
    date,
    primaryChip,
    hook,
  ].filter((value): value is string => Boolean(value)).join(", ");

  return (
    <button
      type="button"
      className={`letter-card letter-card--${card.imageType}`}
      onClick={() => onClick(card.id)}
      aria-label={ariaLabel || `${mediaLabel}: ${card.title || "Unknown item"}`}
    >
      {hasImage ? (
        <img
          className="letter-card-image"
          src={card.imageUrl ? getImageUrl(card.imageUrl, { width: 720 }) : undefined}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="letter-card-fallback" aria-hidden="true">
          <span>{fallbackLabel}</span>
        </div>
      )}
      <div className="letter-card-overlay" />
      {primaryChip && <div className="letter-card-page-count">{primaryChip}</div>}
      <div className="letter-card-content">
        {peopleLine && <div className="letter-card-meta">{peopleLine}</div>}
        {date && <div className="letter-card-date">{date}</div>}
        {hook && <p className="letter-hook">{hook}</p>}
      </div>
    </button>
  );
}

export default memo(LetterCard);
