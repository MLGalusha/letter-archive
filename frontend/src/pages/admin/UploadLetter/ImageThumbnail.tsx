import { useRef } from "react";
import { getTypeName } from "../../../utils/filename-parser";
import type { UploadedImage } from "./types";

interface ImageThumbnailProps {
  image: UploadedImage;
  isSelected: boolean;
  editMode: boolean;
  onSelect: () => void;
  onView: () => void;
  onDelete?: () => void;
}

export default function ImageThumbnail({
  image,
  isSelected,
  editMode,
  onSelect,
  onView,
  onDelete,
}: ImageThumbnailProps) {
  const lastTapRef = useRef<number>(0);

  const handleClick = () => {
    if (editMode) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        onView();
      } else {
        onSelect();
      }
      lastTapRef.current = now;
    } else {
      onView();
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  const typeName = image.parsed ? getTypeName(image.parsed.type) : null;

  const classNames = [
    "image-thumb",
    isSelected ? "selected" : "",
    image.isDuplicate ? "is-duplicate" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classNames}
      onClick={handleClick}
    >
      {!editMode && onDelete && (
        <button className="delete-thumb-btn" onClick={handleDelete} title="Delete image">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
          </svg>
        </button>
      )}
      {typeName && <div className="type-badge">{typeName}</div>}
      <img src={image.url} alt={image.originalFilename} />
      <div className="filename-badge">{image.originalFilename}</div>
      {isSelected && <div className="selected-check">✓</div>}
    </div>
  );
}
