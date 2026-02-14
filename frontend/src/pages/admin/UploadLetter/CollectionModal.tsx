import { useState } from "react";
import { getTypeName } from "../../../utils/filename-parser";
import type { CollectionGroup, LetterGroup, UploadedImage } from "./types";

interface CollectionModalProps {
  collection: CollectionGroup;
  onClose: () => void;
  onViewImage: (image: UploadedImage, allImages: UploadedImage[]) => void;
  onDeleteLetter: (letterKey: string, letterDate: string | null) => void;
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
  onClose,
  onViewImage,
  onDeleteLetter,
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

  const handleDeleteLetter = (e: React.MouseEvent, letter: LetterGroup) => {
    e.stopPropagation();
    onDeleteLetter(letter.letterKey, letter.letterDate);
  };

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
            {selectedLetter.images.map((img) => (
              <div
                key={img.id}
                className="letter-image-item"
                onClick={() => onViewImage(img, selectedLetter.images)}
              >
                <div className="image-type-badge">
                  {getTypeName(img.parsed?.type || "L")}
                </div>
                <div className="image-page-badge">{img.parsed?.pageNumber || 1}</div>
                <img src={img.url} alt={img.originalFilename} />
              </div>
            ))}
          </div>
        ) : (
          <div className="letter-grid">
            {collection.letters.map((letter) => (
              <div
                key={letter.letterKey}
                className="letter-card"
                onClick={() => setSelectedLetter(letter)}
              >
                <button
                  className="delete-letter-btn"
                  onClick={(e) => handleDeleteLetter(e, letter)}
                  title="Delete letter"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                  </svg>
                </button>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
