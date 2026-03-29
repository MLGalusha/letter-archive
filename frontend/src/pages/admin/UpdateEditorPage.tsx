import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  UndoRedo,
  codeBlockPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import AutoResizeTextarea from '../../components/common/AutoResizeTextarea';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import {
  adminCreateBlogPost,
  adminDeleteBlogPost,
  adminGetBlogPost,
  adminPublishBlogPost,
  adminUnpublishBlogPost,
  adminUpdateBlogPost,
  type BlogPost,
} from '../../api/admin/content';
import { useToast } from '../../contexts/ToastContext';
import { COMMON_BLOG_CATEGORIES } from './blogEditorConfig';
import './UpdateEditorPage.css';

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function toLocalDateTimeInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(markdown: string): number {
  const plain = stripMarkdown(markdown);
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

function deriveExcerpt(markdown: string): string {
  const plain = stripMarkdown(markdown);
  if (!plain) return '';
  return plain.slice(0, 180).trim();
}

function formatSavedTime(iso: string | null): string {
  if (!iso) return 'Not saved yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Saved just now';
  return `Saved ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type SaveState = 'idle' | 'autosaving' | 'saving' | 'saved' | 'error';

type PersistOptions = {
  reason: 'auto' | 'manual';
  allowUntitled: boolean;
  successMessage?: string;
  showErrorToast?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function JournalEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const latestFingerprintRef = useRef('');

  /* ---- field state ---- */
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [excerpt, setExcerpt] = useState('');
  const [category, setCategory] = useState('');
  const [authorDisplayName, setAuthorDisplayName] = useState('');
  const [authorRole, setAuthorRole] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [heroImageAlt, setHeroImageAlt] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [publishedAtInput, setPublishedAtInput] = useState('');
  const [status, setStatus] = useState<string>('draft');
  const [editorKey, setEditorKey] = useState('new');

  /* ---- UI state ---- */
  const [loading, setLoading] = useState(Boolean(id));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const postId = id || createdDraftId;
  const isNew = !postId;
  const deferredMarkdown = useDeferredValue(bodyMarkdown);
  const wordCount = useMemo(() => countWords(deferredMarkdown), [deferredMarkdown]);
  const readingMinutes = useMemo(() => Math.max(1, Math.ceil(wordCount / 220)), [wordCount]);
  const excerptPreview = useMemo(
    () => excerpt.trim() || deriveExcerpt(deferredMarkdown),
    [deferredMarkdown, excerpt],
  );

  /* ---- form data & fingerprint ---- */

  const buildFormData = useCallback((allowUntitled: boolean): Partial<BlogPost> => {
    const resolvedTitle = title.trim() || (allowUntitled ? 'Untitled draft' : '');
    const resolvedSlugSource = slug.trim() || resolvedTitle || 'untitled-draft';
    return {
      title: resolvedTitle,
      slug: slugManuallyEdited ? slugify(slug.trim() || 'untitled-draft') : slugify(resolvedSlugSource),
      excerpt: excerpt.trim() || null,
      bodyMarkdown,
      category: category.trim() || null,
      authorDisplayName: authorDisplayName.trim() || null,
      authorRole: authorRole.trim() || null,
      heroImageUrl: heroImageUrl.trim() || null,
      heroImageAlt: heroImageAlt.trim() || null,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      ctaLabel: ctaLabel.trim() || null,
      ctaUrl: ctaUrl.trim() || null,
      publishedAt: fromLocalDateTimeInput(publishedAtInput),
    };
  }, [
    authorDisplayName, authorRole, bodyMarkdown, category, ctaLabel, ctaUrl,
    excerpt, heroImageAlt, heroImageUrl, publishedAtInput, seoDescription,
    seoTitle, slug, slugManuallyEdited, title,
  ]);

  const currentFingerprint = useMemo(
    () => JSON.stringify({
      title: title.trim(), slug: slug.trim(), excerpt: excerpt.trim(),
      bodyMarkdown, category: category.trim(),
      authorDisplayName: authorDisplayName.trim(), authorRole: authorRole.trim(),
      heroImageUrl: heroImageUrl.trim(), heroImageAlt: heroImageAlt.trim(),
      seoTitle: seoTitle.trim(), seoDescription: seoDescription.trim(),
      ctaLabel: ctaLabel.trim(), ctaUrl: ctaUrl.trim(),
      publishedAt: fromLocalDateTimeInput(publishedAtInput),
    }),
    [
      authorDisplayName, authorRole, bodyMarkdown, category, ctaLabel, ctaUrl,
      excerpt, heroImageAlt, heroImageUrl, publishedAtInput, seoDescription,
      seoTitle, slug, title,
    ],
  );

  useEffect(() => {
    latestFingerprintRef.current = currentFingerprint;
  }, [currentFingerprint]);

  /* ---- hydrate / reset ---- */

  const hydrateFromPost = useCallback((post: BlogPost) => {
    setTitle(post.title);
    setSlug(post.slug);
    setSlugManuallyEdited(post.slug !== slugify(post.title));
    setExcerpt(post.excerpt || '');
    setCategory(post.category || '');
    setAuthorDisplayName(post.authorDisplayName || '');
    setAuthorRole(post.authorRole || '');
    setHeroImageUrl(post.heroImageUrl || '');
    setHeroImageAlt(post.heroImageAlt || '');
    setBodyMarkdown(post.bodyMarkdown || '');
    setSeoTitle(post.seoTitle || '');
    setSeoDescription(post.seoDescription || '');
    setCtaLabel(post.ctaLabel || '');
    setCtaUrl(post.ctaUrl || '');
    setPublishedAtInput(toLocalDateTimeInput(post.publishedAt));
    setStatus(post.status);
    setLastSavedAt(post.updatedAt);
    setSaveState('saved');
    setEditorKey(`post-${post.id}-${post.updatedAt}`);

    latestFingerprintRef.current = JSON.stringify({
      title: post.title, slug: post.slug, excerpt: post.excerpt || '',
      bodyMarkdown: post.bodyMarkdown, category: post.category || '',
      authorDisplayName: post.authorDisplayName || '',
      authorRole: post.authorRole || '',
      heroImageUrl: post.heroImageUrl || '',
      heroImageAlt: post.heroImageAlt || '',
      seoTitle: post.seoTitle || '',
      seoDescription: post.seoDescription || '',
      ctaLabel: post.ctaLabel || '',
      ctaUrl: post.ctaUrl || '',
      publishedAt: post.publishedAt,
    });
  }, []);

  const resetForNewPost = useCallback(() => {
    setTitle(''); setSlug(''); setSlugManuallyEdited(false);
    setExcerpt(''); setCategory(''); setAuthorDisplayName('');
    setAuthorRole(''); setHeroImageUrl(''); setHeroImageAlt('');
    setBodyMarkdown(''); setSeoTitle(''); setSeoDescription('');
    setCtaLabel(''); setCtaUrl(''); setPublishedAtInput('');
    setStatus('draft'); setLastSavedAt(null); setSaveState('idle');
    setError(null); setEditorKey('new');
    latestFingerprintRef.current = JSON.stringify({
      title: '', slug: '', excerpt: '', bodyMarkdown: '', category: '',
      authorDisplayName: '', authorRole: '', heroImageUrl: '', heroImageAlt: '',
      seoTitle: '', seoDescription: '', ctaLabel: '', ctaUrl: '', publishedAt: null,
    });
  }, []);

  /* ---- load ---- */

  const loadBlogPost = useCallback(async () => {
    if (!id) { setLoading(false); resetForNewPost(); return; }
    try {
      setLoading(true); setError(null);
      const post = await adminGetBlogPost(id);
      hydrateFromPost(post);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load journal entry.'));
    } finally {
      setLoading(false);
    }
  }, [hydrateFromPost, id, resetForNewPost]);

  useEffect(() => { void loadBlogPost(); }, [loadBlogPost]);

  /* ---- persist / autosave ---- */

  const persistDraft = useCallback(async ({
    reason, allowUntitled, successMessage, showErrorToast = true,
  }: PersistOptions): Promise<BlogPost | null> => {
    const payload = buildFormData(allowUntitled);
    if (!allowUntitled && !payload.title?.trim()) {
      showToast('Title is required before publishing.', 'error');
      return null;
    }
    const hasAnyContent = Boolean(
      title.trim() || excerpt.trim() || bodyMarkdown.trim()
      || heroImageUrl.trim() || ctaLabel.trim() || category.trim()
      || seoTitle.trim() || seoDescription.trim(),
    );
    if (!hasAnyContent) return null;

    setSaveState(reason === 'auto' ? 'autosaving' : 'saving');
    try {
      const saved = postId
        ? await adminUpdateBlogPost(postId, payload)
        : await adminCreateBlogPost(payload);
      setCreatedDraftId(saved.id);
      setStatus(saved.status);
      setLastSavedAt(saved.updatedAt);
      setSaveState('saved');
      latestFingerprintRef.current = currentFingerprint;
      if (!postId) navigate(`/admin/content/blog/${saved.id}`, { replace: true });
      if (successMessage) showToast(successMessage, 'success');
      return saved;
    } catch (err) {
      setSaveState('error');
      if (showErrorToast) showToast(getErrorMessage(err, 'Failed to save draft.'), 'error');
      return null;
    }
  }, [
    bodyMarkdown, buildFormData, category, ctaLabel, currentFingerprint, excerpt,
    heroImageUrl, navigate, postId, seoDescription, seoTitle, showToast, title,
  ]);

  useEffect(() => {
    if (loading || publishing || deleting) return;
    if (saveState === 'saving' || saveState === 'autosaving') return;
    if (currentFingerprint === latestFingerprintRef.current) return;
    const timeoutId = window.setTimeout(() => {
      void persistDraft({ reason: 'auto', allowUntitled: true, showErrorToast: false });
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [currentFingerprint, deleting, loading, persistDraft, publishing, saveState]);

  /* ---- handlers ---- */

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slugManuallyEdited) setSlug(slugify(value));
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    setSlug(slugify(value));
  };

  const handleField = (setter: (v: string) => void) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setter(e.target.value);

  const handleSaveDraft = async () => {
    await persistDraft({ reason: 'manual', allowUntitled: true, successMessage: 'Draft saved.' });
  };

  const handlePublish = async () => {
    if (!title.trim()) { showToast('Title is required before publishing.', 'error'); return; }
    if (!bodyMarkdown.trim()) { showToast('Add some body content before publishing.', 'error'); return; }
    setPublishing(true);
    try {
      const saved = await persistDraft({ reason: 'manual', allowUntitled: false, showErrorToast: true });
      if (!saved) { setPublishing(false); return; }
      const published = await adminPublishBlogPost(saved.id);
      setStatus(published.status);
      setPublishedAtInput(toLocalDateTimeInput(published.publishedAt));
      setLastSavedAt(published.updatedAt);
      showToast('Journal entry published.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to publish.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!postId) return;
    setPublishing(true);
    try {
      const unpublished = await adminUnpublishBlogPost(postId);
      setStatus(unpublished.status);
      setLastSavedAt(unpublished.updatedAt);
      showToast('Journal entry unpublished.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to unpublish.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!postId) return;
    if (!window.confirm('Delete this journal entry? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await adminDeleteBlogPost(postId);
      showToast('Journal entry deleted.', 'success');
      navigate('/admin/content');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to delete.'), 'error');
      setDeleting(false);
    }
  };

  /* ---- render ---- */

  if (loading) {
    return (
      <AdminLayout>
        <div className="journal-editor-loading">Loading journal entry...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="journal-editor">
        {/* ---- top bar ---- */}
        <header className="journal-editor-topbar">
          <div className="journal-topbar-left">
            <button
              className="journal-back-btn"
              onClick={() => navigate('/admin/content')}
            >
              <Icon name="arrow-left" size={16} />
              <span>Back</span>
            </button>
            <span className={`journal-status-badge ${status}`}>{status}</span>
            <span className={`journal-save-state state-${saveState}`}>
              {formatSavedTime(lastSavedAt)}
            </span>
          </div>

          <div className="journal-topbar-right">
            {status === 'published' && slug && (
              <a
                className="journal-preview-link"
                href={`/blog/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="eye" size={16} />
                <span>Preview</span>
              </a>
            )}
            <button
              className="journal-settings-toggle"
              onClick={() => setSettingsOpen((prev) => !prev)}
              aria-label="Post settings"
            >
              <Icon name="settings" size={18} />
              <span>Settings</span>
            </button>
            <Button
              variant="secondary"
              size="sm"
              icon="save"
              loading={saveState === 'saving'}
              onClick={handleSaveDraft}
            >
              Save
            </Button>
            {status === 'published' ? (
              <Button variant="secondary" size="sm" loading={publishing} onClick={handleUnpublish}>
                Unpublish
              </Button>
            ) : (
              <Button variant="primary" size="sm" loading={publishing} onClick={handlePublish}>
                Publish
              </Button>
            )}
            {!isNew && status === 'draft' && (
              <Button variant="danger" size="sm" icon="delete" loading={deleting} onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
        </header>

        {error && <div className="journal-editor-error">{error}</div>}

        {/* ---- writing canvas ---- */}
        <div className="journal-editor-canvas">
          <div className="journal-title-group">
            <label className="journal-canvas-label">Title</label>
            <input
              className="journal-editor-title"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Give your entry a title..."
            />
          </div>

          <div className="journal-excerpt-group">
            <div className="journal-excerpt-header">
              <label className="journal-canvas-label">Summary</label>
              {!excerpt.trim() && excerptPreview && (
                <span className="journal-excerpt-auto">Auto-generated from body</span>
              )}
            </div>
            <AutoResizeTextarea
              className="journal-editor-excerpt"
              value={excerpt}
              onChange={setExcerpt}
              minHeight={48}
              maxHeight={140}
              placeholder={excerptPreview ? excerptPreview.slice(0, 120) + '...' : 'Write a brief summary for readers...'}
            />
          </div>

          <div className="journal-editor-surface">
            <MDXEditor
              key={editorKey}
              ref={editorRef}
              markdown={bodyMarkdown}
              onChange={(md) => setBodyMarkdown(md)}
              className="journal-mdx-editor"
              contentEditableClassName="journal-mdx-prose"
              placeholder="Start writing..."
              plugins={[
                headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
                listsPlugin(),
                quotePlugin(),
                linkPlugin(),
                linkDialogPlugin(),
                imagePlugin(),
                tablePlugin(),
                thematicBreakPlugin(),
                codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
                markdownShortcutPlugin(),
                diffSourcePlugin({ viewMode: 'rich-text' }),
                toolbarPlugin({
                  toolbarContents: () => (
                    <DiffSourceToggleWrapper options={['rich-text', 'source']}>
                      <UndoRedo />
                      <BlockTypeSelect />
                      <BoldItalicUnderlineToggles />
                      <ListsToggle />
                      <CreateLink />
                      <CodeToggle />
                      <InsertImage />
                      <InsertTable />
                      <InsertCodeBlock />
                      <InsertThematicBreak />
                    </DiffSourceToggleWrapper>
                  ),
                }),
              ]}
            />
          </div>
        </div>

        {/* ---- settings drawer ---- */}
        {settingsOpen && (
          <>
            <div
              className="journal-settings-overlay"
              onClick={() => setSettingsOpen(false)}
            />
            <aside className="journal-settings-drawer">
              <div className="journal-settings-header">
                <h2>Post Settings</h2>
                <button
                  className="journal-settings-close"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              <div className="journal-settings-body">
                <div className="journal-field">
                  <label htmlFor="journal-category">Category</label>
                  <input
                    id="journal-category"
                    list="journal-category-suggestions"
                    type="text"
                    value={category}
                    onChange={handleField(setCategory)}
                    placeholder="Pick or type a category"
                  />
                  <datalist id="journal-category-suggestions">
                    {COMMON_BLOG_CATEGORIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div className="journal-field">
                  <label htmlFor="journal-slug">Slug</label>
                  <input
                    id="journal-slug"
                    type="text"
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="Auto-generated from title"
                  />
                </div>

                <div className="journal-field">
                  <label htmlFor="journal-author">Author</label>
                  <input
                    id="journal-author"
                    type="text"
                    value={authorDisplayName}
                    onChange={handleField(setAuthorDisplayName)}
                    placeholder="Display name"
                  />
                </div>

                <div className="journal-field">
                  <label htmlFor="journal-publish-date">Publish date</label>
                  <input
                    id="journal-publish-date"
                    type="datetime-local"
                    value={publishedAtInput}
                    onChange={handleField(setPublishedAtInput)}
                  />
                </div>

                <details className="journal-settings-advanced">
                  <summary>Advanced</summary>

                  <div className="journal-field">
                    <label htmlFor="journal-author-role">Author role</label>
                    <input
                      id="journal-author-role"
                      type="text"
                      value={authorRole}
                      onChange={handleField(setAuthorRole)}
                      placeholder="Archive Director, Volunteer..."
                    />
                  </div>

                  <div className="journal-field">
                    <label htmlFor="journal-hero-url">Hero image URL</label>
                    <input
                      id="journal-hero-url"
                      type="text"
                      value={heroImageUrl}
                      onChange={handleField(setHeroImageUrl)}
                      placeholder="/images/hero.jpg"
                    />
                  </div>

                  <div className="journal-field">
                    <label htmlFor="journal-hero-alt">Hero image alt</label>
                    <input
                      id="journal-hero-alt"
                      type="text"
                      value={heroImageAlt}
                      onChange={handleField(setHeroImageAlt)}
                      placeholder="Describe the image"
                    />
                  </div>

                  <div className="journal-field">
                    <label htmlFor="journal-seo-title">SEO title</label>
                    <input
                      id="journal-seo-title"
                      type="text"
                      value={seoTitle}
                      onChange={handleField(setSeoTitle)}
                      placeholder="Override browser title"
                    />
                  </div>

                  <div className="journal-field">
                    <label htmlFor="journal-seo-desc">SEO description</label>
                    <textarea
                      id="journal-seo-desc"
                      value={seoDescription}
                      onChange={handleField(setSeoDescription)}
                      placeholder="Falls back to excerpt"
                      rows={3}
                    />
                  </div>

                  <div className="journal-field">
                    <label htmlFor="journal-cta-label">CTA button label</label>
                    <input
                      id="journal-cta-label"
                      type="text"
                      value={ctaLabel}
                      onChange={handleField(setCtaLabel)}
                      placeholder="Browse Collections"
                    />
                  </div>

                  <div className="journal-field">
                    <label htmlFor="journal-cta-url">CTA button URL</label>
                    <input
                      id="journal-cta-url"
                      type="text"
                      value={ctaUrl}
                      onChange={handleField(setCtaUrl)}
                      placeholder="/collections"
                    />
                  </div>
                </details>
              </div>

              <div className="journal-settings-footer">
                <span>{wordCount} words</span>
                <span>{readingMinutes} min read</span>
              </div>
            </aside>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
