import { useRef } from "react";
import { getTypeName } from "../../../utils/filename-parser";
import type { UploadedImage } from "./types";

interface ImageThumbnailProps {
  image: UploadedImage;
  isSelected: boolean;
  editMode: boolean;
  deletionMode: boolean;
  isMarkedForDeletion: boolean;
  onSelect: () => void;
  onView: () => void;
  onToggleDeletion: () => void;
}

export default function ImageThumbnail({
  image,
  isSelected,
  editMode,
  deletionMode,
  isMarkedForDeletion,
  onSelect,
  onView,
  onToggleDeletion,
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

  const handleToggleDeletion = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleDeletion();
  };

  const typeName = image.parsed ? getTypeName(image.parsed.type) : null;

  const classNames = [
    "image-thumb",
    isSelected ? "selected" : "",
    image.isDuplicate ? "is-duplicate" : "",
    isMarkedForDeletion ? "marked-for-deletion" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classNames}
      onClick={handleClick}
    >
      {deletionMode && (
        <div
          className={`deletion-tab ${isMarkedForDeletion ? "marked" : ""}`}
          onClick={handleToggleDeletion}
        />
      )}
      {typeName && <div className="type-badge">{typeName}</div>}
      <img src={image.url} alt={image.originalFilename} />
      <div className="filename-badge">{image.originalFilename}</div>
      {isSelected && <div className="selected-check">✓</div>}
    </div>
  );
}
