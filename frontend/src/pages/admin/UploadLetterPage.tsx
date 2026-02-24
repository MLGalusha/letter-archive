import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { uploadFiles, checkDuplicates, type UploadResult, type UploadError } from "../../api/admin";
import {
  parseFilename,
} from "../../utils/filename-parser";
import { Button, ConfirmDialog } from "../../components/common";
import AdminLayout from "../../components/AdminLayout/AdminLayout";
import CollectionCard from "./UploadLetter/CollectionCard";
import CollectionModal from "./UploadLetter/CollectionModal";
import Lightbox from "./UploadLetter/Lightbox";
import UncategorizedCarousel from "./UploadLetter/UncategorizedCarousel";
import type {
  UploadedImage,
  EditState,
  LightboxState,
  UploadProgress,
  UploadResultsState,
  UploadBannerState,
  DeleteDialogState,
} from "./UploadLetter/types";
import {
  formatDate,
  formatFileSize,
  generateId,
  generateNewFilename,
  getNextCollectionCode,
  groupImagesByCollection,
} from "./UploadLetter/utils";
import "./UploadLetterPage.css";

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
  const [openCollectionCode, setOpenCollectionCode] = useState<string | null>(null);
  const [lightboxState, setLightboxState] = useState<LightboxState | null>(
    null,
  );
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResultsState>({
    uploaded: [],
    replaced: [],
    failed: [],
    show: false,
  });
  const [uploadBanner, setUploadBanner] = useState<UploadBannerState>({
    show: false,
    fileCount: 0,
    totalSize: "0 B",
    collectionCount: 0,
    replacedCount: 0,
    skippedCount: 0,
    excludedCount: 0,
  });
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    show: false,
    type: 'collection',
    collectionCode: '',
    itemName: '',
  });
  const [duplicateCheckLoading, setDuplicateCheckLoading] = useState(false);

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

  // Derive openCollection from openCollectionCode — always fresh
  const openCollection = useMemo(() => {
    if (!openCollectionCode) return null;
    return collections.find(c => c.collectionCode === openCollectionCode) || null;
  }, [openCollectionCode, collections]);

  const uncategorizedImages = useMemo(
    () => images.filter((img) => !img.parsed),
    [images],
  );

  const stats = useMemo(() => {
    const totalLetters = collections.reduce((sum, c) => sum + c.letters.length, 0);
    const totalImages = collections.reduce((sum, c) => sum + c.totalImages, 0);
    const duplicates = images.filter(img => img.isDuplicate).length;
    const duplicatesToReplace = images.filter(img => img.isDuplicate && img.replaceSelected).length;
    const totalImported = images.length;
    // Will upload = categorized non-duplicates + duplicates set to replace
    const willUpload = images.filter(img => img.parsed && (!img.isDuplicate || img.replaceSelected)).length;
    return {
      collections: collections.length,
      letters: totalLetters,
      images: totalImages,
      uncategorized: uncategorizedImages.length,
      duplicates,
      duplicatesToReplace,
      totalImported,
      willUpload,
    };
  }, [collections, uncategorizedImages, images]);

  // Update next collection code when collections change
  useEffect(() => {
    const nextCode = getNextCollectionCode(collections);
    setEditState((prev) => ({ ...prev, newCollectionCode: nextCode }));
  }, [collections]);

  // Duplicate check helper
  const recheckDuplicates = useCallback(async (filenames: string[]) => {
    if (filenames.length === 0) return;
    setDuplicateCheckLoading(true);
    try {
      const response = await checkDuplicates(filenames);
      setImages(prev => prev.map(img => {
        if (filenames.includes(img.originalFilename) && img.originalFilename in response.duplicates) {
          return {
            ...img,
            isDuplicate: response.duplicates[img.originalFilename],
            replaceSelected: response.duplicates[img.originalFilename] ? img.replaceSelected : true,
          };
        }
        return img;
      }));
    } catch {
      // Silently fail — duplicates just won't be flagged
    } finally {
      setDuplicateCheckLoading(false);
    }
  }, []);

  // Handlers
  const handleFilesSelected = useCallback(async (files: FileList | null) => {
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
        isDuplicate: false,
        replaceSelected: true,
      });
    }

    setImages((prev) => [...prev, ...newImages]);
    setMessage("");

    // Check duplicates for categorized files
    const categorizedFilenames = newImages
      .filter(img => img.parsed)
      .map(img => img.originalFilename);

    if (categorizedFilenames.length > 0) {
      setDuplicateCheckLoading(true);
      try {
        const response = await checkDuplicates(categorizedFilenames);
        setImages(prev => prev.map(img => {
          if (img.originalFilename in response.duplicates) {
            return {
              ...img,
              isDuplicate: response.duplicates[img.originalFilename],
              replaceSelected: true,
            };
          }
          return img;
        }));
      } catch {
        // Silently fail
      } finally {
        setDuplicateCheckLoading(false);
      }
    }
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

    // Collect new filenames for duplicate recheck
    const newFilenames: string[] = [];

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
        newFilenames.push(newFilename);

        return {
          ...img,
          originalFilename: newFilename,
          parsed: newParsed,
          isDuplicate: false, // Reset until recheck
          replaceSelected: true,
        };
      }),
    );

    // Reset edit state
    setEditState((prev) => ({
      ...prev,
      selectedCollection: null,
      selectedImageIds: new Set(),
    }));

    // Recheck duplicates for new filenames
    if (newFilenames.length > 0) {
      recheckDuplicates(newFilenames);
    }
  };

  // Duplicate toggle handlers
  const handleToggleDuplicateReplace = useCallback((imageId: string) => {
    setImages(prev => prev.map(img =>
      img.id === imageId ? { ...img, replaceSelected: !img.replaceSelected } : img
    ));
  }, []);

  const handleToggleAllDuplicates = useCallback((selected: boolean) => {
    setImages(prev => prev.map(img =>
      img.isDuplicate ? { ...img, replaceSelected: selected } : img
    ));
  }, []);

  const handleSubmit = async () => {
    // Only upload categorized files - uncategorized stay in the carousel
    if (collections.length === 0) {
      setMessage("No categorized images to upload. Use Edit mode to organize images first.");
      return;
    }

    setUploading(true);
    setMessage("");
    setUploadBanner(prev => ({ ...prev, show: false }));

    const allUploaded: UploadResult[] = [];
    const allReplaced: UploadResult[] = [];
    const allFailed: UploadError[] = [];
    let skippedCount = 0;
    let totalBytes = 0;

    // Upload each collection as a batch
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      setUploadProgress({
        current: i + 1,
        total: collections.length,
        collectionCode: collection.collectionCode,
      });

      // Split files into buckets
      const newFiles: File[] = [];
      const replaceFiles: File[] = [];

      for (const letter of collection.letters) {
        for (const img of letter.images) {
          const file = img.originalFilename !== img.file.name
            ? new File([img.file], img.originalFilename, { type: img.file.type })
            : img.file;

          if (img.isDuplicate && !img.replaceSelected) {
            // Skip this file
            skippedCount++;
          } else if (img.isDuplicate && img.replaceSelected) {
            replaceFiles.push(file);
          } else {
            newFiles.push(file);
          }
        }
      }

      // Upload new files (force=false)
      if (newFiles.length > 0) {
        newFiles.forEach(f => totalBytes += f.size);
        try {
          const response = await uploadFiles(newFiles, false);
          allUploaded.push(...response.results);
          if (response.errors) allFailed.push(...response.errors);
        } catch (err) {
          newFiles.forEach(f => {
            allFailed.push({
              filename: f.name,
              error: err instanceof Error ? err.message : "Upload failed",
            });
          });
        }
      }

      // Upload replace files (force=true)
      if (replaceFiles.length > 0) {
        replaceFiles.forEach(f => totalBytes += f.size);
        try {
          const response = await uploadFiles(replaceFiles, true);
          allReplaced.push(...response.results);
          if (response.errors) allFailed.push(...response.errors);
        } catch (err) {
          replaceFiles.forEach(f => {
            allFailed.push({
              filename: f.name,
              error: err instanceof Error ? err.message : "Upload failed",
            });
          });
        }
      }
    }

    setUploadProgress(null);
    setUploading(false);

    // Remove all categorized images from state (uploaded + replaced + skipped)
    const uploadedFilenames = new Set([
      ...allUploaded.map(r => r.filename),
      ...allReplaced.map(r => r.filename),
    ]);
    // Also remove skipped duplicates
    setImages(prev => prev.filter(img => {
      if (!img.parsed) return true; // Keep uncategorized
      if (uploadedFilenames.has(img.originalFilename)) return false;
      if (img.isDuplicate && !img.replaceSelected) return false; // Skipped
      return true;
    }));

    const excludedCount = uncategorizedImages.length;

    // Show success banner
    setUploadBanner({
      show: true,
      fileCount: allUploaded.length,
      totalSize: formatFileSize(totalBytes),
      collectionCount: collections.length,
      replacedCount: allReplaced.length,
      skippedCount,
      excludedCount,
    });

    // Auto-dismiss banner after 8 seconds
    setTimeout(() => {
      setUploadBanner(prev => ({ ...prev, show: false }));
    }, 8000);

    // Update results - only show panel if there are failures
    setUploadResults({
      uploaded: allUploaded,
      replaced: allReplaced,
      failed: allFailed,
      show: allFailed.length > 0,
    });
  };

  const handleClearResults = () => {
    setUploadResults({
      uploaded: [],
      replaced: [],
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
      setImages(prev => prev.filter(img =>
        !img.parsed || img.parsed.collectionCode !== deleteDialog.collectionCode
      ));
    } else if (deleteDialog.type === 'letter' && deleteDialog.letterKey) {
      setImages(prev => prev.filter(img => {
        if (!img.parsed || img.parsed.collectionCode !== deleteDialog.collectionCode) {
          return true;
        }
        const imgLetterKey = `${img.parsed.dateRaw}-${String(img.parsed.typeSequence).padStart(2, "0")}`;
        return imgLetterKey !== deleteDialog.letterKey;
      }));
    } else if (deleteDialog.type === 'image' && deleteDialog.imageId) {
      setImages(prev => prev.filter(img => img.id !== deleteDialog.imageId));
    }

    // Close collection modal if we deleted the current collection or its last letter
    if (openCollectionCode && deleteDialog.collectionCode === openCollectionCode) {
      const remainingInCollection = images.filter(img =>
        img.parsed?.collectionCode === deleteDialog.collectionCode
      );
      const currentCollection = collections.find(c => c.collectionCode === openCollectionCode);
      if (deleteDialog.type === 'collection' || remainingInCollection.length <= (currentCollection?.letters.find(l => l.letterKey === deleteDialog.letterKey)?.images.length || 0)) {
        setOpenCollectionCode(null);
      }
    }

    setDeleteDialog({ show: false, type: 'collection', collectionCode: '', itemName: '' });
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

  // Compute per-collection duplicate action: 'none' | 'replace' | 'skip'
  const collectionDupAction = useMemo(() => {
    const result: Record<string, 'none' | 'replace' | 'skip'> = {};
    for (const collection of collections) {
      const allImages = collection.letters.flatMap(l => l.images);
      const allDup = allImages.length > 0 && allImages.every(img => img.isDuplicate);
      if (!allDup) {
        result[collection.collectionCode] = 'none';
      } else if (allImages.every(img => img.replaceSelected)) {
        result[collection.collectionCode] = 'replace';
      } else {
        result[collection.collectionCode] = 'skip';
      }
    }
    return result;
  }, [collections]);

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
            <span className="will-upload-stat">{stats.willUpload} to upload</span>
            <span className="stat-divider">·</span>
            <span>{stats.totalImported} imported</span>
            <span className="stat-divider">·</span>
            <span>{stats.collections} collection{stats.collections !== 1 ? 's' : ''}</span>
            <span className="stat-divider">·</span>
            <span>{stats.images} categorized</span>
            {stats.duplicates > 0 && (
              <>
                <span className="stat-divider">·</span>
                <span className="duplicate-stat">{stats.duplicatesToReplace} duplicate{stats.duplicatesToReplace !== 1 ? 's' : ''} to replace</span>
              </>
            )}
            {stats.uncategorized > 0 && (
              <>
                <span className="stat-divider">·</span>
                <span className="uncategorized-stat">{stats.uncategorized} uncategorized</span>
              </>
            )}
            {duplicateCheckLoading && (
              <>
                <span className="stat-divider">·</span>
                <span className="checking-stat">checking...</span>
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
              onClick={handleSubmit}
            >
              {uploadProgress
                ? `${uploadProgress.current}/${uploadProgress.total}`
                : "Upload All"}
            </Button>
          </div>
        </div>
      )}

      {/* Duplicate controls bar */}
      {stats.duplicates > 0 && !editState.active && (
        <div className="duplicate-controls-bar">
          <span>{stats.duplicates} duplicate{stats.duplicates !== 1 ? 's' : ''} found</span>
          <div className="duplicate-controls-actions">
            <button className="duplicate-control-btn replace" onClick={() => handleToggleAllDuplicates(true)}>
              Replace All
            </button>
            <button className="duplicate-control-btn skip" onClick={() => handleToggleAllDuplicates(false)}>
              Skip All
            </button>
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
                {uploadBanner.excludedCount > 0 && (
                  <span className="banner-stat"><strong>{uploadBanner.excludedCount}</strong> uncategorized excluded</span>
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
                  duplicateAction={collectionDupAction[collection.collectionCode] || 'none'}
                  onSelect={() =>
                    handleCollectionSelect(collection.collectionCode)
                  }
                  onClick={() => setOpenCollectionCode(collection.collectionCode)}
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
          onClose={() => setOpenCollectionCode(null)}
          onViewImage={handleViewImage}
          onDeleteLetter={(letterKey, letterDate) => handleDeleteLetter(openCollection.collectionCode, letterKey, letterDate)}
          onToggleDuplicateReplace={handleToggleDuplicateReplace}
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

      {/* Upload Results Panel (only shown for failures) */}
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
