import { memo } from "react";
import "../ArchiveList/ArchiveList.css";
import type { Letter } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import {
  getLetterMediaChips,
  getMediaLabel,
  getPrimaryImage,
  getPrimaryMediaType,
} from "../../utils/letterPreview";

interface LetterCardProps {
  letter: Letter;
  onClick: (id: string) => void;
}

function getCorrespondentLine(letter: Letter): string | undefined {
  const sender = letter.metadata.sender?.trim();
  const recipient = letter.metadata.recipient?.trim();
  if (sender && recipient) return `${sender} \u2192 ${recipient}`;
  return sender || recipient || undefined;
}

function LetterCard({
  letter,
  onClick,
}: LetterCardProps) {
  const primaryImage = getPrimaryImage(letter);
  const primaryType = getPrimaryMediaType(letter);
  const mediaLabel = getMediaLabel(primaryType);
  const mediaChips = getLetterMediaChips(letter);
  const primaryChip = mediaChips[0];
  const date = letter.metadata.date || letter.metadata.dateRaw;
  const hook = letter.metadata.hook?.trim();
  const peopleLine = getCorrespondentLine(letter);
  const hasImage = Boolean(primaryImage?.imageUrl);
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
      className={`letter-card letter-card--${primaryType}`}
      onClick={() => onClick(letter.id)}
      aria-label={ariaLabel || `${mediaLabel}: ${letter.title || "Unknown item"}`}
    >
      {hasImage ? (
        <img
          className="letter-card-image"
          src={primaryImage ? getImageUrl(primaryImage.imageUrl) : undefined}
          alt=""
          loading="lazy"
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
