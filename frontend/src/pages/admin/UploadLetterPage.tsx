import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { uploadFiles, checkDuplicates, type UploadResult, type UploadError } from "../../api/admin";
import { getErrorMessage } from "../../api/client";
import {
  parseFilename,
} from "../../utils/filename-parser";
import { Button, ConfirmDialog, Icon } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
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
  formatFileSize,
  generateId,
  generateNewFilename,
  getNextCollectionCode,
  groupImagesByCollection,
} from "./UploadLetter/utils";
import "./UploadLetterPage.css";

export default function UploadLetterPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // State
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [message, setMessage] = useState("");
  const [editState, setEditState] = useState<EditState>({
    active: false,
    mode: "organize",
    selectedCollection: null,
    selectedImageIds: new Set(),
    newCollectionCode: "001",
    deletionImageIds: new Set(),
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
  const [dragActive, setDragActive] = useState(false);

  // Auth check
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Cleanup URLs on unmount
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.url));
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
    const totalImages = collections.reduce((sum, c) => sum + c.totalImages, 0);
    const duplicates = images.filter(img => img.isDuplicate).length;
    const totalImported = images.length;
    const newFiles = images.filter(img => img.parsed && !img.isDuplicate).length;
    return {
      collections: collections.length,
      images: totalImages,
      uncategorized: uncategorizedImages.length,
      duplicates,
      totalImported,
      newFiles,
    };
  }, [collections, uncategorizedImages, images]);

  // Update next collection code when collections change
  useEffect(() => {
    const nextCode = getNextCollectionCode(collections);
    setEditState((prev) => ({ ...prev, newCollectionCode: nextCode }));
  }, [collections]);

  // Fall back to delete mode if uncategorized images disappear while in organize mode
  useEffect(() => {
    if (uncategorizedImages.length === 0) {
      setEditState((prev) => prev.mode === "organize" ? { ...prev, mode: "delete" } : prev);
    }
  }, [uncategorizedImages.length]);

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
          };
        }
        return img;
      }));
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to check duplicates"), "error");
    } finally {
      setDuplicateCheckLoading(false);
    }
  }, [showToast]);

  // Handlers
  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files) return;

    // Get existing filenames to detect client-side duplicates
    const existingFilenames = new Set(images.map(img => img.originalFilename));
    const skippedFilenames: string[] = [];

    const newImages: UploadedImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;

      if (existingFilenames.has(file.name)) {
        skippedFilenames.push(file.name);
        continue;
      }

      const parsed = parseFilename(file.name);
      newImages.push({
        id: generateId(),
        file,
        url: URL.createObjectURL(file),
        originalFilename: file.name,
        parsed,
        isDuplicate: false,
      });
    }

    // Show import toast
    if (skippedFilenames.length > 0) {
      showToast(`${newImages.length} imported, ${skippedFilenames.length} skipped`);
    } else if (newImages.length > 0) {
      showToast(`${newImages.length} file${newImages.length !== 1 ? 's' : ''} imported`);
    }

    if (newImages.length === 0) return;

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
            };
          }
          return img;
        }));
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to check duplicates"), "error");
      } finally {
        setDuplicateCheckLoading(false);
      }
    }
  }, [images, showToast]);

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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);

  const toggleEditMode = () => {
    setEditState((prev) => ({
      ...prev,
      active: !prev.active,
      mode: "delete",
      selectedCollection: null,
      selectedImageIds: new Set(),
      deletionImageIds: new Set(),
    }));
  };

  const switchEditMode = (mode: "organize" | "delete") => {
    setEditState((prev) => ({
      ...prev,
      mode,
      selectedCollection: null,
      selectedImageIds: new Set(),
      deletionImageIds: new Set(),
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

  // Upload with duplicate decision
  const [duplicateDialog, setDuplicateDialog] = useState<{ show: boolean; duplicateCount: number }>({ show: false, duplicateCount: 0 });

  const handleSubmit = () => {
    // Only upload categorized files - uncategorized stay in the carousel
    if (collections.length === 0) {
      setMessage("No categorized images to upload. Use Edit mode to organize images first.");
      return;
    }

    // If duplicates exist, ask what to do
    if (stats.duplicates > 0) {
      setDuplicateDialog({ show: true, duplicateCount: stats.duplicates });
      return;
    }

    // No duplicates — upload directly (skip only new files)
    doUpload("skip");
  };

  const doUpload = async (duplicateStrategy: "skip" | "replace") => {
    setDuplicateDialog({ show: false, duplicateCount: 0 });
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

      const newFiles: File[] = [];
      const replaceFiles: File[] = [];

      for (const letter of collection.letters) {
        for (const img of letter.images) {
          const file = img.originalFilename !== img.file.name
            ? new File([img.file], img.originalFilename, { type: img.file.type })
            : img.file;

          if (img.isDuplicate) {
            if (duplicateStrategy === "replace") {
              replaceFiles.push(file);
            } else {
              skippedCount++;
            }
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

    // Remove all categorized images from state
    const uploadedFilenames = new Set([
      ...allUploaded.map(r => r.filename),
      ...allReplaced.map(r => r.filename),
    ]);
    setImages(prev => prev.filter(img => {
      if (!img.parsed) return true; // Keep uncategorized
      if (uploadedFilenames.has(img.originalFilename)) return false;
      if (img.isDuplicate) return false; // Remove skipped duplicates too
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

  // Deletion toggle handlers
  const handleToggleDeletionCollection = (collectionCode: string) => {
    const collection = collections.find(c => c.collectionCode === collectionCode);
    if (!collection) return;

    const allImageIds = collection.letters.flatMap(l => l.images.map(img => img.id));

    setEditState(prev => {
      const next = new Set(prev.deletionImageIds);
      const allSelected = allImageIds.every(id => next.has(id));
      if (allSelected) {
        allImageIds.forEach(id => next.delete(id));
      } else {
        allImageIds.forEach(id => next.add(id));
      }
      return { ...prev, deletionImageIds: next };
    });
  };

  const handleToggleDeletionLetter = (collectionCode: string, letterKey: string) => {
    const collection = collections.find(c => c.collectionCode === collectionCode);
    if (!collection) return;
    const letter = collection.letters.find(l => l.letterKey === letterKey);
    if (!letter) return;

    const imageIds = letter.images.map(img => img.id);

    setEditState(prev => {
      const next = new Set(prev.deletionImageIds);
      const allSelected = imageIds.every(id => next.has(id));
      if (allSelected) {
        imageIds.forEach(id => next.delete(id));
      } else {
        imageIds.forEach(id => next.add(id));
      }
      return { ...prev, deletionImageIds: next };
    });
  };

  const handleToggleDeletionImage = (id: string) => {
    setEditState(prev => {
      const next = new Set(prev.deletionImageIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { ...prev, deletionImageIds: next };
    });
  };

  // Count: unique affected letters + uncategorized images
  const deletionCount = useMemo(() => {
    const uncategorizedCount = uncategorizedImages.filter(img => editState.deletionImageIds.has(img.id)).length;
    const affectedLetters = new Set<string>();
    for (const collection of collections) {
      for (const letter of collection.letters) {
        if (letter.images.some(img => editState.deletionImageIds.has(img.id))) {
          affectedLetters.add(`${collection.collectionCode}:${letter.letterKey}`);
        }
      }
    }
    return affectedLetters.size + uncategorizedCount;
  }, [editState.deletionImageIds, collections, uncategorizedImages]);

  const handleBulkDelete = () => {
    const uncategorizedCount = uncategorizedImages.filter(img => editState.deletionImageIds.has(img.id)).length;
    const affectedLetters = new Set<string>();
    for (const collection of collections) {
      for (const letter of collection.letters) {
        if (letter.images.some(img => editState.deletionImageIds.has(img.id))) {
          affectedLetters.add(`${collection.collectionCode}:${letter.letterKey}`);
        }
      }
    }

    const parts: string[] = [];
    if (affectedLetters.size > 0) {
      const n = affectedLetters.size;
      parts.push(`${n} letter${n !== 1 ? "s" : ""}`);
    }
    if (uncategorizedCount > 0) {
      parts.push(`${uncategorizedCount} image${uncategorizedCount !== 1 ? "s" : ""}`);
    }
    setDeleteDialog({
      show: true,
      type: "bulk",
      collectionCode: "",
      itemName: parts.join(", "),
    });
  };

  const handleConfirmDelete = () => {
    if (deleteDialog.type === "bulk") {
      const summary = deleteDialog.itemName;
      setImages(prev => prev.filter(img => !editState.deletionImageIds.has(img.id)));

      // Close collection modal if all its images were deleted
      if (openCollectionCode) {
        const openColl = collections.find(c => c.collectionCode === openCollectionCode);
        if (openColl) {
          const allImagesDeleted = openColl.letters.every(l =>
            l.images.every(img => editState.deletionImageIds.has(img.id))
          );
          if (allImagesDeleted) {
            setOpenCollectionCode(null);
          }
        }
      }

      // Clear deletion selections
      setEditState(prev => ({
        ...prev,
        deletionImageIds: new Set(),
      }));

      showToast(`${summary} deleted`);
    }

    setDeleteDialog({ show: false, type: "collection", collectionCode: "", itemName: "" });
  };

  const handleCancelDelete = () => {
    setDeleteDialog({ show: false, type: "collection", collectionCode: "", itemName: "" });
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

  // Track which collections have all-duplicate content
  const collectionHasDuplicates = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const collection of collections) {
      const allImages = collection.letters.flatMap(l => l.images);
      result[collection.collectionCode] = allImages.length > 0 && allImages.every(img => img.isDuplicate);
    }
    return result;
  }, [collections]);

  // Sort collections: non-duplicate first, then by collection code
  const sortedCollections = useMemo(() => {
    return [...collections].sort((a, b) => {
      const aAllDup = collectionHasDuplicates[a.collectionCode];
      const bAllDup = collectionHasDuplicates[b.collectionCode];
      if (aAllDup !== bAllDup) return aAllDup ? 1 : -1;
      return a.collectionCode.localeCompare(b.collectionCode);
    });
  }, [collections, collectionHasDuplicates]);

  const headerActions = (
    <>
      {images.length > 0 && (
        <div className="header-stats">
          <span>{stats.totalImported} imported</span>
          {stats.newFiles > 0 && (
            <>
              <span className="stat-divider">·</span>
              <span className="stat-new">{stats.newFiles} original</span>
            </>
          )}
          {stats.duplicates > 0 && (
            <>
              <span className="stat-divider">·</span>
              <span className="stat-duplicate">{stats.duplicates} duplicate{stats.duplicates !== 1 ? 's' : ''}</span>
            </>
          )}
          {duplicateCheckLoading && (
            <>
              <span className="stat-divider">·</span>
              <span className="checking-stat">checking...</span>
            </>
          )}
        </div>
      )}

      <div className="header-actions">
        {editState.active && editState.mode === "organize" && (
          <span className="selected-count">{editState.selectedImageIds.size} selected</span>
        )}

        {editState.active && editState.mode === "organize" && editState.selectedCollection === "new" && (
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

        {editState.active && editState.mode === "organize" && (
          <Button variant="primary" disabled={!canAdd} onClick={handleAddToCollection}>
            Add
          </Button>
        )}

        {editState.active && editState.mode === "delete" && deletionCount > 0 && (
          <Button variant="danger" icon="delete" onClick={handleBulkDelete}>
            Delete ({deletionCount})
          </Button>
        )}

        {editState.active && uncategorizedImages.length > 0 && (
          <div className="edit-mode-toggle">
            <button
              className={`edit-mode-option ${editState.mode === "organize" ? "active" : ""}`}
              onClick={() => switchEditMode("organize")}
            >
              Organize
            </button>
            <button
              className={`edit-mode-option ${editState.mode === "delete" ? "active" : ""}`}
              onClick={() => switchEditMode("delete")}
            >
              Delete
            </button>
          </div>
        )}

        {(uncategorizedImages.length > 0 || collections.length > 0) && (
          <Button
            icon={editState.active ? "check" : "edit"}
            onClick={toggleEditMode}
            active={editState.active}
          >
            {editState.active ? "Done" : "Edit"}
          </Button>
        )}

        {images.length > 0 && (
          <Button
            icon="upload"
            disabled={uploading}
            onClick={handleSubmit}
          >
            {uploadProgress
              ? `${uploadProgress.current}/${uploadProgress.total}`
              : "Upload"}
          </Button>
        )}

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
                  handleSelectFolder();
                  setUploadMenuOpen(false);
                }}
              >
                Folder
              </button>
              <button
                onClick={() => {
                  handleSelectFiles();
                  setUploadMenuOpen(false);
                }}
              >
                Files
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <AdminLayout headerActions={headerActions}>
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

      {images.length === 0 && collections.length === 0 ? (
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

          {/* Empty state: large drop zone */}
          <div
            className={`upload-drop-zone ${dragActive ? 'drag-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Icon name="upload" size={48} className="drop-zone-icon" />
            <span className="drop-zone-title">Drag images here</span>
            <span className="drop-zone-or">or</span>
            <div className="drop-zone-buttons">
              <button className="drop-zone-btn" onClick={handleSelectFolder}>
                Browse Folder
              </button>
              <button className="drop-zone-btn" onClick={handleSelectFiles}>
                Browse Files
              </button>
            </div>
          </div>

          {/* Compact naming hint */}
          <div className="upload-hint-row">
            <code className="hint-format">CCC-YYYYMMDD-TII-PP.ext</code>
            <span className="hint-text">Files are auto-organized by collection code</span>
          </div>
        </div>
      ) : (
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
                {sortedCollections.map((collection) => (
                  <CollectionCard
                    key={collection.collectionCode}
                    collection={collection}
                    isSelected={
                      editState.selectedCollection ===
                      collection.collectionCode
                    }
                    editMode={editState.active && editState.mode === "organize"}
                    deletionMode={editState.active && editState.mode === "delete"}
                    hasDuplicates={collectionHasDuplicates[collection.collectionCode] || false}
                    isMarkedForDeletion={collection.letters.length > 0 && collection.letters.every(l => l.images.every(img => editState.deletionImageIds.has(img.id)))}
                    isPartialDeletion={collection.letters.some(l => l.images.some(img => editState.deletionImageIds.has(img.id))) && !collection.letters.every(l => l.images.every(img => editState.deletionImageIds.has(img.id)))}
                    onSelect={() =>
                      handleCollectionSelect(collection.collectionCode)
                    }
                    onClick={() => setOpenCollectionCode(collection.collectionCode)}
                    onToggleDeletion={() => handleToggleDeletionCollection(collection.collectionCode)}
                  />
                ))}
                {editState.active && editState.mode === "organize" && (
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
          {collections.length === 0 && editState.active && editState.mode === "organize" && (
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
              onToggleDeletionImage={handleToggleDeletionImage}
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

          {/* Compact naming hint */}
          <div className="upload-hint-row">
            <code className="hint-format">CCC-YYYYMMDD-TII-PP.ext</code>
            <span className="hint-text">Files are auto-organized by collection code</span>
          </div>
        </div>
      )}

      {/* Collection Modal */}
      {openCollection && (
        <CollectionModal
          collection={openCollection}
          deletionMode={editState.active && editState.mode === "delete"}
          deletionImageIds={editState.deletionImageIds}
          onClose={() => setOpenCollectionCode(null)}
          onViewImage={handleViewImage}
          onToggleDeletionLetter={handleToggleDeletionLetter}
          onToggleDeletionImage={handleToggleDeletionImage}
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

      {/* Duplicate Decision Dialog */}
      {duplicateDialog.show && (
        <div className="modal-overlay" onClick={() => setDuplicateDialog({ show: false, duplicateCount: 0 })}>
          <div className="duplicate-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Duplicates Found</h3>
            <p>
              <strong>{duplicateDialog.duplicateCount}</strong> of {stats.images} files already exist in the archive.
            </p>
            <div className="duplicate-dialog-actions">
              <button
                className="duplicate-dialog-btn skip"
                onClick={() => doUpload("skip")}
              >
                Skip Duplicates
                <span className="btn-desc">Only upload {stats.newFiles} new file{stats.newFiles !== 1 ? 's' : ''}</span>
              </button>
              <button
                className="duplicate-dialog-btn replace"
                onClick={() => doUpload("replace")}
              >
                Replace Duplicates
                <span className="btn-desc">Overwrite {duplicateDialog.duplicateCount} existing file{duplicateDialog.duplicateCount !== 1 ? 's' : ''}</span>
              </button>
            </div>
            <button
              className="duplicate-dialog-cancel"
              onClick={() => setDuplicateDialog({ show: false, duplicateCount: 0 })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialog.show}
        title={deleteDialog.type === 'bulk' ? 'Delete Selected Items?' : `Delete ${deleteDialog.type === 'collection' ? 'Collection' : deleteDialog.type === 'letter' ? 'Letter' : 'Image'}?`}
        message={
          deleteDialog.type === 'bulk' ? (
            <>Are you sure you want to delete <strong>{deleteDialog.itemName}</strong>?</>
          ) : (
            <>
              Are you sure you want to delete <strong>{deleteDialog.itemName}</strong>?
              {deleteDialog.type === 'collection' && ' This will remove all letters and images in this collection.'}
            </>
          )
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
