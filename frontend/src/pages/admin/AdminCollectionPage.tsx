import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import { getErrorMessage } from '../../api/client';
import {
  getAdminCollectionByCode,
  generateCollectionProfile,
  updateCollectionProfile,
  getCollectionProfile,
  type CollectionWithLetters,
  type KeyPerson,
  type ContentStatus,
} from '../../api/collections';
import {
  generateBiography as generatePersonBiography,
  saveBiography as savePersonBiography,
} from '../../api/entities/persons';
import { useToast } from '../../contexts/ToastContext';
import ShowcaseCard, { type ShowcaseItem } from '../../components/ShowcaseCard';
import LetterCard from '../../components/LetterCard/LetterCard';
import { buildLetterCardData, getPrimaryMediaType, getMediaLabel } from '../../utils/letterPreview';
import type { Letter } from '../../types/Letter';
import './AdminCollectionPage.css';

interface PersonEditState {
  biography: string;
  hook: string;
  dirty: boolean;
  generating: boolean;
  saving: boolean;
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

  // Editable profile fields (only hook + summary now)
  const [hook, setHook] = useState('');
  const [narrative, setNarrative] = useState('');
  const [profileStatus, setProfileStatus] = useState<ContentStatus>('EMPTY');
  const [dirty, setDirty] = useState(false);

  // Correspondents (senders & recipients only)
  const [keyPeople, setKeyPeople] = useState<KeyPerson[]>([]);
  const [personEdits, setPersonEdits] = useState<Map<string, PersonEditState>>(new Map());

  // Look up featured letter by ID (auto-pick happens in fetchData, not here)
  const featuredLetter = useMemo<Letter | null>(() => {
    if (!collection?.letters?.length || !featuredLetterId) return null;
    return collection.letters.find(l => l.id === featuredLetterId) || null;
  }, [collection?.letters, featuredLetterId]);

  // Build ShowcaseCard items from featured letter
  const showcaseItems = useMemo<ShowcaseItem[]>(() => {
    if (!featuredLetter) return [];
    const images = featuredLetter.images || [];
    const mediaType = getPrimaryMediaType(featuredLetter);
    const mediaLabel = getMediaLabel(mediaType);
    const sender = featuredLetter.metadata.sender?.trim();
    const recipient = featuredLetter.metadata.recipient?.trim();
    const peopleLine = sender && recipient
      ? `${sender} \u2192 ${recipient}`
      : sender || recipient || '';
    const date = featuredLetter.metadata.date || featuredLetter.metadata.dateRaw || '';
    const letterHook = mediaType === 'photo'
      ? (featuredLetter.photoDescription || featuredLetter.metadata.hook || '')
      : (featuredLetter.metadata.hook || featuredLetter.photoDescription || '');
    const label = 'Featured';

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
  const filteredLetters = useMemo(() => {
    if (!collection?.letters) return [];
    if (!pickerSearch.trim()) return collection.letters;
    const q = pickerSearch.toLowerCase();
    return collection.letters.filter(l => {
      const sender = l.metadata.sender?.toLowerCase() || '';
      const recipient = l.metadata.recipient?.toLowerCase() || '';
      const hookText = l.metadata.hook?.toLowerCase() || '';
      const date = l.metadata.date?.toLowerCase() || l.metadata.dateRaw || '';
      return sender.includes(q) || recipient.includes(q) || hookText.includes(q) || date.includes(q);
    });
  }, [collection?.letters, pickerSearch]);

  // Filter key people to senders & recipients only
  const correspondents = useMemo(() => {
    return keyPeople.filter(p => p.roles.sender > 0 || p.roles.recipient > 0);
  }, [keyPeople]);

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

      // Featured letter: use saved value, or random-pick and persist
      let savedFeaturedId = (c.profileStartHereLetterId as string) || null;
      if (!savedFeaturedId && coll.letters?.length) {
        const randomIndex = Math.floor(Math.random() * coll.letters.length);
        savedFeaturedId = coll.letters[randomIndex].id;
        await updateCollectionProfile(code, { profileStartHereLetterId: savedFeaturedId }).catch(() => {});
      }
      setFeaturedLetterId(savedFeaturedId);
      setDirty(false);

      // Fetch key people
      try {
        const profileData = await getCollectionProfile(code);
        setKeyPeople(profileData.keyPeople || []);
        const edits = new Map<string, PersonEditState>();
        for (const person of profileData.keyPeople || []) {
          edits.set(person.id, {
            biography: person.biography || '',
            hook: person.hook || '',
            dirty: false,
            generating: false,
            saving: false,
          });
        }
        setPersonEdits(edits);
      } catch {
        // Profile may not exist yet
      }
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

  const handleSelectFeaturedLetter = (letterId: string) => {
    setFeaturedLetterId(letterId);
    setShowLetterPicker(false);
    setPickerSearch('');
    setDirty(true);
  };

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
            <div>
              <span className="acp-code-badge">Collection {collection.collectionCode}</span>
              <h1 className="acp-title">{collection.title || `Collection ${collection.collectionCode}`}</h1>
              <p className="acp-subtitle">
                {collection.letterCount} letters
              </p>
            </div>
            <div className="acp-header-right">
              <span className={`acp-status-badge ${statusClass(profileStatus)}`}>
                {statusLabel(profileStatus)}
              </span>
              <div className="acp-actions-row">
                <Button
                  onClick={() => handleGenerate(profileStatus !== 'EMPTY')}
                  disabled={generating}
                  size="sm"
                >
                  {generating ? 'Generating...' : profileStatus === 'EMPTY' ? 'Generate' : 'Regenerate'}
                </Button>
                {dirty && (
                  <Button onClick={handleSave} disabled={saving} size="sm">
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                )}
              </div>
            </div>
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

        {/* Featured Letter */}
        <div className="acp-section">
          <div className="acp-section-header">
            <h2>Featured Letter</h2>
            <button
              className="acp-text-btn"
              onClick={() => { setShowLetterPicker(!showLetterPicker); setPickerSearch(''); }}
            >
              {showLetterPicker ? 'Close' : featuredLetter ? 'Change' : 'Select'}
            </button>
          </div>

          {featuredLetter && showcaseItems.length > 0 ? (
            <div className="acp-featured-showcase">
              <ShowcaseCard
                items={showcaseItems}
                onNavigate={() => {/* no-op on admin — no navigation */}}
              />
            </div>
          ) : (
            <div className="acp-empty-state">
              No featured letter selected. Click &ldquo;Select&rdquo; to choose one.
            </div>
          )}

          {/* Letter Picker */}
          {showLetterPicker && (
            <div className="acp-letter-picker">
              <input
                type="text"
                className="acp-picker-search"
                placeholder="Filter by sender, recipient, date, hook..."
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
              />
              <div className="letter-grid acp-picker-grid">
                {filteredLetters.map((letter) => (
                  <LetterCard
                    key={letter.id}
                    card={buildLetterCardData(letter)}
                    onClick={handleSelectFeaturedLetter}
                  />
                ))}
                {filteredLetters.length === 0 && (
                  <p className="acp-picker-empty">No letters match your search.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Collection Hook */}
        <div className="acp-section">
          <h2>Collection Hook</h2>
          <p className="acp-hint">A 1-2 sentence teaser for the collection.</p>
          <input
            type="text"
            className="acp-input acp-full-width"
            value={hook}
            onChange={(e) => { setHook(e.target.value); setDirty(true); }}
            placeholder="e.g. A wartime love story told through 27 letters..."
            maxLength={500}
          />
          <p className="acp-hint">{hook.length} / 500</p>
        </div>

        {/* Collection Summary */}
        <div className="acp-section">
          <h2>Collection Summary</h2>
          <p className="acp-hint">Narrative about the collection, shown on the public page.</p>
          <textarea
            className="acp-textarea"
            value={narrative}
            onChange={(e) => { setNarrative(e.target.value); setDirty(true); }}
            rows={12}
            placeholder="Write or generate a collection summary..."
          />
          <p className="acp-hint">{narrative.length} characters</p>
        </div>

        {/* Correspondents — senders & recipients only */}
        <div className="acp-section">
          <h2>Correspondents {correspondents.length > 0 && `(${correspondents.length})`}</h2>
          <p className="acp-hint">Hooks and biographies for senders and recipients in this collection.</p>
          {correspondents.length === 0 ? (
            <p className="acp-empty-note">No correspondents found yet. Generate a profile to populate.</p>
          ) : (
            correspondents.map((person) => {
              const edit = personEdits.get(person.id);
              if (!edit) return null;
              const roleLabel = [
                person.roles.sender > 0 ? `Sent ${person.roles.sender}` : '',
                person.roles.recipient > 0 ? `Received ${person.roles.recipient}` : '',
              ].filter(Boolean).join(' · ');

              return (
                <div key={person.id} className="acp-person-card">
                  <div className="acp-person-header">
                    <strong>{person.name}</strong>
                    <span className="acp-person-stats">{roleLabel}</span>
                  </div>
                  <div className="acp-person-field">
                    <label>Hook</label>
                    <input
                      type="text"
                      className="acp-input acp-full-width"
                      value={edit.hook}
                      onChange={(e) => {
                        setPersonEdits(prev => {
                          const next = new Map(prev);
                          next.set(person.id, { ...edit, hook: e.target.value, dirty: true });
                          return next;
                        });
                      }}
                      placeholder="A single compelling sentence about this person..."
                      maxLength={200}
                    />
                  </div>
                  <div className="acp-person-field">
                    <label>Biography</label>
                    <textarea
                      className="acp-person-bio"
                      value={edit.biography}
                      onChange={(e) => {
                        setPersonEdits(prev => {
                          const next = new Map(prev);
                          next.set(person.id, { ...edit, biography: e.target.value, dirty: true });
                          return next;
                        });
                      }}
                      rows={4}
                      placeholder="Biography..."
                    />
                  </div>
                  <div className="acp-person-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={edit.generating}
                      onClick={async () => {
                        setPersonEdits(prev => {
                          const next = new Map(prev);
                          next.set(person.id, { ...edit, generating: true });
                          return next;
                        });
                        try {
                          const { person: updated } = await generatePersonBiography(person.id);
                          setPersonEdits(prev => {
                            const next = new Map(prev);
                            next.set(person.id, {
                              biography: updated.biography || '',
                              hook: updated.hook || '',
                              dirty: false,
                              generating: false,
                              saving: false,
                            });
                            return next;
                          });
                          showToast(`Generated bio for ${person.name}`, 'success');
                        } catch (err) {
                          showToast(getErrorMessage(err, 'An error occurred'), 'error');
                          setPersonEdits(prev => {
                            const next = new Map(prev);
                            next.set(person.id, { ...edit, generating: false });
                            return next;
                          });
                        }
                      }}
                    >
                      {edit.generating ? 'Generating...' : 'Generate'}
                    </Button>
                    {edit.dirty && (
                      <Button
                        size="sm"
                        disabled={edit.saving}
                        onClick={async () => {
                          setPersonEdits(prev => {
                            const next = new Map(prev);
                            next.set(person.id, { ...edit, saving: true });
                            return next;
                          });
                          try {
                            await savePersonBiography(person.id, {
                              biography: edit.biography,
                              hook: edit.hook,
                            });
                            setPersonEdits(prev => {
                              const next = new Map(prev);
                              next.set(person.id, { ...edit, dirty: false, saving: false });
                              return next;
                            });
                            showToast(`Saved ${person.name}`, 'success');
                          } catch (err) {
                            showToast(getErrorMessage(err, 'An error occurred'), 'error');
                            setPersonEdits(prev => {
                              const next = new Map(prev);
                              next.set(person.id, { ...edit, saving: false });
                              return next;
                            });
                          }
                        }}
                      >
                        {edit.saving ? 'Saving...' : 'Save'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
