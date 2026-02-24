import { useState } from "react";
import { getTypeName } from "../../../utils/filename-parser";
import type { CollectionGroup, LetterGroup, UploadedImage } from "./types";

interface CollectionModalProps {
  collection: CollectionGroup;
  deletionMode: boolean;
  deletionImageIds: Set<string>;
  onClose: () => void;
  onViewImage: (image: UploadedImage, allImages: UploadedImage[]) => void;
  onToggleDeletionLetter: (collectionCode: string, letterKey: string) => void;
  onToggleDeletionImage: (id: string) => void;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function CollectionModal({
  collection,
  deletionMode,
  deletionImageIds,
  onClose,
  onViewImage,
  onToggleDeletionLetter,
  onToggleDeletionImage,
}: CollectionModalProps) {
  const [selectedLetter, setSelectedLetter] = useState<LetterGroup | null>(null);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      if (selectedLetter) {
        setSelectedLetter(null);
      } else {
        onClose();
      }
    }
  };

  const handleToggleLetterDeletion = (e: React.MouseEvent, letter: LetterGroup) => {
    e.stopPropagation();
    onToggleDeletionLetter(collection.collectionCode, letter.letterKey);
  };

  const handleToggleImageDeletion = (e: React.MouseEvent, imgId: string) => {
    e.stopPropagation();
    onToggleDeletionImage(imgId);
  };

  const isLetterMarked = (letter: LetterGroup) =>
    letter.images.length > 0 && letter.images.every(img => deletionImageIds.has(img.id));

  const isLetterPartial = (letter: LetterGroup) =>
    letter.images.some(img => deletionImageIds.has(img.id)) && !isLetterMarked(letter);

  // Sort letters: letters with any non-duplicate first, all-duplicate letters after
  const sortedLetters = [...collection.letters].sort((a, b) => {
    const aAllDup = a.images.length > 0 && a.images.every(img => img.isDuplicate);
    const bAllDup = b.images.length > 0 && b.images.every(img => img.isDuplicate);
    if (!aAllDup && bAllDup) return -1;
    if (aAllDup && !bAllDup) return 1;
    return 0;
  });

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>Collection {collection.collectionCode}</h2>
            {selectedLetter && (
              <span className="modal-subtitle">
                {selectedLetter.letterDate
                  ? formatDate(selectedLetter.letterDate)
                  : "Unknown Date"}
              </span>
            )}
          </div>
          <button
            className="modal-close"
            onClick={() => (selectedLetter ? setSelectedLetter(null) : onClose())}
          >
            {selectedLetter ? "← Back" : "×"}
          </button>
        </div>

        {selectedLetter ? (
          <div className="letter-images">
            {selectedLetter.images.map((img) => {
              const imgMarked = deletionImageIds.has(img.id);
              return (
                <div
                  key={img.id}
                  className={`letter-image-item ${img.isDuplicate ? "is-duplicate" : ""} ${imgMarked ? "marked-for-deletion" : ""}`}
                  onClick={() => onViewImage(img, selectedLetter.images)}
                >
                  {deletionMode && (
                    <div
                      className={`deletion-tab ${imgMarked ? "marked" : ""}`}
                      onClick={(e) => handleToggleImageDeletion(e, img.id)}
                    />
                  )}
                  <div className="image-type-badge">
                    {getTypeName(img.parsed?.type || "L")}
                  </div>
                  <div className="image-page-badge">{img.parsed?.pageNumber || 1}</div>
                  <img src={img.url} alt={img.originalFilename} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="letter-grid">
            {sortedLetters.map((letter) => {
              const allDup = letter.images.length > 0 && letter.images.every(img => img.isDuplicate);
              const marked = isLetterMarked(letter);
              const partial = isLetterPartial(letter);

              const classNames = [
                "letter-card",
                allDup ? "is-duplicate" : "",
                marked ? "marked-for-deletion" : "",
                partial ? "partial-deletion" : "",
              ].filter(Boolean).join(" ");

              return (
                <div
                  key={letter.letterKey}
                  className={classNames}
                  onClick={() => setSelectedLetter(letter)}
                >
                  {deletionMode && (
                    <div
                      className={`deletion-tab ${marked ? "marked" : ""}`}
                      onClick={(e) => handleToggleLetterDeletion(e, letter)}
                    />
                  )}
                  <div className="letter-card-date">
                    {letter.letterDate ? formatDate(letter.letterDate) : "Unknown Date"}
                  </div>
                  <div className="letter-card-counts">
                    {letter.letterPageCount > 0 && (
                      <span>
                        {letter.letterPageCount} letter
                        {letter.letterPageCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {letter.extraCount > 0 && (
                      <span>
                        {letter.extraCount} extra
                        {letter.extraCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
