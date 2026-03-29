import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { ApiError, getErrorMessage } from '../../api/client';
import { adminGetContentPage, adminUpdateContentPage } from '../../api/admin/content';
import { useToast } from '../../contexts/ToastContext';
import type { ContentBlock } from '../../content/blocks';
import { getDefaultBlocks } from '../../content/defaultBlocks';
import { resolveBlocks } from '../../content/blockMigration';
import BlockRenderer from '../../components/BlockRenderer/BlockRenderer';
import './BlockEditorPage.css';

type SaveState = 'idle' | 'autosaving' | 'saving' | 'saved' | 'error';

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
    case 'autosaving':
    case 'saving':
      return 'Saving\u2026';
    case 'saved':
      return formatSavedTime(updatedAt);
    case 'error':
      return 'Save failed';
    default:
      return updatedAt ? formatSavedTime(updatedAt) : '';
  }
}

export default function BlockEditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const latestFingerprintRef = useRef('[]');

  const config = slug ? PAGE_CONFIG[slug] : null;

  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(Boolean(slug));
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const currentFingerprint = useMemo(() => JSON.stringify(blocks), [blocks]);

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
      latestFingerprintRef.current = JSON.stringify(resolved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const defaults = getDefaultBlocks(slug);
        setBlocks(defaults);
        setUpdatedAt(null);
        setSaveState('idle');
        latestFingerprintRef.current = '[]';
      } else {
        setError(getErrorMessage(err, 'Failed to load page.'));
      }
    } finally {
      setLoading(false);
    }
  }, [config, slug]);

  useEffect(() => { void loadPage(); }, [loadPage]);

  // ── Save ──
  const persistPage = useCallback(async (reason: 'auto' | 'manual') => {
    if (!slug || !config) return;
    setSaveState(reason === 'auto' ? 'autosaving' : 'saving');
    try {
      const saved = await adminUpdateContentPage(slug, {
        title: config.title,
        contentJson: { blocks },
      });
      setUpdatedAt(saved.updatedAt);
      setSaveState('saved');
      latestFingerprintRef.current = JSON.stringify(blocks);
      if (reason === 'manual') showToast(`${config.title} page saved.`, 'success');
    } catch (err) {
      setSaveState('error');
      if (reason === 'manual') showToast(getErrorMessage(err, 'Failed to save.'), 'error');
    }
  }, [blocks, config, showToast, slug]);

  // ── Auto-save (1200ms) ──
  useEffect(() => {
    if (!slug || loading || currentFingerprint === latestFingerprintRef.current) return;
    const id = window.setTimeout(() => void persistPage('auto'), 1200);
    return () => window.clearTimeout(id);
  }, [currentFingerprint, loading, persistPage, slug]);

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

  if (!slug || !config) {
    return (
      <AdminLayout>
        <div className="be-page"><p className="be-error">Page not found.</p></div>
      </AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="be-page"><div className="be-loading">Loading...</div></div>
      </AdminLayout>
    );
  }

  const saveLabel = getSaveLabel(saveState, updatedAt);

  return (
    <AdminLayout>
      <div className="be-page">
        {/* ── Sticky toolbar ── */}
        <div className="be-toolbar">
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
              onClick={() => void persistPage('manual')}
            >
              Save
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
        </div>

        {error && <div className="be-error">{error}</div>}

        {/* ── The actual page, rendered 1:1 but editable ── */}
        <div className={`be-preview ${config.className}`}>
          <BlockRenderer
            blocks={blocks}
            editable
            onBlockChange={handleBlockChange}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
