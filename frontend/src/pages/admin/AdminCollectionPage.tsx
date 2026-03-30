import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import { getErrorMessage } from '../../api/client';
import {
  getAdminCollectionByCode,
  generateCollectionProfile,
  updateCollection,
  updateCollectionProfile,
  type CollectionWithLetters,
  type CollectionProfileCorrespondent,
  type ContentStatus,
  renameCollectionCorrespondent,
} from '../../api/collections';
import { useToast } from '../../contexts/ToastContext';
import ShowcaseCard, { type ShowcaseItem } from '../../components/ShowcaseCard';
import LetterCard from '../../components/LetterCard/LetterCard';
import { buildLetterCardData, getPrimaryMediaType } from '../../utils/letterPreview';
import type { Letter } from '../../types/Letter';
import { computeCollectionStats } from '../collection-detail-utils';
import {
  COLLECTION_PICKER_DEFAULT_SORT,
  COLLECTION_PICKER_DEFAULT_SORT_ORDER,
  COLLECTION_PICKER_SORT_OPTIONS,
  filterAndSortCollectionPickerLetters,
  getCollectionPickerFormatOptions,
  getCollectionPickerSortLabel,
  type CollectionPickerFormat,
  type CollectionPickerSortField,
  type CollectionPickerSortOption,
} from './adminCollectionPicker';
import './AdminCollectionPage.css';

interface CorrespondentEditState {
  name: string;
  hook: string;
  biography: string;
  dirty: boolean;
  saving: boolean;
}

interface CollectionCorrespondent {
  key: string;
  name: string;
  senderCount: number;
  recipientCount: number;
  totalLetters: number;
  roles: Array<'sender' | 'recipient'>;
  hook: string | null;
  biography: string | null;
}

function normalizeCorrespondentName(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

function normalizeOptionalProfileText(value: string | null | undefined) {
  const normalized = value?.trim() || '';
  return normalized.length > 0 ? normalized : null;
}

function buildNextProfileCorrespondents(
  current: CollectionProfileCorrespondent[],
  previousName: string,
  nextName: string,
  hook: string,
  biography: string,
): CollectionProfileCorrespondent[] {
  const entries = new Map<string, CollectionProfileCorrespondent>();

  for (const person of current) {
    const key = normalizeCorrespondentName(person.name);
    if (!key) continue;
    entries.set(key, {
      name: person.name.trim(),
      hook: normalizeOptionalProfileText(person.hook),
      biography: normalizeOptionalProfileText(person.biography),
    });
  }

  entries.delete(normalizeCorrespondentName(previousName));

  const normalizedName = nextName.trim();
  const normalizedHook = normalizeOptionalProfileText(hook);
  const normalizedBiography = normalizeOptionalProfileText(biography);

  if (normalizedHook || normalizedBiography) {
    entries.set(normalizeCorrespondentName(normalizedName), {
      name: normalizedName,
      hook: normalizedHook,
      biography: normalizedBiography,
    });
  }

  return Array.from(entries.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function isCorrespondentDirty(
  correspondent: CollectionCorrespondent,
  name: string,
  hook: string,
  biography: string,
) {
  return name.trim() !== correspondent.name
    || normalizeOptionalProfileText(hook) !== normalizeOptionalProfileText(correspondent.hook)
    || normalizeOptionalProfileText(biography) !== normalizeOptionalProfileText(correspondent.biography);
}

function buildCollectionCorrespondents(
  letters: Letter[],
  profileCorrespondents: CollectionProfileCorrespondent[] = [],
): CollectionCorrespondent[] {
  const map = new Map<string, CollectionCorrespondent & { letterIds: Set<string> }>();

  for (const letter of letters) {
    const sender = letter.metadata.sender?.trim();
    const recipient = letter.metadata.recipient?.trim();

    if (sender) {
      const key = normalizeCorrespondentName(sender);
      const existing = map.get(key);
      if (existing) {
        existing.senderCount += 1;
        existing.letterIds.add(letter.id);
        if (!existing.roles.includes('sender')) existing.roles.push('sender');
      } else {
        map.set(key, {
          key,
          name: sender,
          senderCount: 1,
          recipientCount: 0,
          totalLetters: 0,
          roles: ['sender'],
          hook: null,
          biography: null,
          letterIds: new Set([letter.id]),
        });
      }
    }

    if (recipient) {
      const key = normalizeCorrespondentName(recipient);
      const existing = map.get(key);
      if (existing) {
        existing.recipientCount += 1;
        existing.letterIds.add(letter.id);
        if (!existing.roles.includes('recipient')) existing.roles.push('recipient');
      } else {
        map.set(key, {
          key,
          name: recipient,
          senderCount: 0,
          recipientCount: 1,
          totalLetters: 0,
          roles: ['recipient'],
          hook: null,
          biography: null,
          letterIds: new Set([letter.id]),
        });
      }
    }
  }

  const overrideMap = new Map(
    profileCorrespondents
      .filter((person) => person.name.trim().length > 0)
      .map((person) => [normalizeCorrespondentName(person.name), person] as const),
  );

  return Array.from(map.values()).map(({ letterIds, ...person }) => ({
    ...person,
    totalLetters: letterIds.size,
    hook: overrideMap.get(person.key)?.hook || null,
    biography: overrideMap.get(person.key)?.biography || null,
  })).sort((left, right) => {
    if (right.totalLetters !== left.totalLetters) return right.totalLetters - left.totalLetters;
    return left.name.localeCompare(right.name);
  });
}

export default function AdminCollectionPage() {
  const { code } = useParams<{ code: string }>();
  const { showToast } = useToast();

  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);

  // Featured letter
  const [featuredLetterId, setFeaturedLetterId] = useState<string | null>(null);
  const [showLetterPicker, setShowLetterPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFormat, setPickerFormat] = useState<CollectionPickerFormat>('all');
  const [pickerSort, setPickerSort] = useState<CollectionPickerSortField>(COLLECTION_PICKER_DEFAULT_SORT);
  const [pickerSortOrder, setPickerSortOrder] = useState<'asc' | 'desc'>(COLLECTION_PICKER_DEFAULT_SORT_ORDER);
  const [showPickerFilters, setShowPickerFilters] = useState(false);
  const [showPickerSort, setShowPickerSort] = useState(false);
  const pickerLayerRef = useRef<HTMLDivElement | null>(null);
  const changeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Editable profile fields (only hook + summary now)
  const [hook, setHook] = useState('');
  const [narrative, setNarrative] = useState('');
  const [profileStatus, setProfileStatus] = useState<ContentStatus>('EMPTY');
  const [dirty, setDirty] = useState(false);

  // Collection description (admin-written extra info)
  const [description, setDescription] = useState('');
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [descriptionSaving, setDescriptionSaving] = useState(false);

  // Collection-scoped correspondent renames
  const [correspondentEdits, setCorrespondentEdits] = useState<Map<string, CorrespondentEditState>>(new Map());

  const publishedLetters = useMemo(
    () => (collection?.letters ?? []).filter((letter) => letter.visibility === 'PUBLISHED'),
    [collection?.letters],
  );

  // Look up featured letter by ID (auto-pick happens in fetchData, not here)
  const featuredLetter = useMemo<Letter | null>(() => {
    if (!featuredLetterId) return null;
    return publishedLetters.find((letter) => letter.id === featuredLetterId)
      || collection?.letters.find((letter) => letter.id === featuredLetterId)
      || null;
  }, [collection?.letters, featuredLetterId, publishedLetters]);

  // Build ShowcaseCard items from featured letter
  const showcaseItems = useMemo<ShowcaseItem[]>(() => {
    if (!featuredLetter) return [];
    const images = featuredLetter.images || [];
    const mediaType = getPrimaryMediaType(featuredLetter);
    const sender = featuredLetter.metadata.sender?.trim();
    const recipient = featuredLetter.metadata.recipient?.trim();
    const peopleLine = sender && recipient
      ? `${sender} \u2192 ${recipient}`
      : sender || recipient || '';
    const date = featuredLetter.metadata.date || featuredLetter.metadata.dateRaw || '';
    const letterHook = mediaType === 'photo'
      ? (featuredLetter.photoDescription || featuredLetter.metadata.hook || '')
      : (featuredLetter.metadata.hook || featuredLetter.photoDescription || '');
    const label = 'Featured Letter';

    if (images.length > 0) {
      return images.map((img) => ({
        letterId: featuredLetter.id,
        imageId: img.id,
        imageUrl: img.imageUrl || '',
        label,
        peopleLine,
        date,
        hook: letterHook,
        mediaType,
      }));
    }
    return [{
      letterId: featuredLetter.id,
      imageUrl: '',
      label,
      peopleLine,
      date,
      hook: letterHook,
      mediaType,
    }];
  }, [featuredLetter, featuredLetterId]);

  // Filter letters for picker
  const pickerFormatOptions = useMemo(
    () => getCollectionPickerFormatOptions(publishedLetters),
    [publishedLetters],
  );

  const filteredLetters = useMemo(() => {
    return filterAndSortCollectionPickerLetters(publishedLetters, {
      search: pickerSearch,
      format: pickerFormat,
      sort: pickerSort,
      sortOrder: pickerSortOrder,
    });
  }, [pickerFormat, pickerSearch, pickerSort, pickerSortOrder, publishedLetters]);

  const pickerSortLabel = useMemo(
    () => getCollectionPickerSortLabel(pickerSort, pickerSortOrder),
    [pickerSort, pickerSortOrder],
  );

  const pickerActiveFilterCount = pickerFormat === 'all' ? 0 : 1;
  const pickerActiveFormat = pickerFormatOptions.find((option) => option.value === pickerFormat) || null;

  const correspondents = useMemo(
    () => buildCollectionCorrespondents(collection?.letters ?? [], collection?.profileCorrespondents ?? []),
    [collection?.letters, collection?.profileCorrespondents],
  );

  const publishedLetterCount = publishedLetters.length;
  const actualLetterCount = collection?.letters.length ?? collection?.letterCount ?? 0;
  const publishedStats = useMemo(() => computeCollectionStats(publishedLetters), [publishedLetters]);

  const resetLetterPickerControls = useCallback(() => {
    setPickerSearch('');
    setPickerFormat('all');
    setPickerSort(COLLECTION_PICKER_DEFAULT_SORT);
    setPickerSortOrder(COLLECTION_PICKER_DEFAULT_SORT_ORDER);
    setShowPickerFilters(false);
    setShowPickerSort(false);
  }, []);

  const closeLetterPicker = useCallback(() => {
    setShowLetterPicker(false);
    setShowPickerFilters(false);
    setShowPickerSort(false);
  }, []);

  useEffect(() => {
    if (!showLetterPicker) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (pickerLayerRef.current?.contains(event.target as Node)) return;
      if (changeBtnRef.current?.contains(event.target as Node)) return;
      closeLetterPicker();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showPickerFilters) {
        setShowPickerFilters(false);
        return;
      }

      if (showPickerSort) {
        setShowPickerSort(false);
        return;
      }

      closeLetterPicker();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeLetterPicker, showLetterPicker, showPickerFilters, showPickerSort]);

  const fetchData = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    try {
      const coll = await getAdminCollectionByCode(code);
      setCollection(coll);

      const c = coll as unknown as Record<string, unknown>;
      setHook((c.hook as string) || '');
      setNarrative((c.profileNarrative as string) || '');
      setProfileStatus((c.profileStatus as ContentStatus) || 'EMPTY');

      setFeaturedLetterId((c.profileStartHereLetterId as string) || null);
      setDescription((coll.description as string) || '');
      setDirty(false);
      setDescriptionDirty(false);

      const nextCorrespondentEdits = new Map<string, CorrespondentEditState>();
      for (const correspondent of buildCollectionCorrespondents(coll.letters || [], coll.profileCorrespondents || [])) {
        nextCorrespondentEdits.set(correspondent.key, {
          name: correspondent.name,
          hook: correspondent.hook || '',
          biography: correspondent.biography || '',
          dirty: false,
          saving: false,
        });
      }
      setCorrespondentEdits(nextCorrespondentEdits);
    } catch (err) {
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      setLoading(false);
    }
  }, [code, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerate = async (force = false) => {
    if (!code) return;
    if (!force && profileStatus !== 'EMPTY') {
      setShowWarningDialog(true);
      return;
    }
    setShowWarningDialog(false);
    setGenerating(true);
    try {
      const result = await generateCollectionProfile(code, force || profileStatus !== 'EMPTY');
      setHook(result.hook || '');
      setNarrative(result.narrative || '');
      if (result.startHereLetterId) setFeaturedLetterId(result.startHereLetterId);
      setProfileStatus(result.profileStatus);
      setDirty(false);
      showToast(result.isStub ? 'Stub profile generated (no API key)' : 'Profile generated', 'success');
      fetchData();
    } catch (err) {
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!code) return;
    setSaving(true);
    try {
      await updateCollectionProfile(code, {
        hook: hook || null,
        profileNarrative: narrative,
        profileStartHereLetterId: featuredLetterId,
      });
      setDirty(false);
      showToast('Saved', 'success');
      fetchData();
    } catch (err) {
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDescription = async () => {
    if (!code || !descriptionDirty) return;
    setDescriptionSaving(true);
    try {
      await updateCollection(code, { description: description.trim() || null });
      setDescriptionDirty(false);
      showToast('Description saved', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      setDescriptionSaving(false);
    }
  };

  const handleSelectFeaturedLetter = (letterId: string) => {
    const changed = letterId !== featuredLetterId;
    setFeaturedLetterId(letterId);
    resetLetterPickerControls();
    closeLetterPicker();
    setDirty((current) => current || changed);
  };

  const handleToggleLetterPicker = () => {
    if (showLetterPicker) {
      closeLetterPicker();
      return;
    }

    resetLetterPickerControls();
    setShowLetterPicker(true);
  };

  const handlePickerSortChange = (option: CollectionPickerSortOption) => {
    if (pickerSort === option.value) {
      setPickerSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
    } else {
      setPickerSort(option.value);
      setPickerSortOrder(option.defaultOrder);
    }
    setShowPickerSort(false);
  };

  const pickerResultsLabel = (() => {
    if (publishedLetterCount === 0) return 'No published letters in this collection yet';
    if (filteredLetters.length === publishedLetterCount) {
      return `${publishedLetterCount} ${publishedLetterCount === 1 ? 'published letter' : 'published letters'} ready to browse`;
    }
    return `${filteredLetters.length} of ${publishedLetterCount} ${publishedLetterCount === 1 ? 'published letter' : 'published letters'} showing`;
  })();

  const statusLabel = (status: ContentStatus) => {
    switch (status) {
      case 'EMPTY': return 'No profile';
      case 'AI_DRAFT': return 'AI Draft';
      case 'EDITED': return 'Edited';
      case 'VERIFIED': return 'Verified';
    }
  };

  const statusClass = (status: ContentStatus) => {
    switch (status) {
      case 'EMPTY': return 'status-empty';
      case 'AI_DRAFT': return 'status-draft';
      case 'EDITED': return 'status-edited';
      case 'VERIFIED': return 'status-verified';
    }
  };

  const handleSaveCorrespondent = async (correspondent: CollectionCorrespondent) => {
    if (!code || !collection) return;
    const edit = correspondentEdits.get(correspondent.key);
    const nextName = edit?.name.trim() || '';
    const nextHook = normalizeOptionalProfileText(edit?.hook);
    const nextBiography = normalizeOptionalProfileText(edit?.biography);
    const currentHook = normalizeOptionalProfileText(correspondent.hook);
    const currentBiography = normalizeOptionalProfileText(correspondent.biography);
    const nameChanged = nextName.length > 0 && nextName !== correspondent.name;
    const profileChanged = nextHook !== currentHook || nextBiography !== currentBiography;
    const shouldSaveProfile = profileChanged || (nameChanged && Boolean(currentHook || currentBiography));

    if (!edit || !edit.dirty || nextName.length === 0 || (!nameChanged && !shouldSaveProfile)) {
      return;
    }

    setCorrespondentEdits((previous) => {
      const next = new Map(previous);
      next.set(correspondent.key, { ...edit, saving: true });
      return next;
    });

    try {
      if (nameChanged) {
        const response = await renameCollectionCorrespondent(code, {
          oldName: correspondent.name,
          newName: nextName,
          roles: correspondent.roles,
        });
        showToast(response.message, 'success');
      }

      if (shouldSaveProfile) {
        await updateCollectionProfile(code, {
          profileCorrespondents: buildNextProfileCorrespondents(
            collection.profileCorrespondents || [],
            correspondent.name,
            nextName,
            edit.hook,
            edit.biography,
          ),
        });
      }

      if (!nameChanged && shouldSaveProfile) {
        showToast('Correspondent details saved', 'success');
      }

      await fetchData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to rename correspondent'), 'error');
      setCorrespondentEdits((previous) => {
        const next = new Map(previous);
        next.set(correspondent.key, { ...edit, saving: false });
        return next;
      });
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="acp-loading">Loading collection...</div>
      </AdminLayout>
    );
  }

  if (!collection) {
    return (
      <AdminLayout>
        <div className="acp-error">Collection not found</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      headerActions={
        <div className="acp-header-actions">
          <Link to="/admin" className="acp-back-link">&larr; Dashboard</Link>
        </div>
      }
    >
      <div className="acp-container">
        {/* Header */}
        <div className="acp-header">
          <div className="acp-header-top">
            <div className="acp-header-copy">
              <p className="acp-kicker">Admin Collection</p>
              <h1 className="acp-title">{collection.title || `Collection ${collection.collectionCode}`}</h1>
              <p className="acp-subtitle">
                Collection {collection.collectionCode} · {actualLetterCount} items · {publishedLetterCount} published
              </p>
              {publishedStats.formatBreakdown && (
                <p className="acp-subtitle acp-format-breakdown">{publishedStats.formatBreakdown}</p>
              )}
              <div className="acp-header-metrics">
                <span className="acp-metric-pill">{correspondents.length} correspondents</span>
                <span className={`acp-status-badge ${statusClass(profileStatus)}`}>
                  {statusLabel(profileStatus)}
                </span>
              </div>
            </div>
            {dirty && (
              <div className="acp-header-right">
                <Button onClick={handleSave} disabled={saving} size="sm">
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Regenerate Warning Dialog */}
        {showWarningDialog && (
          <div className="acp-dialog-overlay">
            <div className="acp-dialog">
              <h3>Regenerate Profile?</h3>
              <p>This will overwrite the current hook, summary, and featured letter with AI-generated content.</p>
              <div className="acp-dialog-actions">
                <Button onClick={() => setShowWarningDialog(false)} variant="secondary">Cancel</Button>
                <Button onClick={() => handleGenerate(true)}>Regenerate</Button>
              </div>
            </div>
          </div>
        )}

        <div className="acp-editor-grid">
          <div className="acp-section acp-section--profile">
            <div className="acp-section-heading">
              <h2>Collection Profile</h2>
              <p className="acp-hint">Edit the public-facing hook and summary together here. If nothing has been written or generated yet, both fields stay empty.</p>
            </div>

            <div className="acp-profile-block acp-profile-block--hook">
              <h3 className="acp-profile-block-title">Collection Hook</h3>
              <p className="acp-hint">A short teaser for the public collection page. Empty until you write one or generate a profile.</p>
              <textarea
                className="acp-textarea"
                value={hook}
                onChange={(e) => { setHook(e.target.value); setDirty(true); }}
                rows={2}
                placeholder="e.g. A wartime love story told through 27 letters..."
                maxLength={500}
              />
              <p className="acp-hint">{hook.length} / 500</p>
            </div>

            <div className="acp-profile-block acp-profile-block--summary">
              <div className="acp-profile-block-header">
                <div className="acp-section-heading">
                  <h3 className="acp-profile-block-title">Collection Summary</h3>
                  <p className="acp-hint">Narrative shown on the public collection page. Empty until you write one or generate a profile.</p>
                </div>
                <div className="acp-profile-actions">
                  <Button
                    onClick={() => handleGenerate(profileStatus !== 'EMPTY')}
                    disabled={generating}
                    size="sm"
                  >
                    {generating ? 'Generating...' : profileStatus === 'EMPTY' ? 'Generate profile' : 'Regenerate profile'}
                  </Button>
                </div>
              </div>
              <textarea
                className="acp-textarea"
                value={narrative}
                onChange={(e) => { setNarrative(e.target.value); setDirty(true); }}
                rows={12}
                placeholder="Write or generate a collection summary..."
              />
              <p className="acp-hint">{narrative.length} characters</p>
            </div>
          </div>

          <div className="acp-section acp-section--picker acp-section--featured">
            <div className="acp-featured-description">
              <div className="acp-featured-desc-header">
                <h3 className="acp-profile-block-title">Collection Notes</h3>
                <p className="acp-hint">Visible on the public page — add context or background for visitors.</p>
              </div>
              <textarea
                id="collection-description"
                className="acp-textarea acp-featured-desc-input"
                value={description}
                onChange={(e) => { setDescription(e.target.value); setDescriptionDirty(true); }}
                rows={6}
                placeholder="e.g. Twenty-seven letters from an American serviceman to the woman he loved in England..."
                maxLength={2000}
              />
              {descriptionDirty && (
                <div className="acp-featured-desc-footer">
                  <Button variant="secondary" size="sm" onClick={handleSaveDescription} disabled={descriptionSaving}>
                    {descriptionSaving ? 'Saving...' : 'Save info'}
                  </Button>
                </div>
              )}
            </div>

            {featuredLetter && showcaseItems.length > 0 ? (
              <div className="acp-featured-showcase">
                <div className="acp-featured-card-wrapper">
                  <div className="acp-featured-controls">
                    <button
                      ref={changeBtnRef}
                      type="button"
                      className="acp-featured-change"
                      onClick={handleToggleLetterPicker}
                      disabled={publishedLetters.length === 0}
                    >
                      {showLetterPicker ? 'Close' : 'Change'}
                    </button>
                  </div>
                  <ShowcaseCard
                    items={showcaseItems}
                    onNavigate={() => {/* no-op on admin — no navigation */}}
                  />
                </div>
              </div>
            ) : (
              <div className="acp-empty-state">
                {publishedLetters.length === 0
                  ? 'No published letters are available to feature yet.'
                  : (
                    <>
                      No featured letter selected.{' '}
                      <button type="button" className="acp-text-btn" onClick={handleToggleLetterPicker}>Select one</button>
                    </>
                  )}
              </div>
            )}
          </div>
        </div>

        {/* Letter picker — spans full width below the editor grid */}
        {showLetterPicker && (
          <div className="acp-section acp-section--picker" ref={pickerLayerRef}>
            <div className="acp-letter-picker-overlay" role="dialog" aria-label="Select featured letter">
              <div className="acp-picker-toolbar">
                <label className="acp-picker-search-shell">
                  <svg className="acp-picker-search-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="8.75" cy="8.75" r="5.5" />
                    <path d="m12.5 12.5 4.25 4.25" />
                  </svg>
                  <input
                    type="search"
                    className="acp-picker-search"
                    placeholder="Search sender, recipient, date, hook..."
                    value={pickerSearch}
                    onChange={(event) => setPickerSearch(event.target.value)}
                  />
                </label>

                <div className="acp-picker-toolbar-actions">
                  <div className="acp-picker-dropdown">
                    <button
                      type="button"
                      className={`acp-picker-control${showPickerFilters ? ' is-active' : ''}`}
                      aria-expanded={showPickerFilters}
                      aria-haspopup="menu"
                      onClick={() => {
                        setShowPickerFilters((current) => {
                          const next = !current;
                          if (next) setShowPickerSort(false);
                          return next;
                        });
                      }}
                    >
                      <svg viewBox="0 0 14 14" aria-hidden="true">
                        <path d="M1.5 2.5h11L8 7.5v4l-2 1.5V7.5z" />
                      </svg>
                      <span>Filter</span>
                      {pickerActiveFilterCount > 0 && (
                        <span className="acp-picker-control-count">{pickerActiveFilterCount}</span>
                      )}
                    </button>
                          {showPickerFilters && (
                            <div className="acp-picker-menu acp-picker-menu--filters" role="menu">
                              <div className="acp-picker-menu-header">
                                <span className="acp-picker-menu-kicker">Media Type</span>
                                <button
                                  type="button"
                                  className="acp-picker-menu-reset"
                                  onClick={() => setPickerFormat('all')}
                                  disabled={pickerFormat === 'all'}
                                >
                                  Reset
                                </button>
                              </div>
                              <div className="acp-picker-filter-list">
                                {pickerFormatOptions.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    className={`acp-picker-filter-chip${option.value === pickerFormat ? ' is-active' : ''}`}
                                    onClick={() => {
                                      setPickerFormat(option.value);
                                      setShowPickerFilters(false);
                                    }}
                                  >
                                    <span>{option.label}</span>
                                    <span className="acp-picker-filter-count">{option.count}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="acp-picker-dropdown">
                          <button
                            type="button"
                            className={`acp-picker-control${showPickerSort ? ' is-active' : ''}`}
                            aria-expanded={showPickerSort}
                            aria-haspopup="menu"
                            onClick={() => {
                              setShowPickerSort((current) => {
                                const next = !current;
                                if (next) setShowPickerFilters(false);
                                return next;
                              });
                            }}
                          >
                            <span>Sort</span>
                            <span className="acp-picker-control-value">{pickerSortLabel}</span>
                          </button>
                          {showPickerSort && (
                            <div className="acp-picker-menu acp-picker-menu--sort" role="menu">
                              {COLLECTION_PICKER_SORT_OPTIONS.map((option) => {
                                const isActive = option.value === pickerSort;
                                const optionOrder = isActive ? pickerSortOrder : option.defaultOrder;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    className={`acp-picker-sort-option${isActive ? ' is-active' : ''}`}
                                    onClick={() => handlePickerSortChange(option)}
                                  >
                                    <span className="acp-picker-sort-copy">
                                      <span className="acp-picker-sort-title">{option.label}</span>
                                      <span className="acp-picker-sort-meta">
                                        {getCollectionPickerSortLabel(option.value, optionOrder)}
                                      </span>
                                    </span>
                                    <span className="acp-picker-sort-arrow" aria-hidden="true">
                                      {optionOrder === 'asc' ? '↑' : '↓'}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

              <div className="acp-picker-toolbar-footer">
                <p className="acp-picker-results">{pickerResultsLabel}</p>
                {pickerActiveFormat && pickerActiveFormat.value !== 'all' && (
                  <button
                    type="button"
                    className="acp-picker-inline-clear"
                    onClick={() => setPickerFormat('all')}
                  >
                    Showing {pickerActiveFormat.label.toLowerCase()}
                  </button>
                )}
              </div>

              <div className="letter-grid acp-picker-grid">
                {filteredLetters.map((letter) => (
                  <div
                    key={letter.id}
                    className={`acp-picker-card${letter.id === featuredLetterId ? ' acp-picker-card--selected' : ''}`}
                  >
                    <LetterCard
                      card={buildLetterCardData(letter)}
                      onClick={handleSelectFeaturedLetter}
                    />
                  </div>
                ))}
                {filteredLetters.length === 0 && (
                  <p className="acp-picker-empty">No letters match the current search or filter.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Correspondents — collection-scoped rename controls */}
        <div className="acp-section acp-section--correspondents">
          <div className="acp-section-heading">
            <h2>Correspondents {correspondents.length > 0 && `(${correspondents.length})`}</h2>
            <p className="acp-hint">Rename a sender or recipient across every matching letter in this collection only. This does not rely on old collection-profile drafts.</p>
          </div>
          {correspondents.length === 0 ? (
            <p className="acp-empty-note">No sender or recipient names exist in this collection yet.</p>
          ) : (
            <div className="acp-correspondent-grid">
              {correspondents.map((person) => {
                const edit = correspondentEdits.get(person.key);
                if (!edit) return null;
                const trimmedName = edit.name.trim();
                const editedKey = normalizeCorrespondentName(trimmedName);
                const mergeTarget = editedKey && editedKey !== person.key
                  ? correspondents.find((c) => c.key === editedKey)
                  : null;
                const roleLabel = person.roles.length === 2
                  ? 'Sender + recipient'
                  : person.roles[0] === 'sender'
                    ? 'Sender'
                    : 'Recipient';
                const saveDisabled = edit.saving
                  || trimmedName.length === 0
                  || !edit.dirty;

                return (
                  <div key={person.key} className="acp-person-card">
                    <div className="acp-person-header">
                      <span className="acp-person-label">{roleLabel}</span>
                      <span className="acp-person-total">{person.totalLetters} letters</span>
                    </div>
                    <div className="acp-person-field">
                      <label htmlFor={`correspondent-${person.key}`}>Name</label>
                      <input
                        id={`correspondent-${person.key}`}
                        type="text"
                        className="acp-input acp-full-width"
                        value={edit.name}
                        onChange={(e) => {
                          const nextName = e.target.value;
                          setCorrespondentEdits((previous) => {
                            const next = new Map(previous);
                            next.set(person.key, {
                              ...edit,
                              name: nextName,
                              dirty: isCorrespondentDirty(person, nextName, edit.hook, edit.biography),
                            });
                            return next;
                          });
                        }}
                        placeholder="Rename this correspondent for the whole collection..."
                        maxLength={255}
                      />
                      {mergeTarget && (
                        <p className="acp-person-merge-hint">
                          Will merge with {mergeTarget.name} ({mergeTarget.totalLetters} letters)
                        </p>
                      )}
                    </div>
                    <div className="acp-person-field">
                      <label htmlFor={`correspondent-hook-${person.key}`}>Hook</label>
                      <textarea
                        id={`correspondent-hook-${person.key}`}
                        className="acp-textarea"
                        value={edit.hook}
                        onChange={(e) => {
                          const nextHook = e.target.value;
                          setCorrespondentEdits((previous) => {
                            const next = new Map(previous);
                            next.set(person.key, {
                              ...edit,
                              hook: nextHook,
                              dirty: isCorrespondentDirty(person, edit.name, nextHook, edit.biography),
                            });
                            return next;
                          });
                        }}
                        rows={2}
                        placeholder="Short hook for this sender or recipient..."
                        maxLength={500}
                      />
                    </div>
                    <div className="acp-person-field">
                      <label htmlFor={`correspondent-bio-${person.key}`}>Biography</label>
                      <textarea
                        id={`correspondent-bio-${person.key}`}
                        className="acp-textarea acp-person-biography"
                        value={edit.biography}
                        onChange={(e) => {
                          const nextBiography = e.target.value;
                          setCorrespondentEdits((previous) => {
                            const next = new Map(previous);
                            next.set(person.key, {
                              ...edit,
                              biography: nextBiography,
                              dirty: isCorrespondentDirty(person, edit.name, edit.hook, nextBiography),
                            });
                            return next;
                          });
                        }}
                        rows={5}
                        placeholder="Collection-specific description or biography..."
                      />
                    </div>
                    <div className="acp-person-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={saveDisabled}
                        onClick={() => handleSaveCorrespondent(person)}
                      >
                        {edit.saving ? 'Saving...' : mergeTarget ? 'Merge & save' : 'Save correspondent'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
