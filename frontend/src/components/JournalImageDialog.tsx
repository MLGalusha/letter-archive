import { useState, useEffect, useCallback, useRef } from 'react';
import { getAdminCollections, getAdminCollectionByCode, type AdminCollectionInfo } from '../api/collections';
import { getImageUrl } from '../api/client';
import { uploadBlogImage } from '../api/admin/content';
import { getAdminLetterById } from '../api/letters';
import type { Letter, LetterImage } from '../types/Letter';
import Modal from './common/Modal';
import { Button } from './common';
import './JournalImageDialog.css';

type Tab = 'url' | 'upload' | 'database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, alt?: string) => void;
}

export default function JournalImageDialog({ isOpen, onClose, onInsert }: Props) {
  const [tab, setTab] = useState<Tab>('url');

  // URL tab
  const [urlInput, setUrlInput] = useState('');
  const [altInput, setAltInput] = useState('');

  // Upload tab
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Database tab
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<AdminCollectionInfo | null>(null);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<Letter | null>(null);
  const [letterImages, setLetterImages] = useState<LetterImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setUrlInput('');
      setAltInput('');
      setUploadError(null);
      setSelectedCollection(null);
      setSelectedLetter(null);
      setLetters([]);
      setLetterImages([]);
    }
  }, [isOpen]);

  // Load collections when database tab is first selected
  useEffect(() => {
    if (tab === 'database' && collections.length === 0 && !collectionsLoading) {
      setCollectionsLoading(true);
      getAdminCollections()
        .then((cols) => setCollections(cols.filter((c) => (c.letterCount ?? 0) > 0)))
        .catch(() => {})
        .finally(() => setCollectionsLoading(false));
    }
  }, [tab, collections.length, collectionsLoading]);

  // Load letters when a collection is selected
  useEffect(() => {
    if (!selectedCollection) {
      setLetters([]);
      setSelectedLetter(null);
      setLetterImages([]);
      return;
    }
    setLettersLoading(true);
    setSelectedLetter(null);
    setLetterImages([]);
    getAdminCollectionByCode(selectedCollection.collectionCode)
      .then((col) => setLetters(col.letters || []))
      .catch(() => setLetters([]))
      .finally(() => setLettersLoading(false));
  }, [selectedCollection]);

  // Load full letter detail (with all images) when a letter is selected
  useEffect(() => {
    if (!selectedLetter) {
      setLetterImages([]);
      return;
    }
    setImagesLoading(true);
    getAdminLetterById(selectedLetter.id)
      .then((full) => setLetterImages(full.images || []))
      .catch(() => setLetterImages(selectedLetter.images || []))
      .finally(() => setImagesLoading(false));
  }, [selectedLetter]);

  const handleUrlInsert = useCallback(() => {
    if (!urlInput.trim()) return;
    onInsert(urlInput.trim(), altInput.trim() || undefined);
    onClose();
  }, [urlInput, altInput, onInsert, onClose]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadBlogImage(file);
      onInsert(result.url, file.name.replace(/\.[^.]+$/, ''));
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
                  src={urlInput.trim()}
                  alt={altInput || 'Preview'}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
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
                        onClick={() => setSelectedCollection(c)}
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
                            <img
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
                        <img
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
