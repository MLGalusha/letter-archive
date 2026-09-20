import { RetryingImage } from "./common/RetryingImage";
import { useState, useEffect, useCallback, useRef } from 'react';
import { getAdminCollections, getAdminCollectionByCode, type AdminCollectionInfo } from '../api/collections';
import { getImageUrl } from '../api/client';
import { uploadBlogImage } from '../api/admin/content';
import { getAdminLetterById } from '../api/letters';
import type { Letter, LetterImage } from '../types/Letter';
import Modal from './common/Modal';
import { Button } from './common';
import './JournalImageDialog.css';
import { type ImageDimensions } from '../utils/journalImageDimensions';

type Tab = 'url' | 'upload' | 'database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, alt?: string, dimensions?: ImageDimensions) => void;
}

export default function JournalImageDialog({ isOpen, onClose, onInsert }: Props) {
  const [tab, setTab] = useState<Tab>('url');

  // URL tab
  const [urlInput, setUrlInput] = useState('');
  const [altInput, setAltInput] = useState('');
  const [previewDimensions, setPreviewDimensions] = useState<{ source: string; dimensions: ImageDimensions }>();

  // Upload tab
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Database tab
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<AdminCollectionInfo | null>(null);
  const [lettersResult, setLettersResult] = useState<{ collectionCode: string; letters: Letter[] } | null>(null);
  const [selectedLetter, setSelectedLetter] = useState<Letter | null>(null);
  const [imagesResult, setImagesResult] = useState<{ letterId: string; images: LetterImage[] } | null>(null);
  const letters = selectedCollection && lettersResult?.collectionCode === selectedCollection.collectionCode
    ? lettersResult.letters
    : [];
  const lettersLoading = Boolean(
    selectedCollection && lettersResult?.collectionCode !== selectedCollection.collectionCode,
  );
  const letterImages = selectedLetter && imagesResult?.letterId === selectedLetter.id
    ? imagesResult.images
    : [];
  const imagesLoading = Boolean(selectedLetter && imagesResult?.letterId !== selectedLetter.id);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Opening starts a fresh draft session while the dialog component remains mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional dialog-session reset.
      setUrlInput('');
      setAltInput('');
      setUploadError(null);
      setSelectedCollection(null);
      setSelectedLetter(null);
      setLettersResult(null);
      setImagesResult(null);
    }
  }, [isOpen]);

  // Load collections once for each open database-tab activation.
  useEffect(() => {
    if (!isOpen || tab !== 'database') return;
    let active = true;
    // Loading belongs to this external request activation; cleanup prevents a
    // closed or replaced activation from settling it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- External collection request lifecycle.
    setCollectionsLoading(true);
    void getAdminCollections()
      .then((cols) => {
        if (active) setCollections(cols.filter((c) => (c.letterCount ?? 0) > 0));
      })
      .catch(() => {
        if (active) setCollections([]);
      })
      .finally(() => {
        if (active) setCollectionsLoading(false);
      });
    return () => { active = false; };
  }, [isOpen, tab]);

  // Load letters when a collection is selected
  useEffect(() => {
    if (!isOpen || !selectedCollection) return;
    const collectionCode = selectedCollection.collectionCode;
    let active = true;
    void getAdminCollectionByCode(collectionCode)
      .then((collection) => {
        if (active) setLettersResult({ collectionCode, letters: collection.letters || [] });
      })
      .catch(() => {
        if (active) setLettersResult({ collectionCode, letters: [] });
      });
    return () => { active = false; };
  }, [isOpen, selectedCollection]);

  // Load full letter detail (with all images) when a letter is selected
  useEffect(() => {
    if (!isOpen || !selectedLetter) return;
    const letter = selectedLetter;
    let active = true;
    void getAdminLetterById(letter.id)
      .then((full) => {
        if (active) setImagesResult({ letterId: letter.id, images: full.images || [] });
      })
      .catch(() => {
        if (active) setImagesResult({ letterId: letter.id, images: letter.images || [] });
      });
    return () => { active = false; };
  }, [isOpen, selectedLetter]);

  const handleUrlInsert = useCallback(() => {
    if (!urlInput.trim()) return;
    onInsert(urlInput.trim(), altInput.trim() || undefined, previewDimensions?.source === urlInput.trim() ? previewDimensions.dimensions : undefined);
    onClose();
  }, [urlInput, altInput, previewDimensions, onInsert, onClose]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadBlogImage(file);
      onInsert(result.url, file.name.replace(/\.[^.]+$/, ''), result.dimensions);
      onClose();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [onInsert, onClose]);

  const handleDatabaseImageSelect = useCallback((image: LetterImage) => {
    const url = image.imageUrl;
    const alt = image.originalFilename || `Page ${image.pageNumber || 1}`;
    // Stored letter axes may predate EXIF normalization. The editor's preview
    // captures displayed dimensions; explicit Save also verifies the owned file.
    onInsert(url, alt);
    onClose();
  }, [onInsert, onClose]);

  if (!isOpen) return null;

  // Breadcrumb parts for database tab
  const breadcrumbs: { label: string; onClick: () => void }[] = [];
  if (tab === 'database') {
    breadcrumbs.push({
      label: 'Collections',
      onClick: () => { setSelectedCollection(null); setSelectedLetter(null); },
    });
    if (selectedCollection) {
      breadcrumbs.push({
        label: selectedCollection.title || selectedCollection.collectionCode,
        onClick: () => { setSelectedLetter(null); },
      });
    }
    if (selectedLetter) {
      breadcrumbs.push({
        label: selectedLetter.title || selectedLetter.metadata?.sender || 'Letter',
        onClick: () => {},
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Insert Image"
      size="lg"
    >
      <div className="jid-tabs">
        <button
          className={`jid-tab ${tab === 'url' ? 'active' : ''}`}
          onClick={() => setTab('url')}
        >
          URL
        </button>
        <button
          className={`jid-tab ${tab === 'upload' ? 'active' : ''}`}
          onClick={() => setTab('upload')}
        >
          Upload
        </button>
        <button
          className={`jid-tab ${tab === 'database' ? 'active' : ''}`}
          onClick={() => setTab('database')}
        >
          Database
        </button>
      </div>

      <div className="jid-body">
        {/* ── URL Tab ── */}
        {tab === 'url' && (
          <div className="jid-url-tab">
            <label className="jid-label">Image URL</label>
            <input
              className="jid-input"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/image.jpg"
              autoFocus
            />
            <label className="jid-label">Alt text (optional)</label>
            <input
              className="jid-input"
              type="text"
              value={altInput}
              onChange={(e) => setAltInput(e.target.value)}
              placeholder="Describe the image"
            />
            {urlInput.trim() && (
              <div className="jid-preview">
                <img
                  key={urlInput.trim()}
                  src={urlInput.trim()}
                  alt={altInput || 'Preview'}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  onLoad={(e) => { e.currentTarget.style.display = 'block'; setPreviewDimensions({ source: urlInput.trim(), dimensions: { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight } }); }}
                />
              </div>
            )}
            <div className="jid-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={!urlInput.trim()}
                onClick={handleUrlInsert}
              >
                Insert
              </Button>
            </div>
          </div>
        )}

        {/* ── Upload Tab ── */}
        {tab === 'upload' && (
          <div className="jid-upload-tab">
            <label className="jid-drop-zone" htmlFor="jid-file-input">
              <p className="jid-drop-text">
                {uploading ? 'Uploading...' : 'Click to choose a file'}
              </p>
              <p className="jid-drop-hint">JPG, PNG, GIF, WebP — max 10 MB</p>
            </label>
            <input
              ref={fileInputRef}
              id="jid-file-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="jid-file-input-hidden"
            />
            {uploadError && <p className="jid-error">{uploadError}</p>}
          </div>
        )}

        {/* ── Database Tab ── */}
        {tab === 'database' && (
          <div className="jid-database-tab">
            {/* Breadcrumb trail */}
            {breadcrumbs.length > 1 && (
              <nav className="jid-breadcrumbs">
                {breadcrumbs.map((crumb, i) => {
                  const isLast = i === breadcrumbs.length - 1;
                  return (
                    <span key={i} className="jid-breadcrumb-item">
                      {i > 0 && <span className="jid-breadcrumb-sep">/</span>}
                      {isLast ? (
                        <span className="jid-breadcrumb-current">{crumb.label}</span>
                      ) : (
                        <button className="jid-breadcrumb-link" onClick={crumb.onClick}>
                          {crumb.label}
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>
            )}

            {/* Level 1: Collection list */}
            {!selectedCollection && (
              <>
                {collectionsLoading ? (
                  <p className="jid-loading">Loading collections...</p>
                ) : collections.length === 0 ? (
                  <p className="jid-empty">No collections found</p>
                ) : (
                  <div className="jid-collection-list">
                    {collections.map((c) => (
                      <button
                        key={c.id}
                        className="jid-collection-item"
                        onClick={() => {
                          setSelectedCollection(c);
                          setSelectedLetter(null);
                        }}
                      >
                        <span className="jid-collection-code">{c.collectionCode}</span>
                        <span className="jid-collection-title">{c.title || 'Untitled'}</span>
                        <span className="jid-collection-count">{c.letterCount ?? 0} letters</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Level 2: Letter list in collection */}
            {selectedCollection && !selectedLetter && (
              <>
                {lettersLoading ? (
                  <p className="jid-loading">Loading letters...</p>
                ) : letters.length === 0 ? (
                  <p className="jid-empty">No letters in this collection</p>
                ) : (
                  <div className="jid-letter-grid">
                    {letters.map((letter) => {
                      const firstImage = letter.images?.[0];
                      const thumbUrl = firstImage
                        ? getImageUrl(firstImage.imageUrl, { width: 200 })
                        : null;
                      return (
                        <button
                          key={letter.id}
                          className="jid-letter-card"
                          onClick={() => setSelectedLetter(letter)}
                        >
                          {thumbUrl ? (
                            <RetryingImage
                              className="jid-letter-thumb"
                              src={thumbUrl}
                              alt={letter.title || 'Letter'}
                              loading="lazy"
                            />
                          ) : (
                            <div className="jid-letter-thumb-placeholder">No image</div>
                          )}
                          <span className="jid-letter-label">
                            {letter.title || letter.metadata?.sender || 'Untitled'}
                          </span>
                          <span className="jid-letter-pages">
                            {letter.images?.length || 0} page{(letter.images?.length || 0) !== 1 ? 's' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Level 3: Page images in letter */}
            {selectedLetter && (
              <>
                {imagesLoading ? (
                  <p className="jid-loading">Loading images...</p>
                ) : letterImages.length === 0 ? (
                  <p className="jid-empty">No images for this letter</p>
                ) : (
                  <div className="jid-page-grid">
                    {letterImages.map((img) => (
                      <button
                        key={img.id}
                        className="jid-page-card"
                        onClick={() => handleDatabaseImageSelect(img)}
                      >
                        <RetryingImage
                          className="jid-page-thumb"
                          src={getImageUrl(img.imageUrl, { width: 300 })}
                          alt={img.originalFilename || `Page ${img.pageNumber}`}
                          loading="lazy"
                        />
                        <span className="jid-page-label">
                          {img.type === 'letter' ? `Page ${img.pageNumber}` : img.type}
                          {img.originalFilename && (
                            <span className="jid-page-filename">{img.originalFilename}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
