import type { CollectionGroup } from "./types";

interface CollectionCardProps {
  collection: CollectionGroup;
  isSelected: boolean;
  editMode: boolean;
  deletionMode: boolean;
  hasDuplicates: boolean;
  isMarkedForDeletion: boolean;
  isPartialDeletion: boolean;
  onSelect: () => void;
  onClick: () => void;
  onToggleDeletion: () => void;
}

export default function CollectionCard({
  collection,
  isSelected,
  editMode,
  deletionMode,
  hasDuplicates,
  isMarkedForDeletion,
  isPartialDeletion,
  onSelect,
  onClick,
  onToggleDeletion,
}: CollectionCardProps) {
  const handleClick = () => {
    if (editMode) {
      onSelect();
    } else {
      onClick();
    }
  };

  const handleToggleDeletion = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleDeletion();
  };

  const letterCount = collection.letters.length;
  const letterText = letterCount === 1 ? "1 letter" : `${letterCount} letters`;

  const classNames = [
    "collection-card",
    isSelected ? "selected" : "",
    hasDuplicates ? "has-duplicates" : "",
    isMarkedForDeletion ? "marked-for-deletion" : "",
    isPartialDeletion ? "partial-deletion" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={classNames} onClick={handleClick}>
      {deletionMode && (
        <div
          className={`deletion-tab ${isMarkedForDeletion ? "marked" : ""}`}
          onClick={handleToggleDeletion}
        />
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
