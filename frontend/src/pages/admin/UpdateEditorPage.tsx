import {
  startTransition,
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
import {
  BLOG_TEMPLATES,
  COMMON_BLOG_CATEGORIES,
  MOCK_MEDIA_LIBRARY,
  QUICK_INSERT_SNIPPETS,
  type BlogTemplate,
  type MockMediaAsset,
} from './blogEditorConfig';
import './UpdateEditorPage.css';

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

  return `Saved ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

type SaveState = 'idle' | 'autosaving' | 'saving' | 'saved' | 'error';

type PersistReason = 'auto' | 'manual';

type PersistOptions = {
  reason: PersistReason;
  allowUntitled: boolean;
  successMessage?: string;
  showErrorToast?: boolean;
};

type BodyImageSlot = {
  id: string;
  alt: string;
  src: string;
  markdown: string;
  start: number;
  end: number;
};

const BODY_IMAGE_REGEX = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/gm;

function parseBodyImageSlots(markdown: string): BodyImageSlot[] {
  const slots: BodyImageSlot[] = [];
  const normalizedMarkdown = markdown.replace(/\r\n/g, '\n');
  const regex = new RegExp(BODY_IMAGE_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalizedMarkdown)) !== null) {
    slots.push({
      id: `image-slot-${slots.length}-${match.index}`,
      alt: match[1].trim(),
      src: match[2].trim(),
      markdown: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return slots;
}

function normalizeEditorMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function swapBodyImageSlots(markdown: string, firstIndex: number, secondIndex: number): string {
  const slots = parseBodyImageSlots(markdown);
  const first = slots[firstIndex];
  const second = slots[secondIndex];

  if (!first || !second) {
    return markdown;
  }

  const earlier = first.start < second.start ? first : second;
  const later = first.start < second.start ? second : first;
  const earlierReplacement = earlier === first ? second.markdown : first.markdown;
  const laterReplacement = later === second ? first.markdown : second.markdown;

  return normalizeEditorMarkdown(
    `${markdown.slice(0, earlier.start)}${earlierReplacement}${markdown.slice(earlier.end, later.start)}${laterReplacement}${markdown.slice(later.end)}`,
  );
}

function removeBodyImageSlot(markdown: string, index: number): string {
  const slots = parseBodyImageSlots(markdown);
  const slot = slots[index];

  if (!slot) {
    return markdown;
  }

  return normalizeEditorMarkdown(`${markdown.slice(0, slot.start)}${markdown.slice(slot.end)}`);
}

export default function BlogEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const latestFingerprintRef = useRef('');

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

  const [loading, setLoading] = useState(Boolean(id));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const postId = id || createdDraftId;
  const isNew = !postId;
  const deferredMarkdown = useDeferredValue(bodyMarkdown);
  const wordCount = useMemo(() => countWords(deferredMarkdown), [deferredMarkdown]);
  const readingMinutes = useMemo(() => Math.max(1, Math.ceil(wordCount / 220)), [wordCount]);
  const excerptPreview = useMemo(() => excerpt.trim() || deriveExcerpt(deferredMarkdown), [deferredMarkdown, excerpt]);
  const heroPreview = useMemo(
    () => MOCK_MEDIA_LIBRARY.find((asset) => asset.src === heroImageUrl) || null,
    [heroImageUrl],
  );
  const bodyImageSlots = useMemo(() => parseBodyImageSlots(bodyMarkdown), [bodyMarkdown]);
  const mediaAssetsBySource = useMemo(
    () => new Map(MOCK_MEDIA_LIBRARY.map((asset) => [asset.src, asset])),
    [],
  );

  const commonImageSuggestions = useMemo(
    () => MOCK_MEDIA_LIBRARY.map((asset) => asset.src),
    [],
  );

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
    authorDisplayName,
    authorRole,
    bodyMarkdown,
    category,
    ctaLabel,
    ctaUrl,
    excerpt,
    heroImageAlt,
    heroImageUrl,
    publishedAtInput,
    seoDescription,
    seoTitle,
    slug,
    slugManuallyEdited,
    title,
  ]);

  const currentFingerprint = useMemo(
    () => JSON.stringify({
      title: title.trim(),
      slug: slug.trim(),
      excerpt: excerpt.trim(),
      bodyMarkdown,
      category: category.trim(),
      authorDisplayName: authorDisplayName.trim(),
      authorRole: authorRole.trim(),
      heroImageUrl: heroImageUrl.trim(),
      heroImageAlt: heroImageAlt.trim(),
      seoTitle: seoTitle.trim(),
      seoDescription: seoDescription.trim(),
      ctaLabel: ctaLabel.trim(),
      ctaUrl: ctaUrl.trim(),
      publishedAt: fromLocalDateTimeInput(publishedAtInput),
    }),
    [
      authorDisplayName,
      authorRole,
      bodyMarkdown,
      category,
      ctaLabel,
      ctaUrl,
      excerpt,
      heroImageAlt,
      heroImageUrl,
      publishedAtInput,
      seoDescription,
      seoTitle,
      slug,
      title,
    ],
  );

  useEffect(() => {
    latestFingerprintRef.current = currentFingerprint;
  }, [currentFingerprint]);

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

    const normalizedFingerprint = JSON.stringify({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || '',
      bodyMarkdown: post.bodyMarkdown,
      category: post.category || '',
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
    latestFingerprintRef.current = normalizedFingerprint;
  }, []);

  const resetForNewPost = useCallback(() => {
    setTitle('');
    setSlug('');
    setSlugManuallyEdited(false);
    setExcerpt('');
    setCategory('');
    setAuthorDisplayName('');
    setAuthorRole('');
    setHeroImageUrl('');
    setHeroImageAlt('');
    setBodyMarkdown('');
    setSeoTitle('');
    setSeoDescription('');
    setCtaLabel('');
    setCtaUrl('');
    setPublishedAtInput('');
    setStatus('draft');
    setLastSavedAt(null);
    setSaveState('idle');
    setError(null);
    setEditorKey('new');
    latestFingerprintRef.current = JSON.stringify({
      title: '',
      slug: '',
      excerpt: '',
      bodyMarkdown: '',
      category: '',
      authorDisplayName: '',
      authorRole: '',
      heroImageUrl: '',
      heroImageAlt: '',
      seoTitle: '',
      seoDescription: '',
      ctaLabel: '',
      ctaUrl: '',
      publishedAt: null,
    });
  }, []);

  const loadBlogPost = useCallback(async () => {
    if (!id) {
      setLoading(false);
      resetForNewPost();
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const post = await adminGetBlogPost(id);
      hydrateFromPost(post);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load blog post.'));
    } finally {
      setLoading(false);
    }
  }, [hydrateFromPost, id, resetForNewPost]);

  useEffect(() => {
    void loadBlogPost();
  }, [loadBlogPost]);

  const persistDraft = useCallback(async ({
    reason,
    allowUntitled,
    successMessage,
    showErrorToast = true,
  }: PersistOptions): Promise<BlogPost | null> => {
    const payload = buildFormData(allowUntitled);

    if (!allowUntitled && !payload.title?.trim()) {
      showToast('Title is required before publishing.', 'error');
      return null;
    }

    const hasAnyContent = Boolean(
      title.trim()
      || excerpt.trim()
      || bodyMarkdown.trim()
      || heroImageUrl.trim()
      || ctaLabel.trim()
      || category.trim()
      || seoTitle.trim()
      || seoDescription.trim(),
    );

    if (!hasAnyContent) {
      return null;
    }

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

      if (!postId) {
        navigate(`/admin/content/blog/${saved.id}`, { replace: true });
      }

      if (successMessage) {
        showToast(successMessage, 'success');
      }

      return saved;
    } catch (err) {
      setSaveState('error');
      if (showErrorToast) {
        showToast(getErrorMessage(err, 'Failed to save draft.'), 'error');
      }
      return null;
    }
  }, [
    bodyMarkdown,
    buildFormData,
    category,
    ctaLabel,
    currentFingerprint,
    excerpt,
    heroImageUrl,
    navigate,
    postId,
    seoDescription,
    seoTitle,
    showToast,
    title,
  ]);

  useEffect(() => {
    if (loading || publishing || deleting) return;
    if (saveState === 'saving' || saveState === 'autosaving') return;
    if (currentFingerprint === latestFingerprintRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void persistDraft({
        reason: 'auto',
        allowUntitled: true,
        showErrorToast: false,
      });
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [currentFingerprint, deleting, loading, persistDraft, publishing, saveState]);

  const replaceEditorMarkdown = useCallback((nextMarkdown: string) => {
    setBodyMarkdown(nextMarkdown);
    queueMicrotask(() => {
      editorRef.current?.setMarkdown(nextMarkdown);
    });
  }, []);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slugManuallyEdited) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    setSlug(slugify(value));
  };

  const handleMetadataChange = (
    setter: (value: string) => void,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setter(event.target.value);
  };

  const handleSaveDraft = async () => {
    await persistDraft({
      reason: 'manual',
      allowUntitled: true,
      successMessage: 'Draft saved.',
    });
  };

  const handlePublish = async () => {
    if (!title.trim()) {
      showToast('Title is required before publishing.', 'error');
      return;
    }

    if (!bodyMarkdown.trim()) {
      showToast('Add some body content before publishing.', 'error');
      return;
    }

    setPublishing(true);
    try {
      const saved = await persistDraft({
        reason: 'manual',
        allowUntitled: false,
        showErrorToast: true,
      });

      if (!saved) {
        setPublishing(false);
        return;
      }

      const published = await adminPublishBlogPost(saved.id);
      setStatus(published.status);
      setPublishedAtInput(toLocalDateTimeInput(published.publishedAt));
      setLastSavedAt(published.updatedAt);
      showToast('Blog post published.', 'success');
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
      showToast('Blog post unpublished.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to unpublish.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!postId) return;
    if (!window.confirm('Delete this blog post? This cannot be undone.')) return;

    setDeleting(true);
    try {
      await adminDeleteBlogPost(postId);
      showToast('Blog post deleted.', 'success');
      navigate('/admin/content');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to delete.'), 'error');
      setDeleting(false);
    }
  };

  const applyTemplate = (template: BlogTemplate) => {
    const hasExistingDraft = Boolean(title.trim() || excerpt.trim() || bodyMarkdown.trim());
    if (hasExistingDraft && !window.confirm('Replace the current draft with this template?')) {
      return;
    }

    startTransition(() => {
      setTitle(template.title);
      setSlug(slugify(template.title));
      setSlugManuallyEdited(false);
      setExcerpt(template.excerpt);
      setCategory(template.category);
      setHeroImageUrl(template.heroImageUrl || '');
      setHeroImageAlt(template.heroImageAlt || '');
      setCtaLabel(template.ctaLabel || '');
      setCtaUrl(template.ctaUrl || '');
    });

    replaceEditorMarkdown(template.bodyMarkdown);
  };

  const insertSnippet = (markdown: string) => {
    editorRef.current?.focus();
    editorRef.current?.insertMarkdown(markdown);
  };

  const applyMockMediaToHero = (asset: MockMediaAsset) => {
    setHeroImageUrl(asset.src);
    setHeroImageAlt(asset.alt);
  };

  const insertMockMedia = (asset: MockMediaAsset) => {
    insertSnippet(`\n![${asset.alt}](${asset.src})\n\n`);
  };

  const moveBodyImageSlot = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= bodyImageSlots.length) {
      return;
    }

    replaceEditorMarkdown(swapBodyImageSlots(bodyMarkdown, index, nextIndex));
  };

  const deleteBodyImageSlot = (index: number) => {
    replaceEditorMarkdown(removeBodyImageSlot(bodyMarkdown, index));
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="update-editor-loading">Loading blog post...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="update-editor blog-editor-page">
        <button
          className="update-editor-back"
          onClick={() => navigate('/admin/content')}
        >
          <Icon name="arrow-left" size={16} />
          <span>Back to Content</span>
        </button>

        <div className="blog-editor-shell">
          <section className="blog-editor-canvas">
            <div className="blog-editor-hero">
              <div>
                <div className="blog-editor-kicker">Editorial Studio</div>
                <h1 className="blog-editor-heading">{isNew ? 'Compose a Blog Post' : 'Refine the Draft'}</h1>
                <p className="blog-editor-subtitle">
                  Start in the writing canvas. Publishing details stay in the rail, while templates and media stay close to the draft where they are actually used.
                </p>
              </div>

              <div className="blog-editor-status-panel">
                <span className={`updates-status-badge ${status}`}>{status}</span>
                <span className={`blog-save-state state-${saveState}`}>{formatSavedTime(lastSavedAt)}</span>
              </div>
            </div>

            {error && <div className="update-editor-error">{error}</div>}

            <div className="blog-editor-main-card">
              <div className="blog-editor-topline">
                <div className="blog-editor-stat">
                  <span>Words</span>
                  <strong>{wordCount}</strong>
                </div>
                <div className="blog-editor-stat">
                  <span>Read time</span>
                  <strong>{readingMinutes} min</strong>
                </div>
                <div className="blog-editor-stat">
                  <span>Preview deck</span>
                  <strong>{excerptPreview ? 'Ready' : 'Missing'}</strong>
                </div>
              </div>

              <div className="blog-editor-title-stack">
                <label className="blog-editor-label" htmlFor="update-title">
                  Title
                </label>
                <input
                  id="update-title"
                  className="blog-editor-title-input"
                  type="text"
                  value={title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  placeholder="A clear, human title beats a clever placeholder."
                />
              </div>

              <div className="blog-editor-title-stack">
                <label className="blog-editor-label" htmlFor="update-excerpt">
                  Deck / Excerpt
                </label>
                <AutoResizeTextarea
                  id="update-excerpt"
                  className="blog-editor-excerpt-input"
                  value={excerpt}
                  onChange={setExcerpt}
                  minHeight={128}
                  placeholder="This is the short summary readers will see in blog cards, social previews, and search."
                />
              </div>

              <div className="blog-editor-toolbelt">
                <section className="blog-editor-inline-card">
                  <div className="blog-inline-card-header">
                    <div>
                      <div className="blog-inline-eyebrow">Starting points</div>
                      <h2>Templates</h2>
                    </div>
                    <p>
                      Drop in a structure without turning the editor into a wall of fields.
                    </p>
                  </div>

                  <div className="blog-template-grid">
                    {BLOG_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        className="blog-template-card"
                        type="button"
                        onClick={() => applyTemplate(template)}
                      >
                        <strong>{template.label}</strong>
                        <span>{template.description}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="blog-editor-inline-card">
                  <div className="blog-inline-card-header">
                    <div>
                      <div className="blog-inline-eyebrow">Visual assets</div>
                      <h2>Media shelf</h2>
                    </div>
                    <p>
                      Set a hero or insert images at the cursor without sending you to the far edge of the page.
                    </p>
                  </div>

                  <div className="blog-media-grid">
                    {MOCK_MEDIA_LIBRARY.map((asset) => (
                      <div key={asset.id} className="blog-media-card">
                        <img src={asset.src} alt={asset.alt} />
                        <div className="blog-media-copy">
                          <strong>{asset.label}</strong>
                          <span>{asset.hint}</span>
                        </div>
                        <div className="blog-media-actions">
                          <button type="button" onClick={() => applyMockMediaToHero(asset)}>
                            Set as hero
                          </button>
                          <button type="button" onClick={() => insertMockMedia(asset)}>
                            Insert in post
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {bodyImageSlots.length > 0 && (
                    <div className="blog-image-order-panel">
                      <div className="blog-image-order-header">
                        <div>
                          <div className="blog-inline-eyebrow">Current image slots</div>
                          <h3>Reorder images without fighting the editor</h3>
                        </div>
                        <p>
                          These controls swap image placements in the draft so you can move visuals around without dragging blocks.
                        </p>
                      </div>

                      <div className="blog-image-order-list">
                        {bodyImageSlots.map((slot, index) => {
                          const asset = mediaAssetsBySource.get(slot.src);
                          const label = asset?.label || slot.alt || `Image ${index + 1}`;

                          return (
                            <div key={slot.id} className="blog-image-order-card">
                              <div className="blog-image-order-meta">
                                <strong>{label}</strong>
                                <span>{slot.src}</span>
                              </div>
                              <div className="blog-image-order-actions">
                                <button
                                  type="button"
                                  onClick={() => moveBodyImageSlot(index, -1)}
                                  disabled={index === 0}
                                >
                                  Move earlier
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveBodyImageSlot(index, 1)}
                                  disabled={index === bodyImageSlots.length - 1}
                                >
                                  Move later
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => deleteBodyImageSlot(index)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="blog-editor-snippets">
                {QUICK_INSERT_SNIPPETS.map((snippet) => (
                  <button
                    key={snippet.id}
                    className="blog-snippet-chip"
                    onClick={() => insertSnippet(snippet.markdown)}
                    type="button"
                  >
                    {snippet.label}
                  </button>
                ))}
              </div>

              <div className="blog-editor-surface">
                <MDXEditor
                  key={editorKey}
                  ref={editorRef}
                  markdown={bodyMarkdown}
                  onChange={(markdown) => setBodyMarkdown(markdown)}
                  className="blog-mdx-editor"
                  contentEditableClassName="blog-mdx-prose"
                  placeholder="Start with the scene, the shift, or the question that made this post worth writing."
                  plugins={[
                    headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
                    listsPlugin(),
                    quotePlugin(),
                    linkPlugin(),
                    linkDialogPlugin(),
                    imagePlugin({ imageAutocompleteSuggestions: commonImageSuggestions }),
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
          </section>

          <aside className="blog-editor-rail">
            <section className="blog-editor-rail-card">
              <h2>Publish</h2>
              <div className="editor-field">
                <label htmlFor="update-publish-at">Publish date</label>
                <input
                  id="update-publish-at"
                  type="datetime-local"
                  value={publishedAtInput}
                  onChange={handleMetadataChange(setPublishedAtInput)}
                />
              </div>
              <div className="blog-editor-actions">
                <Button
                  variant="primary"
                  size="sm"
                  icon="save"
                  loading={saveState === 'saving'}
                  onClick={handleSaveDraft}
                >
                  Save Draft
                </Button>
                {status === 'published' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={publishing}
                    onClick={handleUnpublish}
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="eye"
                    loading={publishing}
                    onClick={handlePublish}
                  >
                    Publish
                  </Button>
                )}
              </div>
              {!isNew && status === 'draft' && (
                <div className="blog-editor-delete-row">
                  <Button
                    variant="danger"
                    size="sm"
                    icon="delete"
                    loading={deleting}
                    onClick={handleDelete}
                  >
                    Delete Draft
                  </Button>
                </div>
              )}
            </section>

            <section className="blog-editor-rail-card">
              <h2>Structure</h2>
              <div className="editor-field">
                <label htmlFor="update-category">Category</label>
                <input
                  id="update-category"
                  list="blog-category-suggestions"
                  type="text"
                  value={category}
                  onChange={handleMetadataChange(setCategory)}
                  placeholder="Pick one or type your own"
                />
                <datalist id="blog-category-suggestions">
                  {COMMON_BLOG_CATEGORIES.map((categoryOption) => (
                    <option key={categoryOption} value={categoryOption} />
                  ))}
                </datalist>
              </div>

              <div className="editor-field">
                <label htmlFor="update-slug">Slug</label>
                <input
                  id="update-slug"
                  type="text"
                  value={slug}
                  onChange={(event) => handleSlugChange(event.target.value)}
                  placeholder="Auto-generated from the title"
                />
              </div>

              <div className="editor-field">
                <label htmlFor="update-author-name">Author name</label>
                <input
                  id="update-author-name"
                  type="text"
                  value={authorDisplayName}
                  onChange={handleMetadataChange(setAuthorDisplayName)}
                  placeholder="Display name"
                />
              </div>

              <div className="editor-field">
                <label htmlFor="update-author-role">Author role</label>
                <input
                  id="update-author-role"
                  type="text"
                  value={authorRole}
                  onChange={handleMetadataChange(setAuthorRole)}
                  placeholder="Archive Director, Volunteer Coordinator..."
                />
              </div>
            </section>

            <section className="blog-editor-rail-card">
              <h2>Hero Media</h2>
              <div className="editor-field">
                <label htmlFor="update-hero-url">Hero image URL</label>
                <input
                  id="update-hero-url"
                  type="text"
                  value={heroImageUrl}
                  onChange={handleMetadataChange(setHeroImageUrl)}
                  placeholder="/mock-blog/search-workbench.svg"
                />
              </div>

              <div className="editor-field">
                <label htmlFor="update-hero-alt">Hero image alt</label>
                <input
                  id="update-hero-alt"
                  type="text"
                  value={heroImageAlt}
                  onChange={handleMetadataChange(setHeroImageAlt)}
                  placeholder="Describe the image clearly"
                />
              </div>

              {(heroImageUrl || heroPreview) && (
                <div className="blog-editor-hero-preview">
                  <img src={heroImageUrl || heroPreview?.src} alt={heroImageAlt || heroPreview?.alt || 'Hero preview'} />
                </div>
              )}
            </section>

            <section className="blog-editor-rail-card">
              <h2>Call to Action</h2>
              <div className="editor-field">
                <label htmlFor="update-cta-label">Button label</label>
                <input
                  id="update-cta-label"
                  type="text"
                  value={ctaLabel}
                  onChange={handleMetadataChange(setCtaLabel)}
                  placeholder="Browse Collections"
                />
              </div>
              <div className="editor-field">
                <label htmlFor="update-cta-url">Button URL</label>
                <input
                  id="update-cta-url"
                  type="text"
                  value={ctaUrl}
                  onChange={handleMetadataChange(setCtaUrl)}
                  placeholder="/collections"
                />
              </div>
            </section>

            <section className="blog-editor-rail-card">
              <h2>SEO</h2>
              <div className="editor-field">
                <label htmlFor="update-seo-title">SEO title</label>
                <input
                  id="update-seo-title"
                  type="text"
                  value={seoTitle}
                  onChange={handleMetadataChange(setSeoTitle)}
                  placeholder="Override the browser title if needed"
                />
              </div>
              <div className="editor-field">
                <label htmlFor="update-seo-description">SEO description</label>
                <AutoResizeTextarea
                  id="update-seo-description"
                  className="blog-editor-meta-textarea"
                  value={seoDescription}
                  onChange={setSeoDescription}
                  minHeight={104}
                  placeholder="Leave blank to fall back to the deck."
                />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}
