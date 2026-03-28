import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminCollections, type AdminCollectionInfo } from '../../api/collections';
import { getErrorMessage } from '../../api/client';
import './AdminCollectionsListPage.css';

const STATUS_LABELS: Record<string, string> = {
  EMPTY: 'No Profile',
  AI_DRAFT: 'AI Draft',
  EDITED: 'Edited',
  VERIFIED: 'Verified',
};

function formatDateRaw(dateRaw: string | null): string {
  if (!dateRaw || dateRaw.length < 8) return '—';
  return `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
}

/**
 * Collections table panel — embedded in the admin dashboard.
 * Reuses the same .letters-table classes for consistent UI.
 */
export default function CollectionsDashboard() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        const data = await getAdminCollections();
        setCollections(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load collections'));
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  return (
    <div className="admin-content">
      <div className={`letters-table-container ${!loading && collections.length === 0 ? 'empty' : ''}`}>
        {loading && <p style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading collections...</p>}
        {error && <p style={{ padding: '2rem', color: 'var(--danger, #e74c3c)' }}>{error}</p>}

        {!loading && !error && collections.length === 0 && (
          <p>No collections found.</p>
        )}

        {!loading && !error && collections.length > 0 && (
          <table className="letters-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Letters</th>
                <th>Published</th>
                <th>Verified</th>
                <th>People</th>
                <th>Date Range</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr
                  key={c.id}
                  className="letter-row"
                  onClick={() => navigate(`/admin/collections/${c.collectionCode}`)}
                >
                  <td className="collection-code-cell">{c.collectionCode}</td>
                  <td className="collection-title-cell">{c.title || '—'}</td>
                  <td className="count-cell">{c.letterCount ?? 0}</td>
                  <td className="count-cell">{c.publishedCount}</td>
                  <td className="count-cell">{c.verifiedCount}</td>
                  <td className="count-cell">—</td>
                  <td className="date-cell">
                    {c.minDate && c.maxDate
                      ? `${formatDateRaw(c.minDate)} – ${formatDateRaw(c.maxDate)}`
                      : '—'}
                  </td>
                  <td className="status-cell">
                    <span className={`collection-profile-badge profile-${(c.profileStatus || 'EMPTY').toLowerCase().replace('_', '-')}`}>
                      {STATUS_LABELS[c.profileStatus || 'EMPTY']}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
