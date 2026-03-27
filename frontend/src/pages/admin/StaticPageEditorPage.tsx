import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import AutoResizeTextarea from '../../components/common/AutoResizeTextarea';
import Icon from '../../components/common/Icon';
import { ApiError, getErrorMessage } from '../../api/client';
import { adminGetContentPage, adminUpdateContentPage } from '../../api/admin/content';
import { useToast } from '../../contexts/ToastContext';
import {
  CONTENT_PAGE_DEFAULTS,
  CONTENT_PAGE_EDITOR_CONFIG,
  isContentPageSlug,
  resolveContentPageContent,
  serializeContentPageDraft,
  type ContentPageFieldDefinition,
  type ContentPageSectionDefinition,
  type ContentPageSlug,
} from '../../content/contentPageConfig';
import './StaticPageEditorPage.css';

type SaveState = 'idle' | 'autosaving' | 'saving' | 'saved' | 'error';

function formatSavedTime(iso: string | null): string {
  if (!iso) return 'Not saved yet';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Saved just now';
  }

  return `Saved ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function formatUpdatedDate(iso: string | null): string {
  if (!iso) return 'Using defaults';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getSaveStateLabel(saveState: SaveState, updatedAt: string | null): string {
  switch (saveState) {
    case 'autosaving':
      return 'Autosaving...';
    case 'saving':
      return 'Saving...';
    case 'saved':
      return formatSavedTime(updatedAt);
    case 'error':
      return 'Save failed';
    default:
      return updatedAt ? formatSavedTime(updatedAt) : 'Waiting for edits';
  }
}

function previewText(value: string, maxLength = 150): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function flattenFields(sections: ContentPageSectionDefinition[]): ContentPageFieldDefinition[] {
  return sections.flatMap((section) => section.fields);
}

function AboutPreview({ content }: { content: Record<string, string> }) {
  return (
    <div className="static-preview">
      <div className="static-preview-hero">
        <span>{content.hero_kicker}</span>
        <h3>{content.hero_heading}</h3>
        <p>{previewText(content.hero_subtitle, 180)}</p>
      </div>

      <div className="static-preview-quote-card">
        <small>{content.why_eyebrow}</small>
        <blockquote>{previewText(content.quote_text, 165)}</blockquote>
      </div>

      <div className="static-preview-step-grid">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="static-preview-step">
            <span>{String(step).padStart(2, '0')}</span>
            <strong>{content[`process_step_${step}_title`]}</strong>
            <p>{previewText(content[`process_step_${step}_text`], 88)}</p>
          </div>
        ))}
      </div>

      <div className="static-preview-dual">
        <div className="static-preview-panel">
          <small>{content.contribute_eyebrow}</small>
          <strong>{content.contribute_heading}</strong>
          <p>{previewText(content.contribute_text, 120)}</p>
        </div>
        <div className="static-preview-panel">
          <small>{content.research_eyebrow}</small>
          <strong>{content.research_heading}</strong>
          <p>{previewText(content.research_text, 120)}</p>
        </div>
      </div>

      <div className="static-preview-footer">
        <p>{previewText(content.cta_text, 110)}</p>
        <div className="static-preview-button-row">
          <span>{content.cta_primary_label}</span>
          <span>{content.cta_secondary_label}</span>
        </div>
      </div>
    </div>
  );
}

function SupportPreview({ content }: { content: Record<string, string> }) {
  return (
    <div className="static-preview">
      <div className="static-preview-hero">
        <span>{content.hero_kicker}</span>
        <h3>{content.hero_heading}</h3>
        <p>{previewText(content.hero_subtitle, 170)}</p>
      </div>

      <div className="static-preview-quote-card">
        <small>{content.featured_eyebrow}</small>
        <blockquote>{previewText(content.quote_text, 160)}</blockquote>
      </div>

      <div className="static-preview-card-grid">
        {[1, 2, 3].map((card) => (
          <div key={card} className="static-preview-panel compact">
            <span className="static-preview-emoji">{content[`impact_card_${card}_icon`]}</span>
            <strong>{content[`impact_card_${card}_title`]}</strong>
            <p>{previewText(content[`impact_card_${card}_text`], 80)}</p>
          </div>
        ))}
      </div>

      <div className="static-preview-card-grid">
        {[1, 2, 3].map((card) => (
          <div key={card} className="static-preview-panel compact">
            <small>{content[`option_${card}_eyebrow`]}</small>
            <strong>{content[`option_${card}_title`]}</strong>
            <p>{previewText(content[`option_${card}_text`], 84)}</p>
          </div>
        ))}
      </div>

      <div className="static-preview-panel">
        <small>{content.contact_eyebrow}</small>
        <strong>{content.contact_heading}</strong>
        <p>{previewText(content.contact_intro, 118)}</p>
      </div>

      <div className="static-preview-footer">
        <small>{content.thankyou_eyebrow}</small>
        <p>{previewText(content.thankyou_text, 120)}</p>
        <div className="static-preview-button-row">
          <span>{content.thankyou_primary_label}</span>
          <span>{content.thankyou_secondary_label}</span>
        </div>
      </div>
    </div>
  );
}

function PagePreview({
  slug,
  content,
}: {
  slug: ContentPageSlug;
  content: Record<string, string>;
}) {
  return slug === 'about' ? <AboutPreview content={content} /> : <SupportPreview content={content} />;
}

export default function StaticPageEditorPage() {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const latestFingerprintRef = useRef('{}');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const slug = isContentPageSlug(slugParam) ? slugParam : null;
  const pageConfig = slug ? CONTENT_PAGE_EDITOR_CONFIG[slug] : null;
  const defaults = slug ? CONTENT_PAGE_DEFAULTS[slug] : null;

  const [draftContent, setDraftContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(slug));
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const allFields = useMemo(() => (pageConfig ? flattenFields(pageConfig.sections) : []), [pageConfig]);
  const serializedDraft = useMemo(
    () => (slug ? serializeContentPageDraft(slug, draftContent) : {}),
    [draftContent, slug],
  );
  const currentFingerprint = useMemo(() => JSON.stringify(serializedDraft), [serializedDraft]);
  const customizedCount = Object.keys(serializedDraft).length;
  const totalFields = allFields.length;

  const loadPage = useCallback(async () => {
    if (!slug || !pageConfig) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const page = await adminGetContentPage(slug);
      const resolved = resolveContentPageContent(slug, page.contentJson);
      const fingerprint = JSON.stringify(serializeContentPageDraft(slug, resolved));

      setDraftContent(resolved);
      setUpdatedAt(page.updatedAt);
      setSaveState('saved');
      latestFingerprintRef.current = fingerprint;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const resolved = resolveContentPageContent(slug, null);
        setDraftContent(resolved);
        setUpdatedAt(null);
        setSaveState('idle');
        latestFingerprintRef.current = JSON.stringify({});
      } else {
        setError(getErrorMessage(err, `Failed to load ${pageConfig.title} page.`));
      }
    } finally {
      setLoading(false);
    }
  }, [pageConfig, slug]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const persistPage = useCallback(
    async (reason: 'auto' | 'manual') => {
      if (!slug || !pageConfig) {
        return null;
      }

      const payload = serializeContentPageDraft(slug, draftContent);
      setSaveState(reason === 'auto' ? 'autosaving' : 'saving');

      try {
        const saved = await adminUpdateContentPage(slug, {
          title: pageConfig.title,
          contentJson: payload,
        });

        const fingerprint = JSON.stringify(payload);
        setUpdatedAt(saved.updatedAt);
        setSaveState('saved');
        latestFingerprintRef.current = fingerprint;

        if (reason === 'manual') {
          showToast(`${pageConfig.title} page saved.`, 'success');
        }

        return saved;
      } catch (err) {
        setSaveState('error');
        if (reason === 'manual') {
          showToast(getErrorMessage(err, `Failed to save ${pageConfig.title} page.`), 'error');
        }
        return null;
      }
    },
    [draftContent, pageConfig, showToast, slug],
  );

  useEffect(() => {
    if (!slug || loading) {
      return;
    }

    if (currentFingerprint === latestFingerprintRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistPage('auto');
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentFingerprint, loading, persistPage, slug]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setDraftContent((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleFieldReset = useCallback(
    (key: string) => {
      if (!defaults) {
        return;
      }

      setDraftContent((current) => ({
        ...current,
        [key]: defaults[key] || '',
      }));
    },
    [defaults],
  );

  const jumpToSection = useCallback((sectionId: string) => {
    const node = sectionRefs.current[sectionId];
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (!slug || !pageConfig || !defaults) {
    return (
      <AdminLayout>
        <div className="static-page-editor invalid">
          <p className="static-page-editor-error">This page composer does not exist.</p>
        </div>
      </AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="static-page-editor">
          <div className="static-page-editor-loading">Loading page composer...</div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className={`static-page-editor static-page-editor--${slug}`}>
        <button
          type="button"
          className="static-page-editor-back"
          onClick={() => navigate('/admin/content')}
        >
          <Icon name="arrow-left" size={16} />
          Back to content
        </button>

        <div className="static-page-editor-hero">
          <div>
            <p className="static-page-editor-kicker">{pageConfig.kicker}</p>
            <h1 className="static-page-editor-heading">{pageConfig.title} Page</h1>
            <p className="static-page-editor-subtitle">{pageConfig.description}</p>
          </div>

          <div className="static-page-editor-status-panel">
            <span className={`static-save-state state-${saveState}`}>
              {getSaveStateLabel(saveState, updatedAt)}
            </span>
            <span className="static-page-editor-path">{pageConfig.publicPath}</span>
          </div>
        </div>

        {error && <div className="static-page-editor-error">{error}</div>}

        <div className="static-page-editor-shell">
          <section className="static-page-editor-canvas">
            <div className="static-page-editor-stats">
              <div className="static-page-editor-stat">
                <span>Custom overrides</span>
                <strong>{customizedCount}</strong>
              </div>
              <div className="static-page-editor-stat">
                <span>Sections</span>
                <strong>{pageConfig.sections.length}</strong>
              </div>
              <div className="static-page-editor-stat">
                <span>Fields</span>
                <strong>{totalFields}</strong>
              </div>
            </div>

            {pageConfig.sections.map((section) => (
              <article
                key={section.id}
                ref={(node) => {
                  sectionRefs.current[section.id] = node;
                }}
                className="static-section-card"
              >
                <header className="static-section-header">
                  <div>
                    <span className="static-section-eyebrow">{section.eyebrow}</span>
                    <h2>{section.title}</h2>
                  </div>
                  <p>{section.description}</p>
                </header>

                <div className="static-field-grid">
                  {section.fields.map((field) => {
                    const fieldId = `${slug}-${field.key}`;
                    const isCustomized = draftContent[field.key] !== defaults[field.key];
                    const currentValue = draftContent[field.key] || '';

                    return (
                      <div
                        key={field.key}
                        className={`static-field-card ${field.kind === 'textarea' ? 'is-textarea' : ''}`}
                      >
                        <div className="static-field-card-top">
                          <label htmlFor={fieldId}>{field.label}</label>
                          {isCustomized ? (
                            <button
                              type="button"
                              className="static-field-reset"
                              onClick={() => handleFieldReset(field.key)}
                            >
                              Use default
                            </button>
                          ) : (
                            <span className="static-field-mode">Default</span>
                          )}
                        </div>

                        {field.hint && <p className="static-field-hint">{field.hint}</p>}

                        {field.kind === 'textarea' ? (
                          <AutoResizeTextarea
                            id={fieldId}
                            value={currentValue}
                            onChange={(value) => handleFieldChange(field.key, value)}
                            minHeight={112}
                            placeholder={defaults[field.key]}
                            className="static-field-textarea"
                          />
                        ) : (
                          <input
                            id={fieldId}
                            className="static-field-input"
                            type="text"
                            value={currentValue}
                            onChange={(event) => handleFieldChange(field.key, event.target.value)}
                            placeholder={defaults[field.key]}
                          />
                        )}

                        <p className="static-field-default-text">
                          Default: {previewText(defaults[field.key], 92)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>

          <aside className="static-page-editor-rail">
            <div className="static-rail-card">
              <span className="static-rail-kicker">Page Status</span>
              <h2>Keep the structure, change the voice</h2>
              <dl className="static-rail-metrics">
                <div>
                  <dt>Updated</dt>
                  <dd>{formatUpdatedDate(updatedAt)}</dd>
                </div>
                <div>
                  <dt>Public route</dt>
                  <dd>{pageConfig.publicPath}</dd>
                </div>
                <div>
                  <dt>Default fields</dt>
                  <dd>{totalFields - customizedCount}</dd>
                </div>
              </dl>

              <div className="static-page-editor-actions">
                <Button
                  variant="primary"
                  size="sm"
                  icon="save"
                  loading={saveState === 'saving'}
                  onClick={() => void persistPage('manual')}
                >
                  Save page
                </Button>
                <a
                  className="static-page-editor-link"
                  href={pageConfig.publicPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open public page
                </a>
              </div>
            </div>

            <div className="static-rail-card">
              <span className="static-rail-kicker">Jump To</span>
              <h2>Sections</h2>
              <div className="static-section-jumps">
                {pageConfig.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className="static-section-jump"
                    onClick={() => jumpToSection(section.id)}
                  >
                    <strong>{section.title}</strong>
                    <span>{section.fields.length} fields</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="static-rail-card">
              <span className="static-rail-kicker">Live Preview</span>
              <h2>{pageConfig.title} page</h2>
              <PagePreview slug={slug} content={draftContent} />
            </div>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}
