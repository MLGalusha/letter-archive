import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import { getErrorMessage } from '../../api/client';
import {
  getAdminCollectionByCode,
  getCollectionCompleteness,
  generateCollectionProfile,
  updateCollectionProfile,
  getCollectionProfile,
  type CollectionCompleteness,
  type CollectionWithLetters,
  type KeyPerson,
  type ReadingPath,
  type ThemeGroup,
  type ContentStatus,
} from '../../api/collections';
import {
  generateBiography as generatePersonBiography,
  saveBiography as savePersonBiography,
} from '../../api/entities/persons';
import { useToast } from '../../contexts/ToastContext';
import './AdminCollectionPage.css';

type ProfileData = {
  hook: string;
  narrative: string;
  startHereLetterId: string | null;
  startHereReason: string;
  readingPaths: ReadingPath[];
  themes: ThemeGroup[];
  profileStatus: ContentStatus;
};

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
  const [completeness, setCompleteness] = useState<CollectionCompleteness | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);

  // Editable profile state
  const [profile, setProfile] = useState<ProfileData>({
    hook: '',
    narrative: '',
    startHereLetterId: null,
    startHereReason: '',
    readingPaths: [],
    themes: [],
    profileStatus: 'EMPTY',
  });
  const [dirty, setDirty] = useState(false);

  // Key people state
  const [keyPeople, setKeyPeople] = useState<KeyPerson[]>([]);
  const [personEdits, setPersonEdits] = useState<Map<string, PersonEditState>>(new Map());

  const fetchData = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    try {
      const [coll, comp] = await Promise.all([
        getAdminCollectionByCode(code),
        getCollectionCompleteness(code),
      ]);
      setCollection(coll);
      setCompleteness(comp);

      // Populate profile from collection data
      const c = coll as unknown as Record<string, unknown>;
      setProfile({
        hook: (c.hook as string) || '',
        narrative: (c.profileNarrative as string) || '',
        startHereLetterId: (c.profileStartHereLetterId as string) || null,
        startHereReason: (c.profileStartHereReason as string) || '',
        readingPaths: (c.profileReadingPaths as ReadingPath[]) || [],
        themes: (c.profileThemes as ThemeGroup[]) || [],
        profileStatus: (c.profileStatus as ContentStatus) || 'EMPTY',
      });
      setDirty(false);

      // Fetch key people from public profile endpoint
      try {
        const profileData = await getCollectionProfile(code);
        setKeyPeople(profileData.keyPeople || []);
        // Initialize person edit states
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
        // Profile may not exist yet — that's fine
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

    // Show warning if completeness is low
    if (!force && completeness && completeness.completenessScore < 50 && !showWarningDialog) {
      setShowWarningDialog(true);
      return;
    }
    setShowWarningDialog(false);

    setGenerating(true);
    try {
      const result = await generateCollectionProfile(code, force || profile.profileStatus !== 'EMPTY');
      setProfile({
        hook: result.hook || '',
        narrative: result.narrative,
        startHereLetterId: result.startHereLetterId,
        startHereReason: result.startHereReason,
        readingPaths: result.readingPaths,
        themes: result.themes,
        profileStatus: result.profileStatus,
      });
      setDirty(false);
      showToast(result.isStub ? 'Stub profile generated (no API key)' : 'Profile generated successfully', 'success');
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
        hook: profile.hook || null,
        profileNarrative: profile.narrative,
        profileStartHereLetterId: profile.startHereLetterId,
        profileStartHereReason: profile.startHereReason,
        profileReadingPaths: profile.readingPaths,
        profileThemes: profile.themes,
      });
      setDirty(false);
      showToast('Profile saved', 'success');
      fetchData();
    } catch (err) {
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!code) return;
    try {
      await updateCollectionProfile(code, { profileStatus: 'VERIFIED' });
      setProfile(p => ({ ...p, profileStatus: 'VERIFIED' }));
      showToast('Profile marked as verified', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'An error occurred'), 'error');
    }
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

  const letterOptions = collection.letters || [];

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
                {completeness && ` \u00b7 ${completeness.publishedLetters} published`}
              </p>
            </div>
            <div className="acp-header-status">
              <span className={`acp-status-badge ${statusClass(profile.profileStatus)}`}>
                {statusLabel(profile.profileStatus)}
              </span>
            </div>
          </div>
        </div>

        {/* Completeness Panel */}
        {completeness && (
          <div className="acp-section acp-completeness">
            <h2>Data Completeness</h2>
            <div className="acp-completeness-bar-container">
              <div
                className="acp-completeness-bar"
                style={{ width: `${Math.min(completeness.completenessScore, 100)}%` }}
              />
              <span className="acp-completeness-score">{Math.round(completeness.completenessScore)}%</span>
            </div>
            <div className="acp-completeness-stats">
              <span>{completeness.withTranscripts} / {completeness.totalLetters} transcripts</span>
              <span>{completeness.withMetadata} / {completeness.totalLetters} metadata</span>
              <span>{completeness.withEmotionalTone} tones</span>
              <span>{completeness.withTopics} topics</span>
            </div>
            {completeness.warnings.length > 0 && (
              <ul className="acp-warnings">
                {completeness.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Generate / Regenerate */}
        <div className="acp-section acp-generate">
          <div className="acp-generate-row">
            <Button
              onClick={() => handleGenerate(profile.profileStatus !== 'EMPTY')}
              disabled={generating}
            >
              {generating ? 'Generating...' : profile.profileStatus === 'EMPTY' ? 'Generate Profile' : 'Regenerate Profile'}
            </Button>
            {profile.profileStatus !== 'EMPTY' && profile.profileStatus !== 'VERIFIED' && (
              <Button onClick={handleVerify} variant="secondary">
                Mark as Verified
              </Button>
            )}
            {dirty && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
          </div>
        </div>

        {/* Warning Dialog */}
        {showWarningDialog && (
          <div className="acp-dialog-overlay">
            <div className="acp-dialog">
              <h3>Low Data Completeness</h3>
              <p>
                Only {Math.round(completeness?.completenessScore || 0)}% of data is available.
                The generated profile may be sparse or inaccurate.
              </p>
              {completeness?.warnings.map((w, i) => (
                <p key={i} className="acp-dialog-warning">{w}</p>
              ))}
              <div className="acp-dialog-actions">
                <Button onClick={() => setShowWarningDialog(false)} variant="secondary">Cancel</Button>
                <Button onClick={() => handleGenerate(true)}>Generate Anyway</Button>
              </div>
            </div>
          </div>
        )}

        {/* Profile Editor */}
        {profile.profileStatus !== 'EMPTY' && (
          <>
            {/* Hook */}
            <div className="acp-section">
              <h2>Collection Hook</h2>
              <p className="acp-hint">A 1-2 sentence teaser that makes someone want to explore this collection.</p>
              <input
                type="text"
                className="acp-input acp-hook-input"
                value={profile.hook}
                onChange={(e) => {
                  setProfile(p => ({ ...p, hook: e.target.value }));
                  setDirty(true);
                }}
                placeholder="e.g. A wartime love story told through 27 letters..."
                maxLength={500}
              />
              <p className="acp-hint">{profile.hook.length} / 500</p>
            </div>

            {/* Narrative */}
            <div className="acp-section">
              <h2>Narrative Essay</h2>
              <textarea
                className="acp-narrative-editor"
                value={profile.narrative}
                onChange={(e) => {
                  setProfile(p => ({ ...p, narrative: e.target.value }));
                  setDirty(true);
                }}
                rows={16}
                placeholder="Collection narrative essay..."
              />
              <p className="acp-hint">{profile.narrative.length} characters</p>
            </div>

            {/* Start Here */}
            <div className="acp-section">
              <h2>Start Here Letter</h2>
              <div className="acp-start-here-row">
                <select
                  className="acp-select"
                  value={profile.startHereLetterId || ''}
                  onChange={(e) => {
                    setProfile(p => ({ ...p, startHereLetterId: e.target.value || null }));
                    setDirty(true);
                  }}
                >
                  <option value="">— None —</option>
                  {letterOptions.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.metadata.dateRaw || l.title} — {l.metadata.sender || '?'} to {l.metadata.recipient || '?'}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  className="acp-input"
                  value={profile.startHereReason}
                  onChange={(e) => {
                    setProfile(p => ({ ...p, startHereReason: e.target.value }));
                    setDirty(true);
                  }}
                  placeholder="Why start here?"
                />
              </div>
            </div>

            {/* Reading Paths */}
            <div className="acp-section">
              <h2>Reading Paths ({profile.readingPaths.length})</h2>
              {profile.readingPaths.map((path, i) => (
                <div key={i} className="acp-path-card">
                  <div className="acp-path-header">
                    <input
                      type="text"
                      className="acp-input"
                      value={path.title}
                      onChange={(e) => {
                        const updated = [...profile.readingPaths];
                        updated[i] = { ...updated[i], title: e.target.value };
                        setProfile(p => ({ ...p, readingPaths: updated }));
                        setDirty(true);
                      }}
                      placeholder="Path title"
                    />
                    <button
                      className="acp-remove-btn"
                      onClick={() => {
                        setProfile(p => ({
                          ...p,
                          readingPaths: p.readingPaths.filter((_, j) => j !== i),
                        }));
                        setDirty(true);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                  <textarea
                    className="acp-path-desc"
                    value={path.description}
                    onChange={(e) => {
                      const updated = [...profile.readingPaths];
                      updated[i] = { ...updated[i], description: e.target.value };
                      setProfile(p => ({ ...p, readingPaths: updated }));
                      setDirty(true);
                    }}
                    rows={2}
                    placeholder="Description"
                  />
                  <p className="acp-hint">{path.letterIds.length} letters in this path</p>
                </div>
              ))}
              <button
                className="acp-add-btn"
                onClick={() => {
                  setProfile(p => ({
                    ...p,
                    readingPaths: [...p.readingPaths, { title: '', description: '', letterIds: [] }],
                  }));
                  setDirty(true);
                }}
              >
                + Add Reading Path
              </button>
            </div>

            {/* Themes */}
            <div className="acp-section">
              <h2>Themes ({profile.themes.length})</h2>
              {profile.themes.map((theme, i) => (
                <div key={i} className="acp-path-card">
                  <div className="acp-path-header">
                    <input
                      type="text"
                      className="acp-input"
                      value={theme.name}
                      onChange={(e) => {
                        const updated = [...profile.themes];
                        updated[i] = { ...updated[i], name: e.target.value };
                        setProfile(p => ({ ...p, themes: updated }));
                        setDirty(true);
                      }}
                      placeholder="Theme name"
                    />
                    <button
                      className="acp-remove-btn"
                      onClick={() => {
                        setProfile(p => ({
                          ...p,
                          themes: p.themes.filter((_, j) => j !== i),
                        }));
                        setDirty(true);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                  <textarea
                    className="acp-path-desc"
                    value={theme.description}
                    onChange={(e) => {
                      const updated = [...profile.themes];
                      updated[i] = { ...updated[i], description: e.target.value };
                      setProfile(p => ({ ...p, themes: updated }));
                      setDirty(true);
                    }}
                    rows={2}
                    placeholder="Description"
                  />
                  <p className="acp-hint">{theme.letterIds.length} letters in this theme</p>
                </div>
              ))}
              <button
                className="acp-add-btn"
                onClick={() => {
                  setProfile(p => ({
                    ...p,
                    themes: [...p.themes, { name: '', description: '', letterIds: [] }],
                  }));
                  setDirty(true);
                }}
              >
                + Add Theme
              </button>
            </div>

            {/* Key People */}
            {keyPeople.length > 0 && (
              <div className="acp-section">
                <h2>Key People ({keyPeople.length})</h2>
                <p className="acp-hint">Edit hooks and biographies for people in this collection. Generate uses AI.</p>
                {keyPeople.map((person) => {
                  const edit = personEdits.get(person.id);
                  if (!edit) return null;
                  return (
                    <div key={person.id} className="acp-person-card">
                      <div className="acp-person-header">
                        <strong>{person.name}</strong>
                        <span className="acp-person-stats">
                          {person.letterCount} letters &middot;
                          {person.roles.sender} sent, {person.roles.recipient} received
                        </span>
                      </div>
                      <div className="acp-person-field">
                        <label>Hook</label>
                        <input
                          type="text"
                          className="acp-input"
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
                          {edit.generating ? 'Generating...' : 'Generate Bio + Hook'}
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
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
