import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { ApiError, getErrorMessage } from '../../api/client';
import { adminGetContentPage, adminUpdateContentPage } from '../../api/admin/content';
import { listCollections, type CollectionInfo } from '../../api/collections';
import { useSiteSettings } from '../../hooks/useSiteSettings';
import { useToast } from '../../contexts/ToastContext';
import type { ContentBlock } from '../../content/blocks';
import { getDefaultBlocks } from '../../content/defaultBlocks';
import { resolveBlocks } from '../../content/blockMigration';
import BlockRenderer from '../../components/BlockRenderer/BlockRenderer';
import './BlockEditorPage.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const PAGE_CONFIG: Record<string, { title: string; publicPath: string; className: string }> = {
  about: { title: 'About', publicPath: '/about', className: 'about-page' },
  support: { title: 'Support', publicPath: '/support', className: 'support-page' },
};

function formatSavedTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Saved';
  return `Saved ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function getSaveLabel(state: SaveState, updatedAt: string | null): string {
  switch (state) {
    case 'saving':
      return 'Updating\u2026';
    case 'saved':
      return formatSavedTime(updatedAt);
    case 'error':
      return 'Update failed';
    default:
      return updatedAt ? formatSavedTime(updatedAt) : '';
  }
}

export default function BlockEditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const siteSettings = useSiteSettings();

  const config = slug ? PAGE_CONFIG[slug] : null;

  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(Boolean(slug));
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<{ letters: number; collections: number } | null>(null);

  // ── Load ──
  const loadPage = useCallback(async () => {
    if (!slug || !config) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const page = await adminGetContentPage(slug);
      const resolved = resolveBlocks(slug, page.contentJson);
      setBlocks(resolved);
      setUpdatedAt(page.updatedAt);
      setSaveState('saved');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const defaults = getDefaultBlocks(slug);
        setBlocks(defaults);
        setUpdatedAt(null);
        setSaveState('idle');
      } else {
        setError(getErrorMessage(err, 'Failed to load page.'));
      }
    } finally {
      setLoading(false);
    }
  }, [config, slug]);

  useEffect(() => { void loadPage(); }, [loadPage]);

  // Fetch live stats for about page (so admin preview matches public)
  useEffect(() => {
    if (slug !== 'about') return;
    listCollections()
      .then((collections: CollectionInfo[]) => {
        const visible = collections.filter((c) => (c.letterCount || 0) > 0);
        const letters = visible.reduce((sum, c) => sum + (c.letterCount || 0), 0);
        setLiveStats({ collections: visible.length, letters });
      })
      .catch(() => {});
  }, [slug]);

  // ── Update (manual only) ──
  const persistPage = useCallback(async () => {
    if (!slug || !config) return;
    setSaveState('saving');
    try {
      const saved = await adminUpdateContentPage(slug, {
        title: config.title,
        contentJson: { blocks },
      });
      setUpdatedAt(saved.updatedAt);
      setSaveState('saved');
      showToast(`${config.title} page updated.`, 'success');
    } catch (err) {
      setSaveState('error');
      showToast(getErrorMessage(err, 'Failed to update.'), 'error');
    }
  }, [blocks, config, showToast, slug]);

  // ── Block change handler ──
  const handleBlockChange = useCallback((blockId: string, patch: Partial<ContentBlock>) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...patch } as ContentBlock : b)),
    );
  }, []);

  // ── Reset to defaults ──
  const handleReset = useCallback(() => {
    if (!slug) return;
    if (!window.confirm('Reset all text to defaults? Your current edits will be replaced.')) return;
    setBlocks(getDefaultBlocks(slug));
  }, [slug]);

  // ── Not found ──
  if (!slug || !config) {
    return (
      <AdminLayout>
        <div className="be-error" style={{ margin: '2rem' }}>Page not found.</div>
      </AdminLayout>
    );
  }

  const saveLabel = getSaveLabel(saveState, updatedAt);

  const toolbar = (
    <>
      <button type="button" className="be-back" onClick={() => navigate('/admin/content')}>
        <Icon name="arrow-left" size={16} />
        Content
      </button>
      <div className="be-toolbar-center">
        <span className="be-toolbar-title">Editing: {config.title} Page</span>
        {saveLabel && (
          <span className={`be-save-state state-${saveState}`}>{saveLabel}</span>
        )}
      </div>
      <div className="be-toolbar-actions">
        <button type="button" className="be-reset-btn" onClick={handleReset}>
          Reset
        </button>
        <Button
          variant="primary"
          size="sm"
          icon="save"
          loading={saveState === 'saving'}
          onClick={() => void persistPage()}
        >
          Update
        </Button>
        <a
          className="be-view-link"
          href={config.publicPath}
          target="_blank"
          rel="noopener noreferrer"
        >
          View &rarr;
        </a>
      </div>
    </>
  );

  // ── Loading ──
  if (loading) {
    return (
      <AdminLayout headerActions={toolbar}>
        <div className="be-loading">Loading...</div>
      </AdminLayout>
    );
  }

  // ── Editor: exact public page layout, but with editable text ──
  return (
    <AdminLayout headerActions={toolbar}>
      <div className="public-site-shell be-page-shell">
        {error && <div className="be-error">{error}</div>}
        <div className="body-layout">
          <div
            className={config.className}
            style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
          >
            <BlockRenderer
              blocks={blocks}
              liveStats={liveStats}
              siteSettings={siteSettings}
              editable
              onBlockChange={handleBlockChange}
            />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
