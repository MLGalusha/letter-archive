import type { CollectionGroup } from "./types";

interface CollectionCardProps {
  collection: CollectionGroup;
  isSelected: boolean;
  editMode: boolean;
  onSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
}

export default function CollectionCard({
  collection,
  isSelected,
  editMode,
  onSelect,
  onClick,
  onDelete,
}: CollectionCardProps) {
  const handleClick = () => {
    if (editMode) {
      onSelect();
    } else {
      onClick();
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const letterCount = collection.letters.length;
  const letterText = letterCount === 1 ? "1 letter" : `${letterCount} letters`;

  return (
    <div
      className={`collection-card ${isSelected ? "selected" : ""}`}
      onClick={handleClick}
    >
      {!editMode && (
        <button className="delete-card-btn" onClick={handleDelete} title="Delete collection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
          </svg>
        </button>
      )}
      <div className="collection-code">Collection {collection.collectionCode}</div>
      <div className="collection-info">
        <span>{letterText}</span>
        <span>{collection.totalImages} images</span>
      </div>
      {isSelected && <div className="selected-badge">Selected</div>}
    </div>
  );
}
