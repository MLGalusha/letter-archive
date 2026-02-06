import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getAdminCollectionByCode,
  updateCollection,
  type CollectionWithLetters,
} from '../../api/collections';
import type { WorkflowState, VisibilityState } from '../../types/Letter';
import './CollectionDetailPage.css';

const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  UPLOADED: 'Uploaded',
  TRANSCRIBING: 'Transcribing',
  TRANSCRIBED: 'Transcribed',
  METADATA_EXTRACTING: 'Extracting',
  METADATA_DRAFTED: 'Metadata Ready',
  REVIEWED: 'Reviewed',
};

const VISIBILITY_LABELS: Record<VisibilityState, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  HIDDEN: 'Hidden',
};

export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { collectionCode } = useParams<{ collectionCode: string }>();

  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const isAuth = sessionStorage.getItem('adminAuth');
    if (!isAuth) {
      navigate('/admin-login');
      return;
    }

    if (!collectionCode) return;

    async function fetchCollection() {
      try {
        const data = await getAdminCollectionByCode(collectionCode!);
        setCollection(data);
        setEditTitle(data.title || '');
        setEditDescription(data.description || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load collection');
      } finally {
        setLoading(false);
      }
    }

    fetchCollection();
  }, [navigate, collectionCode]);

  const handleSave = async () => {
    if (!collectionCode) return;

    setSaving(true);
    try {
      const updated = await updateCollection(collectionCode, {
        title: editTitle,
        description: editDescription || null,
      });
      setCollection((prev) => (prev ? { ...prev, ...updated } : null));
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleLetterClick = (letterId: string) => {
    navigate(`/admin/letters/${letterId}`);
  };

  const handleBack = () => {
    navigate('/admin/collections');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getWorkflowBadge = (workflow: WorkflowState) => {
    return (
      <span className={`badge badge-workflow-${workflow.toLowerCase()}`}>
        {WORKFLOW_LABELS[workflow]}
      </span>
    );
  };

  const getVisibilityBadge = (visibility: VisibilityState) => {
    if (visibility === 'DRAFT') return null;
    return (
      <span className={`badge badge-${visibility.toLowerCase()}`}>
        {VISIBILITY_LABELS[visibility]}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="collection-detail-page">
        <header className="admin-header">
          <h1>Loading...</h1>
        </header>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="collection-detail-page">
        <header className="admin-header">
          <h1>Collection Not Found</h1>
          <button onClick={handleBack} className="back-button">
            Back
          </button>
        </header>
        {error && <p className="error-message">{error}</p>}
      </div>
    );
  }

  return (
    <div className="collection-detail-page">
      <header className="admin-header">
        <div className="header-left">
          <span className="collection-code-badge">{collection.collectionCode}</span>
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="edit-title-input"
              placeholder="Collection Title"
            />
          ) : (
            <h1>{collection.title || `Collection ${collection.collectionCode}`}</h1>
          )}
        </div>
        <div className="header-actions">
          {isEditing ? (
            <>
              <button onClick={() => setIsEditing(false)} className="cancel-button">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="save-button">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setIsEditing(true)} className="edit-button">
                Edit
              </button>
              <button onClick={handleBack} className="back-button">
                Back to Collections
              </button>
            </>
          )}
        </div>
      </header>

      <div className="admin-content">
        {error && <p className="error-message">{error}</p>}

        {isEditing ? (
          <div className="edit-description-section">
            <label>Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Collection description..."
              rows={3}
            />
          </div>
        ) : (
          collection.description && (
            <p className="collection-description-display">{collection.description}</p>
          )
        )}

        <div className="collection-stats-bar">
          <span>{collection.letterCount} letters in this collection</span>
        </div>

        <div className="letters-table-container">
          <table className="letters-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th>Sender</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {collection.letters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No letters in this collection
                  </td>
                </tr>
              ) : (
                collection.letters.map((letter) => (
                  <tr
                    key={letter.id}
                    onClick={() => handleLetterClick(letter.id)}
                    className="letter-row"
                  >
                    <td>{letter.title}</td>
                    <td>{letter.metadata.date || '—'}</td>
                    <td>{letter.metadata.sender || '—'}</td>
                    <td>{letter.metadata.recipient || '—'}</td>
                    <td>
                      <div className="status-badges">
                        {getWorkflowBadge(letter.workflowState)}
                        {getVisibilityBadge(letter.visibility)}
                      </div>
                    </td>
                    <td>{formatDate(letter.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
