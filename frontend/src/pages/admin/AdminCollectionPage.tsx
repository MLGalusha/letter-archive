import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useParams, Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import {
  getAdminCollectionByCode,
  generateCollectionProfile,
  updateCollectionEditor,
  type AdminCollectionWithLetters,
  type CollectionProfileCorrespondent,
  type ContentStatus,
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

interface CorrespondentRename {
  oldName: string;
  newName: string;
  roles: Array<'sender' | 'recipient'>;
}

interface AdminCollectionVisit {
  readonly code: string | undefined;
  isActive: () => boolean;
}

function useAdminCollectionVisit(
  code: string | undefined,
): AdminCollectionVisit {
  const activeVisitRef = useRef<AdminCollectionVisit | null>(null);
  const visit = useMemo<AdminCollectionVisit>(() => {
    const nextVisit: AdminCollectionVisit = {
      code,
      isActive: () => activeVisitRef.current === nextVisit,
    };
    return nextVisit;
  }, [code]);

  useLayoutEffect(() => {
    activeVisitRef.current = visit;

    return () => {
      if (activeVisitRef.current === visit) {
        activeVisitRef.current = null;
      }
    };
  }, [visit]);

  return visit;
}

const GENERIC_CORRESPONDENT_NAMES = new Set([
  'sender', 'recipient', 'the sender', 'the recipient',
  'the writer', 'the author', 'unknown', 'someone',
]);

function isGenericCorrespondentName(name: string): boolean {
  return GENERIC_CORRESPONDENT_NAMES.has(name.trim().toLowerCase());
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
  changes: Array<{
    previousName: string;
    nextName: string;
    hook: string;
    biography: string;
  }>,
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

  // Remove every original key before adding destinations so swaps and chains
  // are interpreted from the same snapshot as the backend letter renames.
  for (const change of changes) {
    entries.delete(normalizeCorrespondentName(change.previousName));
  }

  for (const change of changes) {
    const normalizedName = change.nextName.trim();
    const normalizedHook = normalizeOptionalProfileText(change.hook);
    const normalizedBiography = normalizeOptionalProfileText(change.biography);
    if (normalizedHook || normalizedBiography) {
      entries.set(normalizeCorrespondentName(normalizedName), {
        name: normalizedName,
        hook: normalizedHook,
        biography: normalizedBiography,
      });
    }
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

function prepareCorrespondentChanges(
  currentProfileCorrespondents: CollectionProfileCorrespondent[],
  correspondents: CollectionCorrespondent[],
  edits: Map<string, CorrespondentEditState>,
): {
  profileCorrespondents?: CollectionProfileCorrespondent[];
  renames: CorrespondentRename[];
} {
  const profileChanges: Parameters<typeof buildNextProfileCorrespondents>[1] = [];
  const renames: CorrespondentRename[] = [];

  for (const [key, edit] of edits) {
    if (!edit.dirty) continue;
    const person = correspondents.find((candidate) => candidate.key === key);
    if (!person) continue;

    const nextName = edit.name.trim();
    if (!nextName) continue;

    const nextHook = normalizeOptionalProfileText(edit.hook);
    const nextBiography = normalizeOptionalProfileText(edit.biography);
    const currentHook = normalizeOptionalProfileText(person.hook);
    const currentBiography = normalizeOptionalProfileText(person.biography);
    const nameChanged = nextName !== person.name;
    const correspondentProfileChanged =
      nextHook !== currentHook || nextBiography !== currentBiography;
    const shouldSaveProfile =
      correspondentProfileChanged
      || (nameChanged && Boolean(currentHook || currentBiography));

    if (nameChanged) {
      renames.push({
        oldName: person.name,
        newName: nextName,
        roles: person.roles,
      });
    }

    if (shouldSaveProfile) {
      profileChanges.push({
        previousName: person.name,
        nextName,
        hook: edit.hook,
        biography: edit.biography,
      });
    }
  }

  return {
    ...(profileChanges.length > 0
      ? {
          profileCorrespondents: buildNextProfileCorrespondents(
            currentProfileCorrespondents,
            profileChanges,
          ),
        }
      : {}),
    renames,
  };
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

function AdminCollectionRoute({
  code,
}: {
  code: string | undefined;
}) {
  const { showToast } = useToast();
  const visit = useAdminCollectionVisit(code);

  const [collection, setCollection] = useState<AdminCollectionWithLetters | null>(null);
  const [loading, setLoading] = useState(Boolean(code));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const profileMutationInFlightRef = useRef<AdminCollectionVisit | null>(null);

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
  }, [featuredLetter]);

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
  const publishedStats = useMemo(() => computeCollectionStats(publishedLetters), [publishedLetters]);

  const dialogCorrespondents = useMemo(
    () => correspondents.filter(c => !isGenericCorrespondentName(c.name)),
    [correspondents],
  );

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
    if (!code || !visit.isActive()) return;
    try {
      const coll = await getAdminCollectionByCode(code);
      if (!visit.isActive()) return;
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
      if (!visit.isActive()) return;
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      if (visit.isActive()) {
        setLoading(false);
      }
    }
  }, [code, showToast, visit]);

  useEffect(() => {
    queueMicrotask(() => void fetchData());
  }, [fetchData]);

  const handleGenerate = async () => {
    if (
      !code
      || !collection
      || dirty
      || saving
      || generating
      || profileMutationInFlightRef.current === visit
    ) {
      return;
    }
    profileMutationInFlightRef.current = visit;
    setShowWarningDialog(false);
    setGenerating(true);
    const force = profileStatus !== 'EMPTY';
    try {
      const result = await generateCollectionProfile(
        code,
        collection.profileRevision,
        force,
      );
      if (!visit.isActive()) return;
      setHook(result.hook || '');
      setNarrative(result.narrative || '');
      setProfileStatus(result.profileStatus);
      setCollection((current) => (
        current
          ? { ...current, profileRevision: result.profileRevision }
          : current
      ));
      setDirty(false);
      showToast(result.isStub ? 'Stub profile generated (no API key)' : 'Profile generated', 'success');
      await fetchData();
    } catch (err) {
      if (!visit.isActive()) return;
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
      await fetchData();
    } finally {
      if (visit.isActive()) {
        setGenerating(false);
      }
      if (profileMutationInFlightRef.current === visit) {
        profileMutationInFlightRef.current = null;
      }
    }
  };

  const handleSave = async () => {
    if (
      !code
      || !collection
      || saving
      || generating
      || showWarningDialog
      || profileMutationInFlightRef.current === visit
    ) {
      return;
    }
    profileMutationInFlightRef.current = visit;
    setSaving(true);
    try {
      const correspondentChanges = prepareCorrespondentChanges(
        collection.profileCorrespondents || [],
        correspondents,
        correspondentEdits,
      );

      const result = await updateCollectionEditor(code, {
        profileRevision: collection.profileRevision,
        identityFingerprint: collection.identityFingerprint,
        hook: hook || null,
        profileNarrative: narrative,
        profileStartHereLetterId: featuredLetterId,
        ...(correspondentChanges.profileCorrespondents
          ? { profileCorrespondents: correspondentChanges.profileCorrespondents }
          : {}),
        ...(descriptionDirty
          ? { description: description.trim() || null }
          : {}),
        correspondentRenames: correspondentChanges.renames,
      });

      if (!visit.isActive()) return;
      setCollection((current) => (
        current
          ? {
              ...current,
              profileRevision: result.profileRevision,
              identityFingerprint: result.identityFingerprint,
            }
          : current
      ));
      showToast('Updated', 'success');
      await fetchData();
    } catch (err) {
      if (!visit.isActive()) return;
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      if (visit.isActive()) {
        setSaving(false);
      }
      if (profileMutationInFlightRef.current === visit) {
        profileMutationInFlightRef.current = null;
      }
    }
  };

  const handleSelectFeaturedLetter = (letterId: string) => {
    if (saving || generating || showWarningDialog) return;
    const changed = letterId !== featuredLetterId;
    setFeaturedLetterId(letterId);
    resetLetterPickerControls();
    closeLetterPicker();
    setDirty((current) => current || changed);
  };

  const handleToggleLetterPicker = () => {
    if (saving || generating || showWarningDialog) return;
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

  const editorLocked = saving || generating || showWarningDialog;

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
          <Link to="/admin" className="acp-back-link">
            <Icon name="arrow-left" size={16} />
            Dashboard
          </Link>
          <div className="acp-header-actions-right">
            <Link to={`/collections/${collection.collectionCode}`} className="acp-view-live-btn" target="_blank">
              <Icon name="external-link" size={14} />
              View live
            </Link>
            <Button onClick={handleSave} disabled={!dirty || editorLocked} size="sm" className={dirty ? 'acp-update-btn has-changes' : 'acp-update-btn'}>
              {saving ? 'Updating...' : 'Update'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="acp-container" aria-busy={saving || generating}>
        {/* Header */}
        <div className="acp-header">
          <div className="acp-header-top">
            <div className="acp-header-copy">
              <h1 className="acp-title">{collection.title || `Collection ${collection.collectionCode}`}</h1>
              {publishedStats.formatBreakdown && (
                <p className="acp-subtitle">{publishedStats.formatBreakdown}</p>
              )}
            </div>
            <Button
              onClick={() => setShowWarningDialog(true)}
              disabled={saving || generating || dirty || showWarningDialog}
              size="sm"
              variant={profileStatus === 'EMPTY' ? 'primary' : 'secondary'}
            >
              {generating ? 'Generating...' : profileStatus === 'EMPTY' ? 'Generate profile' : 'Regenerate profile'}
            </Button>
          </div>
        </div>

        {/* Generate Profile Confirmation Dialog */}
        {showWarningDialog && (
          <div className="acp-dialog-overlay">
            <div className="acp-dialog acp-dialog--generate">
              <h3>{profileStatus === 'EMPTY' ? 'Generate Profile?' : 'Regenerate Profile?'}</h3>

              {profileStatus !== 'EMPTY' && (
                <p className="acp-dialog-warning">
                  This will overwrite the current hook, summary, featured letter, and correspondent bios with AI-generated content.
                </p>
              )}

              <div className="acp-dialog-stats">
                <p><strong>{publishedLetterCount}</strong> published {publishedLetterCount === 1 ? 'letter' : 'letters'} will be used for generation</p>
              </div>

              {dialogCorrespondents.length > 0 && (
                <div className="acp-dialog-correspondents">
                  <p className="acp-dialog-subheading">Correspondents ({dialogCorrespondents.length})</p>
                  <ul className="acp-dialog-correspondent-list">
                    {dialogCorrespondents.map(person => (
                      <li key={person.key}>
                        <span className="acp-dialog-person-name">{person.name}</span>
                        <span className="acp-dialog-person-counts">
                          {person.senderCount > 0 && `${person.senderCount} sent`}
                          {person.senderCount > 0 && person.recipientCount > 0 && ', '}
                          {person.recipientCount > 0 && `${person.recipientCount} received`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="acp-dialog-actions">
                <Button onClick={() => setShowWarningDialog(false)} variant="secondary">Cancel</Button>
                <Button
                  onClick={handleGenerate}
                  disabled={publishedLetterCount === 0 || saving || generating || dirty}
                >
                  {profileStatus === 'EMPTY' ? 'Generate' : 'Regenerate'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="acp-editor-grid">
          <div className="acp-section acp-section--profile">
            {showLetterPicker ? (
              <div className="acp-letter-picker-overlay" ref={pickerLayerRef} role="dialog" aria-label="Select featured letter">
                <div className="acp-picker-toolbar">
                  <label className="acp-picker-search-shell">
                    <svg className="acp-picker-search-icon" viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="8.75" cy="8.75" r="5.5" />
                      <path d="m12.5 12.5 4.25 4.25" />
                    </svg>
                    <input
                      type="search"
                      className="acp-picker-search"
                      placeholder="Search collection..."
                      value={pickerSearch}
                      disabled={editorLocked}
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
                        disabled={editorLocked}
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
                              disabled={editorLocked || pickerFormat === 'all'}
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
                                disabled={editorLocked}
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
                        disabled={editorLocked}
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
                                disabled={editorLocked}
                                onClick={() => handlePickerSortChange(option)}
                              >
                                <span className="acp-picker-sort-copy">
                                  <span className="acp-picker-sort-title">{option.label}</span>
                                  <span className="acp-picker-sort-meta">
                                    {getCollectionPickerSortLabel(option.value, optionOrder)}
                                  </span>
                                </span>
                                <span className="acp-picker-sort-arrow" aria-hidden="true">
                                  {optionOrder === 'asc' ? '\u2191' : '\u2193'}
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
                      disabled={editorLocked}
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
            ) : (
              <>
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
                    disabled={editorLocked}
                    onChange={(e) => { setHook(e.target.value); setDirty(true); }}
                    rows={2}
                    placeholder="Write or generate a collection hook..."
                    maxLength={500}
                  />
                  <p className="acp-hint">{hook.length} / 500</p>
                </div>

                <div className="acp-profile-block acp-profile-block--summary">
                  <div className="acp-section-heading">
                    <h3 className="acp-profile-block-title">Collection Summary</h3>
                    <p className="acp-hint">Narrative shown on the public collection page. Empty until you write one or generate a profile.</p>
                  </div>
                  <textarea
                    className="acp-textarea"
                    value={narrative}
                    disabled={editorLocked}
                    onChange={(e) => { setNarrative(e.target.value); setDirty(true); }}
                    rows={12}
                    placeholder="Write or generate a collection summary..."
                  />
                  <p className="acp-hint">{narrative.length} characters</p>
                </div>
              </>
            )}
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
                disabled={editorLocked}
                onChange={(e) => { setDescription(e.target.value); setDescriptionDirty(true); setDirty(true); }}
                rows={6}
                placeholder="Write or add collection notes..."
                maxLength={2000}
              />
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
                      disabled={editorLocked || publishedLetters.length === 0}
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
                      <button
                        type="button"
                        className="acp-text-btn"
                        onClick={handleToggleLetterPicker}
                        disabled={editorLocked}
                      >
                        Select one
                      </button>
                    </>
                  )}
              </div>
            )}
          </div>
        </div>

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
                        disabled={editorLocked}
                        onChange={(e) => {
                          const nextName = e.target.value;
                          setCorrespondentEdits((previous) => {
                            const next = new Map(previous);
                            const isDirty = isCorrespondentDirty(person, nextName, edit.hook, edit.biography);
                            next.set(person.key, { ...edit, name: nextName, dirty: isDirty });
                            return next;
                          });
                          setDirty(true);
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
                        disabled={editorLocked}
                        onChange={(e) => {
                          const nextHook = e.target.value;
                          setCorrespondentEdits((previous) => {
                            const next = new Map(previous);
                            const isDirty = isCorrespondentDirty(person, edit.name, nextHook, edit.biography);
                            next.set(person.key, { ...edit, hook: nextHook, dirty: isDirty });
                            return next;
                          });
                          setDirty(true);
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
                        disabled={editorLocked}
                        onChange={(e) => {
                          const nextBiography = e.target.value;
                          setCorrespondentEdits((previous) => {
                            const next = new Map(previous);
                            const isDirty = isCorrespondentDirty(person, edit.name, edit.hook, nextBiography);
                            next.set(person.key, { ...edit, biography: nextBiography, dirty: isDirty });
                            return next;
                          });
                          setDirty(true);
                        }}
                        rows={5}
                        placeholder="Collection-specific description or biography..."
                      />
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

export default function AdminCollectionPage() {
  const { code } = useParams<{ code: string }>();

  return <AdminCollectionRoute key={code ?? 'missing'} code={code} />;
}
