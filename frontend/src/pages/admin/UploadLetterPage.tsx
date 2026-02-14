import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { uploadFiles, type UploadResult, type UploadError } from "../../api/admin";
import {
  parseFilename,
  getFileExtension,
} from "../../utils/filename-parser";
import { Button, ConfirmDialog } from "../../components/common";
import AdminLayout from "../../components/AdminLayout/AdminLayout";
import CollectionCard from "./UploadLetter/CollectionCard";
import CollectionModal from "./UploadLetter/CollectionModal";
import Lightbox from "./UploadLetter/Lightbox";
import UncategorizedCarousel from "./UploadLetter/UncategorizedCarousel";
import type {
  UploadedImage,
  LetterGroup,
  CollectionGroup,
  EditState,
  LightboxState,
} from "./UploadLetter/types";
import "./UploadLetterPage.css";

// ============================================================================
// Types
// ============================================================================

interface UploadProgress {
  current: number;
  total: number;
  collectionCode: string;
}

interface UploadResultsState {
  uploaded: UploadResult[];    // new files successfully uploaded
  existing: UploadResult[];    // files that already exist (need confirmation)
  replaced: UploadResult[];    // files that were force-replaced
  skipped: UploadResult[];     // files user declined to replace
  failed: UploadError[];       // errors
  show: boolean;               // whether to show results panel
}

interface ConfirmDialogState {
  show: boolean;
  files: File[];               // files to re-upload with force
  filenames: string[];         // display names
}

interface UploadBannerState {
  show: boolean;
  fileCount: number;
  totalSize: string;
  collectionCount: number;
  replacedCount: number;
  skippedCount: number;
}

interface DeleteDialogState {
  show: boolean;
  type: 'collection' | 'letter' | 'image';
  collectionCode: string;
  letterKey?: string;
  imageId?: string;
  itemName: string;
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
    // Group by dateRaw and typeSequence within collection
    // L01 and L02 on the same date are separate letters
    // C01/E01 belong with L01, C02/E02 belong with L02, etc.
    const letterMap = new Map<string, UploadedImage[]>();

    for (const img of imgs) {
      if (img.parsed) {
        // typeSequence indicates which letter this belongs to
        // e.g., L01, C01, E01 all belong to letter 01
        const dateKey = `${img.parsed.dateRaw}-${String(img.parsed.typeSequence).padStart(2, "0")}`;
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
      const letterPageCount = letterImgs.filter(
        (img) => img.parsed?.type === "L",
      ).length;
      const extraCount = letterImgs.length - letterPageCount;

      letters.push({
        letterKey: dateKey,
        dateRaw: dateKey,
        letterDate: firstParsed.letterDate,
        letterPageCount,
        extraCount,
        images: letterImgs.sort((a, b) => {
          // Sort by type first (L before others), then by sequence, then by page
          const aType = a.parsed?.type || "Z";
          const bType = b.parsed?.type || "Z";
          if (aType !== bType) {
            if (aType === "L") return -1;
            if (bType === "L") return 1;
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
      .filter((l) => l.letterDate !== null)
      .map((l) => l.letterDate as string)
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
  return groups.sort((a, b) =>
    a.collectionCode.localeCompare(b.collectionCode),
  );
}

function getNextCollectionCode(collections: CollectionGroup[]): string {
  if (collections.length === 0) return "001";
  const maxCode = Math.max(
    ...collections.map((c) => parseInt(c.collectionCode, 10)),
  );
  return String(maxCode + 1).padStart(3, "0");
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function generateNewFilename(
  originalFilename: string,
  collectionCode: string,
  type: string,
  typeSequence: number,
  pageNumber: number,
): string {
  const ext = getFileExtension(originalFilename);
  const typeSeq = String(typeSequence).padStart(2, "0");
  const page = String(pageNumber).padStart(2, "0");
  return `${collectionCode}-XXXXXXXX-${type}${typeSeq}-${page}.${ext}`;
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
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [message, setMessage] = useState("");
  const [editState, setEditState] = useState<EditState>({
    active: false,
    selectedCollection: null,
    selectedImageIds: new Set(),
    newCollectionCode: "001",
  });
  const [openCollection, setOpenCollection] = useState<CollectionGroup | null>(
    null,
  );
  const [lightboxState, setLightboxState] = useState<LightboxState | null>(
    null,
  );
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResultsState>({
    uploaded: [],
    existing: [],
    replaced: [],
    skipped: [],
    failed: [],
    show: false,
  });
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    show: false,
    files: [],
    filenames: [],
  });
  const [uploadBanner, setUploadBanner] = useState<UploadBannerState>({
    show: false,
    fileCount: 0,
    totalSize: "0 B",
    collectionCount: 0,
    replacedCount: 0,
    skippedCount: 0,
  });
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    show: false,
    type: 'collection',
    collectionCode: '',
    itemName: '',
  });
  const [pendingUploadStats, setPendingUploadStats] = useState<{
    fileCount: number;
    totalSize: number;
    collectionCount: number;
  } | null>(null);

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
    [images],
  );

  const stats = useMemo(() => {
    const totalLetters = collections.reduce((sum, c) => sum + c.letters.length, 0);
    const totalImages = collections.reduce((sum, c) => sum + c.totalImages, 0);
    return {
      collections: collections.length,
      letters: totalLetters,
      images: totalImages,
      uncategorized: uncategorizedImages.length,
    };
  }, [collections, uncategorizedImages]);

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
      selectedCollection:
        prev.selectedCollection === collectionCode ? null : collectionCode,
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
      const collection = collections.find(
        (c) => c.collectionCode === collectionCode,
      );
      if (collection) {
        // Find the XXXXXXXX letter if it exists
        const unknownDateLetter = collection.letters.find(
          (l) => l.dateRaw === "XXXXXXXX",
        );
        if (unknownDateLetter) {
          // Find max page number for L type images
          const lImages = unknownDateLetter.images.filter(
            (img) => img.parsed?.type === "L",
          );
          if (lImages.length > 0) {
            pageNumber =
              Math.max(...lImages.map((img) => img.parsed?.pageNumber || 0)) +
              1;
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
          pageNumber++,
        );

        const newParsed = parseFilename(newFilename);

        return {
          ...img,
          originalFilename: newFilename,
          parsed: newParsed,
        };
      }),
    );

    // Reset edit state
    setEditState((prev) => ({
      ...prev,
      selectedCollection: null,
      selectedImageIds: new Set(),
    }));
  };

  const handleSubmit = async (force = false) => {
    // Only upload categorized files - uncategorized stay in the carousel
    if (collections.length === 0) {
      setMessage("No categorized images to upload. Use Edit mode to organize images first.");
      return;
    }

    setUploading(true);
    setMessage("");
    setUploadBanner(prev => ({ ...prev, show: false }));

    const allUploaded: UploadResult[] = [];
    const allExisting: UploadResult[] = [];
    const allFailed: UploadError[] = [];
    const filesToReupload: File[] = [];
    let totalBytes = 0;

    // Upload each collection as a batch
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      setUploadProgress({
        current: i + 1,
        total: collections.length,
        collectionCode: collection.collectionCode,
      });

      // Get files for this collection
      const collectionFiles = collection.letters.flatMap((letter) =>
        letter.images.map((img) => {
          if (img.originalFilename !== img.file.name) {
            return new File([img.file], img.originalFilename, {
              type: img.file.type,
            });
          }
          return img.file;
        }),
      );

      // Track total size
      collectionFiles.forEach(f => totalBytes += f.size);

      try {
        const response = await uploadFiles(collectionFiles, force);

        // Categorize results
        for (const result of response.results) {
          if (result.alreadyExists && !force) {
            allExisting.push(result);
            // Find the file to potentially re-upload
            const file = collectionFiles.find(f => f.name === result.filename);
            if (file) filesToReupload.push(file);
          } else {
            allUploaded.push(result);
          }
        }

        if (response.errors) {
          allFailed.push(...response.errors);
        }
      } catch (err) {
        // Add all files as failed if batch upload fails
        collectionFiles.forEach(f => {
          allFailed.push({
            filename: f.name,
            error: err instanceof Error ? err.message : "Upload failed",
          });
        });
      }
    }

    setUploadProgress(null);
    setUploading(false);

    // If there are existing files and not forcing, show confirmation dialog ONLY
    if (allExisting.length > 0 && !force) {
      // Store pending stats for after user decision
      setPendingUploadStats({
        fileCount: allUploaded.length,
        totalSize: totalBytes,
        collectionCount: collections.length,
      });

      setConfirmDialog({
        show: true,
        files: filesToReupload,
        filenames: allExisting.map(r => r.filename),
      });

      // Store results but DON'T show the panel yet
      setUploadResults(prev => ({
        ...prev,
        uploaded: allUploaded,
        existing: allExisting,
        failed: allFailed,
        show: false, // Don't show until user decides
      }));
    } else {
      // No duplicates or forcing - show success banner immediately
      const finalUploadCount = force ? uploadResults.uploaded.length + allUploaded.length : allUploaded.length;
      const replacedCount = force ? allUploaded.length : 0;

      setUploadBanner({
        show: true,
        fileCount: finalUploadCount,
        totalSize: formatFileSize(totalBytes),
        collectionCount: collections.length,
        replacedCount,
        skippedCount: 0,
      });

      // Auto-dismiss banner after 5 seconds
      setTimeout(() => {
        setUploadBanner(prev => ({ ...prev, show: false }));
      }, 5000);

      // Update results (force uploads go to "replaced" category)
      setUploadResults({
        uploaded: force ? [] : allUploaded,
        existing: [],
        replaced: force ? allUploaded : [],
        skipped: [],
        failed: allFailed,
        show: false, // Use banner instead
      });
    }

    // Remove successfully uploaded categorized images from state
    // Keep uncategorized images
    const uploadedFilenames = new Set(allUploaded.map(r => r.filename));
    setImages(prev => prev.filter(img =>
      !img.parsed || !uploadedFilenames.has(img.originalFilename)
    ));
  };

  const handleConfirmReplace = async () => {
    setConfirmDialog({ show: false, files: [], filenames: [] });
    // Re-upload with force=true
    await handleSubmit(true);
  };

  const handleSkipExisting = () => {
    // Mark existing as skipped and close dialog
    const skippedCount = uploadResults.existing.length;
    setUploadResults(prev => ({
      ...prev,
      skipped: prev.existing,
      existing: [],
      show: false,
    }));
    setConfirmDialog({ show: false, files: [], filenames: [] });

    // Show success banner with final stats
    if (pendingUploadStats) {
      setUploadBanner({
        show: true,
        fileCount: pendingUploadStats.fileCount,
        totalSize: formatFileSize(pendingUploadStats.totalSize),
        collectionCount: pendingUploadStats.collectionCount,
        replacedCount: 0,
        skippedCount,
      });
      setPendingUploadStats(null);

      // Auto-dismiss banner after 5 seconds
      setTimeout(() => {
        setUploadBanner(prev => ({ ...prev, show: false }));
      }, 5000);
    }
  };

  const handleClearResults = () => {
    setUploadResults({
      uploaded: [],
      existing: [],
      replaced: [],
      skipped: [],
      failed: [],
      show: false,
    });
    setMessage("");
  };

  const handleDismissBanner = () => {
    setUploadBanner(prev => ({ ...prev, show: false }));
  };

  const handleDeleteCollection = (collectionCode: string) => {
    setDeleteDialog({
      show: true,
      type: 'collection',
      collectionCode,
      itemName: `Collection ${collectionCode}`,
    });
  };

  const handleDeleteLetter = (collectionCode: string, letterKey: string, letterDate: string | null) => {
    setDeleteDialog({
      show: true,
      type: 'letter',
      collectionCode,
      letterKey,
      itemName: letterDate ? formatDate(letterDate) : 'Unknown Date',
    });
  };

  const handleConfirmDelete = () => {
    if (deleteDialog.type === 'collection') {
      // Remove all images from this collection
      setImages(prev => prev.filter(img =>
        !img.parsed || img.parsed.collectionCode !== deleteDialog.collectionCode
      ));
    } else if (deleteDialog.type === 'letter' && deleteDialog.letterKey) {
      // Remove images for this specific letter
      setImages(prev => prev.filter(img => {
        if (!img.parsed || img.parsed.collectionCode !== deleteDialog.collectionCode) {
          return true;
        }
        const imgLetterKey = `${img.parsed.dateRaw}-${String(img.parsed.typeSequence).padStart(2, "0")}`;
        return imgLetterKey !== deleteDialog.letterKey;
      }));
    } else if (deleteDialog.type === 'image' && deleteDialog.imageId) {
      // Remove single uncategorized image
      setImages(prev => prev.filter(img => img.id !== deleteDialog.imageId));
    }

    setDeleteDialog({ show: false, type: 'collection', collectionCode: '', itemName: '' });
    // Close collection modal if we deleted the current collection or its last letter
    if (openCollection && deleteDialog.collectionCode === openCollection.collectionCode) {
      // Check if collection will be empty after delete
      const remainingInCollection = images.filter(img =>
        img.parsed?.collectionCode === deleteDialog.collectionCode
      );
      // If we're deleting the collection or it will be empty, close the modal
      if (deleteDialog.type === 'collection' || remainingInCollection.length <= (openCollection.letters.find(l => l.letterKey === deleteDialog.letterKey)?.images.length || 0)) {
        setOpenCollection(null);
      }
    }
  };

  const handleCancelDelete = () => {
    setDeleteDialog({ show: false, type: 'collection', collectionCode: '', itemName: '' });
  };

  const handleDeleteUncategorizedImage = (image: UploadedImage) => {
    setDeleteDialog({
      show: true,
      type: 'image',
      collectionCode: '',
      imageId: image.id,
      itemName: image.originalFilename,
    });
  };

  const handleViewImage = (image: UploadedImage, allImages: UploadedImage[]) => {
    const index = allImages.findIndex(img => img.id === image.id);
    setLightboxState({ images: allImages, currentIndex: index >= 0 ? index : 0 });
  };

  const handleLightboxNavigate = (index: number) => {
    setLightboxState(prev => prev ? { ...prev, currentIndex: index } : null);
  };

  const handleLightboxClose = () => {
    setLightboxState(null);
  };

  const canAdd =
    editState.selectedImageIds.size > 0 &&
    (editState.selectedCollection !== null ||
      (editState.selectedCollection === "new" &&
        editState.newCollectionCode.length > 0));

  const importDropdown = (
    <div className="upload-dropdown">
      <Button
        icon="plus"
        active={uploadMenuOpen}
        onClick={() => setUploadMenuOpen(!uploadMenuOpen)}
      >
        Import
      </Button>
      {uploadMenuOpen && (
        <div className="upload-menu">
          <button
            onClick={() => {
              handleSelectFiles();
              setUploadMenuOpen(false);
            }}
          >
            Files
          </button>
          <button
            onClick={() => {
              handleSelectFolder();
              setUploadMenuOpen(false);
            }}
          >
            Folder
          </button>
        </div>
      )}
    </div>
  );

  return (
    <AdminLayout title="Upload Letters" headerActions={importDropdown}>
    <div
      className={`upload-letter-page ${editState.active ? "edit-mode" : ""}`}
    >
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

      {/* Content toolbar */}
      {images.length > 0 && (
        <div className="upload-toolbar">
          <div className="header-stats">
            <span>{stats.collections} collection{stats.collections !== 1 ? 's' : ''}</span>
            <span className="stat-divider">·</span>
            <span>{stats.letters} letter{stats.letters !== 1 ? 's' : ''}</span>
            <span className="stat-divider">·</span>
            <span>{stats.images} image{stats.images !== 1 ? 's' : ''}</span>
            {stats.uncategorized > 0 && (
              <>
                <span className="stat-divider">·</span>
                <span className="uncategorized-stat">{stats.uncategorized} uncategorized</span>
              </>
            )}
          </div>

          <div className="header-actions">
            {editState.active && (
              <span className="selected-count">{editState.selectedImageIds.size} selected</span>
            )}

            {editState.active && editState.selectedCollection === "new" && (
              <>
                <span className="collection-label">Collection #:</span>
                <input
                  type="text"
                  className="collection-input"
                  value={editState.newCollectionCode}
                  onChange={(e) => handleNewCollectionCodeChange(e.target.value)}
                  placeholder="001"
                  maxLength={3}
                />
              </>
            )}

            {editState.active && (
              <Button variant="primary" disabled={!canAdd} onClick={handleAddToCollection}>
                Add
              </Button>
            )}

            {uncategorizedImages.length > 0 && (
              <Button
                icon={editState.active ? "check" : "edit"}
                onClick={toggleEditMode}
                active={editState.active}
              >
                {editState.active ? "Done" : "Organize"}
              </Button>
            )}

            <Button
              icon="upload"
              disabled={uploading}
              onClick={() => handleSubmit()}
            >
              {uploadProgress
                ? `${uploadProgress.current}/${uploadProgress.total}`
                : "Upload All"}
            </Button>
          </div>
        </div>
      )}

      <div className="upload-content">
        {/* Upload Success Banner */}
        {uploadBanner.show && (
          <div className="upload-banner">
            <div className="banner-icon">✓</div>
            <div className="banner-content">
              <strong>Upload Complete</strong>
              <div className="banner-stats">
                <span className="banner-stat"><strong>{uploadBanner.fileCount}</strong> files</span>
                <span className="banner-stat"><strong>{uploadBanner.totalSize}</strong></span>
                <span className="banner-stat"><strong>{uploadBanner.collectionCount}</strong> collection{uploadBanner.collectionCount !== 1 ? 's' : ''}</span>
                {uploadBanner.replacedCount > 0 && (
                  <span className="banner-stat"><strong>{uploadBanner.replacedCount}</strong> replaced</span>
                )}
                {uploadBanner.skippedCount > 0 && (
                  <span className="banner-stat"><strong>{uploadBanner.skippedCount}</strong> skipped</span>
                )}
              </div>
            </div>
            <button className="banner-dismiss" onClick={handleDismissBanner} title="Dismiss">×</button>
          </div>
        )}

        {/* Collections Section */}
        {collections.length > 0 && (
          <div className="collections-section">
            <h2>Collections</h2>
            <div className="collection-grid">
              {collections.map((collection) => (
                <CollectionCard
                  key={collection.collectionCode}
                  collection={collection}
                  isSelected={
                    editState.selectedCollection ===
                    collection.collectionCode
                  }
                  editMode={editState.active}
                  onSelect={() =>
                    handleCollectionSelect(collection.collectionCode)
                  }
                  onClick={() => setOpenCollection(collection)}
                  onDelete={() => handleDeleteCollection(collection.collectionCode)}
                />
              ))}
              {editState.active && (
                <div
                  className={`collection-card new-collection ${editState.selectedCollection === "new" ? "selected" : ""}`}
                  onClick={handleNewCollectionSelect}
                >
                  <div className="collection-code">
                    <span className="new-collection-icon">+</span>
                    New Collection
                  </div>
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
          <UncategorizedCarousel
            images={uncategorizedImages}
            editState={editState}
            onImageSelect={handleImageSelect}
            onViewImage={handleViewImage}
            onDeleteImage={handleDeleteUncategorizedImage}
          />
        )}

        {/* Message */}
        {message && (
          <div
            className={`message ${message.includes("Successfully") ? "success" : "error"}`}
          >
            {message}
          </div>
        )}

        {/* Guide sections */}
        <div className="guide-section">
          <h3>Naming Format</h3>
          <code className="filename-example">003-18860314-L01-01.jpg</code>
          <div className="format-breakdown">
            <span><strong>003</strong> — Collection (3 digits)</span>
            <span><strong>18860314</strong> — Date YYYYMMDD (use X for unknown)</span>
            <span><strong>L</strong> — Type: L=Letter, P=Photo, E=Ephemera, V=Voice, A=Article, D=Diary, C=Cover, N=Card, T=Telegram</span>
            <span><strong>01</strong> — Sequence number</span>
            <span><strong>01</strong> — Page number (optional)</span>
          </div>
        </div>

        <div className="guide-section">
          <h3>How to Use</h3>
          <div className="guide-steps">
            <div className="guide-step">
              <span className="step-number">1</span>
              <div>
                <strong>Upload images</strong>
                <p>Click the upload icon and select files or a folder. Images appear in the Uncategorized section below.</p>
              </div>
            </div>
            <div className="guide-step">
              <span className="step-number">2</span>
              <div>
                <strong>Organize with Edit mode</strong>
                <p>Select images, choose or create a collection, then click "Add to Collection".</p>
              </div>
            </div>
            <div className="guide-step">
              <span className="step-number">3</span>
              <div>
                <strong>Save to archive</strong>
                <p>Click "Upload All" to save your organized letters.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Collection Modal */}
      {openCollection && (
        <CollectionModal
          collection={openCollection}
          onClose={() => setOpenCollection(null)}
          onViewImage={handleViewImage}
          onDeleteLetter={(letterKey, letterDate) => handleDeleteLetter(openCollection.collectionCode, letterKey, letterDate)}
        />
      )}

      {/* Lightbox */}
      {lightboxState && (
        <Lightbox
          images={lightboxState.images}
          currentIndex={lightboxState.currentIndex}
          onClose={handleLightboxClose}
          onNavigate={handleLightboxNavigate}
        />
      )}

      {/* Confirm Replace Dialog */}
      {confirmDialog.show && (
        <div className="modal-overlay" onClick={() => setConfirmDialog({ show: false, files: [], filenames: [] })}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Files Already Exist</h3>
            <p>{confirmDialog.filenames.length} file(s) already exist in storage:</p>
            <div className="existing-files-list">
              {confirmDialog.filenames.slice(0, 5).map((name) => (
                <code key={name}>{name}</code>
              ))}
              {confirmDialog.filenames.length > 5 && (
                <span className="more-files">...and {confirmDialog.filenames.length - 5} more</span>
              )}
            </div>
            <p>Do you want to replace them with the new files?</p>
            <div className="confirm-actions">
              <button className="confirm-btn replace" onClick={handleConfirmReplace}>
                Replace All
              </button>
              <button className="confirm-btn skip" onClick={handleSkipExisting}>
                Skip Existing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Results Panel */}
      {uploadResults.show && (
        <div className="modal-overlay" onClick={handleClearResults}>
          <div className="upload-results-panel" onClick={(e) => e.stopPropagation()}>
            <div className="results-header">
              <h3>Upload Complete</h3>
              <button className="modal-close" onClick={handleClearResults}>×</button>
            </div>
            <div className="results-content">
              {uploadResults.uploaded.length > 0 && (
                <div className="result-section success">
                  <h4>Uploaded ({uploadResults.uploaded.length})</h4>
                  <ul>
                    {uploadResults.uploaded.slice(0, 10).map((r) => (
                      <li key={r.pageId}>{r.filename}</li>
                    ))}
                    {uploadResults.uploaded.length > 10 && (
                      <li className="more">...and {uploadResults.uploaded.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
              {uploadResults.replaced.length > 0 && (
                <div className="result-section replaced">
                  <h4>Replaced ({uploadResults.replaced.length})</h4>
                  <ul>
                    {uploadResults.replaced.slice(0, 10).map((r) => (
                      <li key={r.pageId}>{r.filename}</li>
                    ))}
                    {uploadResults.replaced.length > 10 && (
                      <li className="more">...and {uploadResults.replaced.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
              {uploadResults.skipped.length > 0 && (
                <div className="result-section skipped">
                  <h4>Skipped ({uploadResults.skipped.length})</h4>
                  <ul>
                    {uploadResults.skipped.slice(0, 10).map((r) => (
                      <li key={r.pageId}>{r.filename}</li>
                    ))}
                    {uploadResults.skipped.length > 10 && (
                      <li className="more">...and {uploadResults.skipped.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
              {uploadResults.failed.length > 0 && (
                <div className="result-section failed">
                  <h4>Failed ({uploadResults.failed.length})</h4>
                  <ul>
                    {uploadResults.failed.slice(0, 10).map((r, i) => (
                      <li key={i}>
                        <span className="filename">{r.filename}</span>
                        <span className="error">{r.error}</span>
                      </li>
                    ))}
                    {uploadResults.failed.length > 10 && (
                      <li className="more">...and {uploadResults.failed.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            <div className="results-actions">
              <button className="results-btn primary" onClick={handleClearResults}>
                Upload More
              </button>
              <button className="results-btn secondary" onClick={() => navigate("/admin")}>
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialog.show}
        title={`Delete ${deleteDialog.type === 'collection' ? 'Collection' : deleteDialog.type === 'letter' ? 'Letter' : 'Image'}?`}
        message={
          <>
            Are you sure you want to delete <strong>{deleteDialog.itemName}</strong>?
            {deleteDialog.type === 'collection' && ' This will remove all letters and images in this collection.'}
          </>
        }
        confirmText="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
    </AdminLayout>
  );
}
