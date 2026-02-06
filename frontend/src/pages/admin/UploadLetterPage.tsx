import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { uploadFiles } from "../../api/admin";
import {
  parseFilename,
  getTypeName,
  getFileExtension,
  type ParsedFilename,
} from "../../utils/filename-parser";
import "./UploadLetterPage.css";

// ============================================================================
// Types
// ============================================================================

interface UploadedImage {
  id: string;
  file: File;
  url: string;
  originalFilename: string;
  parsed: ParsedFilename | null;
}

interface LetterGroup {
  letterKey: string; // dateRaw, e.g., "18860314" or "XXXXXXXX"
  dateRaw: string;
  letterDate: string | null; // ISO date or null for unknown
  letterPageCount: number; // count of type L images
  extraCount: number; // count of non-L type images
  images: UploadedImage[];
}

interface CollectionGroup {
  collectionCode: string;
  letters: LetterGroup[];
  totalImages: number;
  dateRange: string;
}

interface EditState {
  active: boolean;
  selectedCollection: string | null; // collection code or 'new'
  selectedImageIds: Set<string>;
  newCollectionCode: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function groupImagesByCollection(images: UploadedImage[]): CollectionGroup[] {
  const collectionMap = new Map<string, UploadedImage[]>();

  // Group categorized images by collection
  for (const img of images) {
    if (img.parsed) {
      const code = img.parsed.collectionCode;
      const existing = collectionMap.get(code) || [];
      existing.push(img);
      collectionMap.set(code, existing);
    }
  }

  // Convert to CollectionGroup array
  const groups: CollectionGroup[] = [];
  for (const [collectionCode, imgs] of collectionMap) {
    // Group by dateRaw within collection (not by type+sequence)
    const letterMap = new Map<string, UploadedImage[]>();

    for (const img of imgs) {
      if (img.parsed) {
        const dateKey = img.parsed.dateRaw; // Group by date
        const existing = letterMap.get(dateKey) || [];
        existing.push(img);
        letterMap.set(dateKey, existing);
      }
    }

    // Build letters array
    const letters: LetterGroup[] = [];
    for (const [dateKey, letterImgs] of letterMap) {
      const firstParsed = letterImgs[0].parsed!;

      // Count letter pages vs extras
      const letterPageCount = letterImgs.filter(img => img.parsed?.type === 'L').length;
      const extraCount = letterImgs.length - letterPageCount;

      letters.push({
        letterKey: dateKey,
        dateRaw: dateKey,
        letterDate: firstParsed.letterDate,
        letterPageCount,
        extraCount,
        images: letterImgs.sort((a, b) => {
          // Sort by type first (L before others), then by sequence, then by page
          const aType = a.parsed?.type || 'Z';
          const bType = b.parsed?.type || 'Z';
          if (aType !== bType) {
            if (aType === 'L') return -1;
            if (bType === 'L') return 1;
            return aType.localeCompare(bType);
          }
          const aSeq = a.parsed?.typeSequence || 0;
          const bSeq = b.parsed?.typeSequence || 0;
          if (aSeq !== bSeq) return aSeq - bSeq;
          return (a.parsed?.pageNumber || 0) - (b.parsed?.pageNumber || 0);
        }),
      });
    }

    // Sort letters by date
    letters.sort((a, b) => a.dateRaw.localeCompare(b.dateRaw));

    // Calculate date range from letters
    let dateRange = "Unknown";
    const knownDates = letters
      .filter(l => l.letterDate !== null)
      .map(l => l.letterDate as string)
      .sort();
    if (knownDates.length > 0) {
      if (knownDates.length === 1) {
        dateRange = knownDates[0];
      } else {
        dateRange = `${knownDates[0]} - ${knownDates[knownDates.length - 1]}`;
      }
    }

    groups.push({
      collectionCode,
      letters,
      totalImages: imgs.length,
      dateRange,
    });
  }

  // Sort by collection code
  return groups.sort((a, b) => a.collectionCode.localeCompare(b.collectionCode));
}

function getNextCollectionCode(collections: CollectionGroup[]): string {
  if (collections.length === 0) return "001";
  const maxCode = Math.max(...collections.map((c) => parseInt(c.collectionCode, 10)));
  return String(maxCode + 1).padStart(3, "0");
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function generateNewFilename(
  originalFilename: string,
  collectionCode: string,
  type: string,
  typeSequence: number,
  pageNumber: number
): string {
  const ext = getFileExtension(originalFilename);
  const typeSeq = String(typeSequence).padStart(2, "0");
  const page = String(pageNumber).padStart(2, "0");
  return `${collectionCode}-XXXXXXXX-${type}${typeSeq}-${page}.${ext}`;
}

// ============================================================================
// Sub-Components
// ============================================================================

interface ImageThumbnailProps {
  image: UploadedImage;
  isSelected: boolean;
  editMode: boolean;
  onSelect: () => void;
  onView: () => void;
}

function ImageThumbnail({ image, isSelected, editMode, onSelect, onView }: ImageThumbnailProps) {
  const lastTapRef = useRef<number>(0);

  const handleClick = () => {
    if (editMode) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        // Double tap - view image
        onView();
      } else {
        // Single tap - select
        onSelect();
      }
      lastTapRef.current = now;
    } else {
      onView();
    }
  };

  const typeName = image.parsed ? getTypeName(image.parsed.type) : null;

  return (
    <div
      className={`image-thumb ${isSelected ? "selected" : ""}`}
      onClick={handleClick}
    >
      {typeName && <div className="type-badge">{typeName}</div>}
      <img src={image.url} alt={image.originalFilename} />
      <div className="filename-badge">{image.originalFilename}</div>
      {isSelected && <div className="selected-check">✓</div>}
    </div>
  );
}

interface CollectionCardProps {
  collection: CollectionGroup;
  isSelected: boolean;
  editMode: boolean;
  onSelect: () => void;
  onClick: () => void;
}

function CollectionCard({ collection, isSelected, editMode, onSelect, onClick }: CollectionCardProps) {
  const handleClick = () => {
    if (editMode) {
      onSelect();
    } else {
      onClick();
    }
  };

  const letterCount = collection.letters.length;
  const letterText = letterCount === 1 ? "1 letter" : `${letterCount} letters`;

  return (
    <div
      className={`collection-card ${isSelected ? "selected" : ""}`}
      onClick={handleClick}
    >
      <div className="collection-code">Collection {collection.collectionCode}</div>
      <div className="collection-info">
        <span>{letterText}</span>
        <span>{collection.totalImages} images</span>
      </div>
      {isSelected && <div className="selected-badge">Selected</div>}
    </div>
  );
}

interface CollectionModalProps {
  collection: CollectionGroup;
  onClose: () => void;
  onViewImage: (image: UploadedImage) => void;
}

function CollectionModal({ collection, onClose, onViewImage }: CollectionModalProps) {
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

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="modal-content">
        <div className="modal-header">
          <h2>
            {selectedLetter
              ? (selectedLetter.letterDate ? formatDate(selectedLetter.letterDate) : 'Unknown Date')
              : `Collection ${collection.collectionCode}`}
          </h2>
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
              <div key={img.id} className="letter-image-item" onClick={() => onViewImage(img)}>
                <div className="image-type-badge">{getTypeName(img.parsed?.type || 'L')}</div>
                <img src={img.url} alt={img.originalFilename} />
                <div className="image-page">
                  Page {img.parsed?.pageNumber || 1}
                </div>
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
                <div className="letter-card-date">
                  {letter.letterDate ? formatDate(letter.letterDate) : 'Unknown Date'}
                </div>
                <div className="letter-card-counts">
                  {letter.letterPageCount > 0 && (
                    <span>{letter.letterPageCount} letter{letter.letterPageCount !== 1 ? 's' : ''}</span>
                  )}
                  {letter.extraCount > 0 && (
                    <span>{letter.extraCount} extra{letter.extraCount !== 1 ? 's' : ''}</span>
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

interface LightboxProps {
  image: UploadedImage;
  onClose: () => void;
}

function Lightbox({ image, onClose }: LightboxProps) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>×</button>
        <img src={image.url} alt={image.originalFilename} />
        <div className="lightbox-filename">{image.originalFilename}</div>
      </div>
    </div>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination-controls">
      <button
        className="page-btn"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        Previous
      </button>
      <span className="page-info">
        Page {currentPage} of {totalPages}
      </span>
      <button
        className="page-btn"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
      </button>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function UploadLetterPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // State
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [editState, setEditState] = useState<EditState>({
    active: false,
    selectedCollection: null,
    selectedImageIds: new Set(),
    newCollectionCode: "001",
  });
  const [uncategorizedPage, setUncategorizedPage] = useState(1);
  const [openCollection, setOpenCollection] = useState<CollectionGroup | null>(null);
  const [lightboxImage, setLightboxImage] = useState<UploadedImage | null>(null);

  const ITEMS_PER_PAGE = 8;

  // Auth check
  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.url));
    };
  }, []);

  // Computed values
  const collections = useMemo(() => groupImagesByCollection(images), [images]);

  const uncategorizedImages = useMemo(
    () => images.filter((img) => !img.parsed),
    [images]
  );

  const uncategorizedTotalPages = Math.ceil(uncategorizedImages.length / ITEMS_PER_PAGE);

  const paginatedUncategorized = useMemo(() => {
    const start = (uncategorizedPage - 1) * ITEMS_PER_PAGE;
    return uncategorizedImages.slice(start, start + ITEMS_PER_PAGE);
  }, [uncategorizedImages, uncategorizedPage]);

  // Update next collection code when collections change
  useEffect(() => {
    const nextCode = getNextCollectionCode(collections);
    setEditState((prev) => ({ ...prev, newCollectionCode: nextCode }));
  }, [collections]);

  // Handlers
  const handleFilesSelected = useCallback((files: FileList | null) => {
    if (!files) return;

    const newImages: UploadedImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;

      const parsed = parseFilename(file.name);
      newImages.push({
        id: generateId(),
        file,
        url: URL.createObjectURL(file),
        originalFilename: file.name,
        parsed,
      });
    }

    setImages((prev) => [...prev, ...newImages]);
    setMessage("");
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesSelected(e.target.files);
    e.target.value = ""; // Reset input
  };

  const handleSelectFiles = () => {
    fileInputRef.current?.click();
  };

  const handleSelectFolder = () => {
    folderInputRef.current?.click();
  };

  const toggleEditMode = () => {
    setEditState((prev) => ({
      ...prev,
      active: !prev.active,
      selectedCollection: null,
      selectedImageIds: new Set(),
    }));
  };

  const handleCollectionSelect = (collectionCode: string) => {
    setEditState((prev) => ({
      ...prev,
      selectedCollection: prev.selectedCollection === collectionCode ? null : collectionCode,
    }));
  };

  const handleNewCollectionSelect = () => {
    setEditState((prev) => ({
      ...prev,
      selectedCollection: prev.selectedCollection === "new" ? null : "new",
    }));
  };

  const handleImageSelect = (imageId: string) => {
    setEditState((prev) => {
      const newSelected = new Set(prev.selectedImageIds);
      if (newSelected.has(imageId)) {
        newSelected.delete(imageId);
      } else {
        newSelected.add(imageId);
      }
      return { ...prev, selectedImageIds: newSelected };
    });
  };

  const handleNewCollectionCodeChange = (code: string) => {
    // Only allow 3 digit numbers
    const sanitized = code.replace(/\D/g, "").slice(0, 3);
    setEditState((prev) => ({ ...prev, newCollectionCode: sanitized }));
  };

  const handleAddToCollection = () => {
    if (editState.selectedImageIds.size === 0) return;

    const collectionCode =
      editState.selectedCollection === "new"
        ? editState.newCollectionCode.padStart(3, "0")
        : editState.selectedCollection;

    if (!collectionCode) return;

    // Determine type and sequence - always L01 for new uploads
    const type = "L";
    const typeSequence = 1;

    // Determine starting page number
    // When adding to existing collection, find max page for XXXXXXXX date with L type
    let pageNumber = 1;
    if (editState.selectedCollection !== "new") {
      const collection = collections.find((c) => c.collectionCode === collectionCode);
      if (collection) {
        // Find the XXXXXXXX letter if it exists
        const unknownDateLetter = collection.letters.find((l) => l.dateRaw === 'XXXXXXXX');
        if (unknownDateLetter) {
          // Find max page number for L type images
          const lImages = unknownDateLetter.images.filter(img => img.parsed?.type === 'L');
          if (lImages.length > 0) {
            pageNumber = Math.max(...lImages.map(img => img.parsed?.pageNumber || 0)) + 1;
          }
        }
      }
    }

    // Update images with new filenames and parsed data
    setImages((prev) =>
      prev.map((img) => {
        if (!editState.selectedImageIds.has(img.id)) return img;

        const newFilename = generateNewFilename(
          img.originalFilename,
          collectionCode,
          type,
          typeSequence,
          pageNumber++
        );

        const newParsed = parseFilename(newFilename);

        return {
          ...img,
          originalFilename: newFilename,
          parsed: newParsed,
        };
      })
    );

    // Reset edit state
    setEditState((prev) => ({
      ...prev,
      selectedCollection: null,
      selectedImageIds: new Set(),
    }));
  };

  const handleSubmit = async () => {
    if (images.length === 0) {
      setMessage("Please select at least one image");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      // Create File objects with new names for categorized images
      const filesToUpload = images.map((img) => {
        if (img.originalFilename !== img.file.name) {
          // Rename the file
          return new File([img.file], img.originalFilename, { type: img.file.type });
        }
        return img.file;
      });

      const response = await uploadFiles(filesToUpload);

      if (response.failed > 0 && response.errors) {
        const errorMessages = response.errors.map((e) => e.error).join(", ");
        setMessage(`Uploaded ${response.success} files. ${response.failed} failed: ${errorMessages}`);
      } else {
        setMessage(`Successfully uploaded ${response.success} files.`);
        setTimeout(() => navigate("/admin"), 1500);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    navigate("/admin");
  };

  const canAdd =
    editState.selectedImageIds.size > 0 &&
    (editState.selectedCollection !== null ||
      (editState.selectedCollection === "new" && editState.newCollectionCode.length > 0));

  return (
    <div className={`upload-letter-page ${editState.active ? "edit-mode" : ""}`}>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInputChange}
        className="hidden-input"
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        // @ts-expect-error webkitdirectory is not in standard types
        webkitdirectory=""
        onChange={handleFileInputChange}
        className="hidden-input"
      />

      {/* Header */}
      <header className="upload-header">
        <h1>Upload Letters</h1>

        {/* Edit mode controls - inline in header when active */}
        {editState.active && (
          <div className="header-edit-controls">
            <span className="edit-status">
              {editState.selectedImageIds.size} selected
            </span>
            {editState.selectedCollection === "new" && (
              <div className="new-collection-input">
                <label>Collection #:</label>
                <input
                  type="text"
                  value={editState.newCollectionCode}
                  onChange={(e) => handleNewCollectionCodeChange(e.target.value)}
                  placeholder="001"
                  maxLength={3}
                />
              </div>
            )}
            <button
              className="add-btn"
              disabled={!canAdd}
              onClick={handleAddToCollection}
            >
              Add to Collection
            </button>
          </div>
        )}

        <div className="header-actions">
          {images.length > 0 && (
            <button
              onClick={toggleEditMode}
              className={`edit-toggle ${editState.active ? "active" : ""}`}
            >
              {editState.active ? "Done Editing" : "Edit"}
            </button>
          )}
          <button onClick={handleCancel} className="cancel-button">
            Back to Dashboard
          </button>
        </div>
      </header>

      <div className="upload-content">
        {/* Upload Section */}
        <div className="upload-input-section">
          <h2>Select Images</h2>
          <div className="upload-buttons">
            <button onClick={handleSelectFiles} className="upload-btn">
              Select Files
            </button>
            <button onClick={handleSelectFolder} className="upload-btn">
              Select Folder
            </button>
          </div>
        </div>

        {images.length === 0 ? (
          <div className="empty-state">
            <p>No images uploaded yet. Select files or a folder to begin.</p>
          </div>
        ) : (
          <>
            {/* Collections Section */}
            {collections.length > 0 && (
              <div className="collections-section">
                <h2>Collections ({collections.length})</h2>
                <div className="collection-grid">
                  {collections.map((collection) => (
                    <CollectionCard
                      key={collection.collectionCode}
                      collection={collection}
                      isSelected={editState.selectedCollection === collection.collectionCode}
                      editMode={editState.active}
                      onSelect={() => handleCollectionSelect(collection.collectionCode)}
                      onClick={() => setOpenCollection(collection)}
                    />
                  ))}
                  {editState.active && (
                    <div
                      className={`collection-card new-collection ${editState.selectedCollection === "new" ? "selected" : ""}`}
                      onClick={handleNewCollectionSelect}
                    >
                      <div className="new-collection-icon">+</div>
                      <div className="collection-code">New Collection</div>
                      {editState.selectedCollection === "new" && (
                        <div className="selected-badge">Selected</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* New Collection Card (when no collections exist but in edit mode) */}
            {collections.length === 0 && editState.active && (
              <div className="collections-section">
                <h2>Collections</h2>
                <div className="collection-grid">
                  <div
                    className={`collection-card new-collection ${editState.selectedCollection === "new" ? "selected" : ""}`}
                    onClick={handleNewCollectionSelect}
                  >
                    <div className="new-collection-icon">+</div>
                    <div className="collection-code">New Collection</div>
                    {editState.selectedCollection === "new" && (
                      <div className="selected-badge">Selected</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Uncategorized Section */}
            {uncategorizedImages.length > 0 && (
              <div className="uncategorized-section">
                <h2>Uncategorized ({uncategorizedImages.length})</h2>
                <div className="uncategorized-grid">
                  {paginatedUncategorized.map((image) => (
                    <ImageThumbnail
                      key={image.id}
                      image={image}
                      isSelected={editState.selectedImageIds.has(image.id)}
                      editMode={editState.active}
                      onSelect={() => handleImageSelect(image.id)}
                      onView={() => setLightboxImage(image)}
                    />
                  ))}
                </div>
                <Pagination
                  currentPage={uncategorizedPage}
                  totalPages={uncategorizedTotalPages}
                  onPageChange={setUncategorizedPage}
                />
              </div>
            )}

            {/* Message */}
            {message && (
              <div className={`message ${message.includes("Successfully") ? "success" : "error"}`}>
                {message}
              </div>
            )}

            {/* Actions */}
            <div className="upload-actions">
              <button onClick={handleCancel} className="cancel-action-button">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={uploading || images.length === 0}
                className="submit-button"
              >
                {uploading ? "Uploading..." : "Upload All"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Collection Modal */}
      {openCollection && (
        <CollectionModal
          collection={openCollection}
          onClose={() => setOpenCollection(null)}
          onViewImage={setLightboxImage}
        />
      )}

      {/* Lightbox */}
      {lightboxImage && (
        <Lightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
}
