import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import {
  adminGetBlogPost,
  adminCreateBlogPost,
  adminUpdateBlogPost,
  adminPublishBlogPost,
  adminUnpublishBlogPost,
  adminDeleteBlogPost,
  type BlogPost,
} from '../../api/admin/content';
import { useToast } from '../../contexts/ToastContext';
import './UpdateEditorPage.css';

const CATEGORIES = [
  'Archive Progress',
  'New Features',
  'Collections',
  'Behind the Scenes',
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export default function BlogEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isNew = !id;

  // ── Form state ─────────────────────────────────────────
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
  const [status, setStatus] = useState<string>('draft');

  // ── UI state ───────────────────────────────────────────
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load existing blog post ───────────────────────────
  const loadBlogPost = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const post = await adminGetBlogPost(id);
      setTitle(post.title);
      setSlug(post.slug);
      setSlugManuallyEdited(true);
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
      setStatus(post.status);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load blog post.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadBlogPost();
  }, [loadBlogPost]);

  // ── Auto-slug from title ──────────────────────────────
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

  // ── Build form data ───────────────────────────────────
  function buildFormData(): Partial<BlogPost> {
    return {
      title,
      slug,
      excerpt: excerpt || null,
      bodyMarkdown: bodyMarkdown,
      category: category || null,
      authorDisplayName: authorDisplayName || null,
      authorRole: authorRole || null,
      heroImageUrl: heroImageUrl || null,
      heroImageAlt: heroImageAlt || null,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      ctaLabel: ctaLabel || null,
      ctaUrl: ctaUrl || null,
    };
  }

  // ── Handlers ──────────────────────────────────────────

  const handleSaveDraft = async () => {
    if (!title.trim()) {
      showToast('Title is required.', 'error');
      return;
    }

    setSaving(true);
    try {
      const data = buildFormData();

      if (isNew) {
        const created = await adminCreateBlogPost(data);
        showToast('Draft saved.', 'success');
        navigate(`/admin/content/blog/${created.id}`, { replace: true });
      } else {
        await adminUpdateBlogPost(id!, data);
        showToast('Draft saved.', 'success');
        await loadBlogPost();
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!title.trim()) {
      showToast('Title is required.', 'error');
      return;
    }

    setPublishing(true);
    try {
      const data = buildFormData();

      if (isNew) {
        const created = await adminCreateBlogPost(data);
        await adminPublishBlogPost(created.id);
        showToast('Blog post published.', 'success');
        navigate(`/admin/content/blog/${created.id}`, { replace: true });
      } else {
        await adminUpdateBlogPost(id!, data);
        await adminPublishBlogPost(id!);
        showToast('Blog post published.', 'success');
        await loadBlogPost();
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to publish.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!id) return;
    setPublishing(true);
    try {
      await adminUnpublishBlogPost(id);
      showToast('Blog post unpublished.', 'success');
      await loadBlogPost();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to unpublish.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this blog post? This cannot be undone.')) return;

    setDeleting(true);
    try {
      await adminDeleteBlogPost(id);
      showToast('Blog post deleted.', 'success');
      navigate('/admin/content');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to delete.'), 'error');
      setDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <AdminLayout>
        <div className="update-editor-loading">Loading blog post...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="update-editor">
        {/* Back nav */}
        <button
          className="update-editor-back"
          onClick={() => navigate('/admin/content')}
        >
          <Icon name="arrow-left" size={16} />
          <span>Back to Content</span>
        </button>

        {/* Header */}
        <div className="update-editor-header">
          <h1 className="update-editor-title">
            {isNew ? 'New Blog Post' : 'Edit Blog Post'}
          </h1>
          {!isNew && (
            <span className={`updates-status-badge ${status}`}>{status}</span>
          )}
        </div>

        {error && <div className="update-editor-error">{error}</div>}

        {/* Form */}
        <div className="update-editor-form">
          {/* Title + Slug */}
          <div className="editor-field">
            <label htmlFor="update-title">
              Title <span className="editor-required">*</span>
            </label>
            <input
              id="update-title"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Blog post title..."
            />
          </div>

          <div className="editor-field">
            <label htmlFor="update-slug">Slug</label>
            <input
              id="update-slug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="auto-generated-from-title"
            />
          </div>

          {/* Excerpt */}
          <div className="editor-field">
            <label htmlFor="update-excerpt">Excerpt</label>
            <textarea
              id="update-excerpt"
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Short summary for blog listings and SEO..."
              rows={2}
            />
          </div>

          {/* Category + Author row */}
          <div className="editor-row">
            <div className="editor-field">
              <label htmlFor="update-category">Category</label>
              <select
                id="update-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">-- Select --</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div className="editor-field">
              <label htmlFor="update-author-name">Author Name</label>
              <input
                id="update-author-name"
                type="text"
                value={authorDisplayName}
                onChange={(e) => setAuthorDisplayName(e.target.value)}
                placeholder="Display name"
              />
            </div>

            <div className="editor-field">
              <label htmlFor="update-author-role">Author Role</label>
              <input
                id="update-author-role"
                type="text"
                value={authorRole}
                onChange={(e) => setAuthorRole(e.target.value)}
                placeholder="e.g., Founder"
              />
            </div>
          </div>

          {/* Hero image */}
          <div className="editor-row">
            <div className="editor-field editor-field-grow">
              <label htmlFor="update-hero-url">Hero Image URL</label>
              <input
                id="update-hero-url"
                type="text"
                value={heroImageUrl}
                onChange={(e) => setHeroImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="editor-field">
              <label htmlFor="update-hero-alt">Hero Image Alt</label>
              <input
                id="update-hero-alt"
                type="text"
                value={heroImageAlt}
                onChange={(e) => setHeroImageAlt(e.target.value)}
                placeholder="Image description"
              />
            </div>
          </div>

          {/* Body */}
          <div className="editor-field">
            <label htmlFor="update-body">Body (Markdown)</label>
            <textarea
              id="update-body"
              className="editor-body-textarea"
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              placeholder="Write your blog post in Markdown..."
              rows={16}
            />
          </div>

          {/* SEO overrides */}
          <div className="editor-group">
            <h3 className="editor-group-title">SEO Overrides</h3>
            <div className="editor-field">
              <label htmlFor="update-seo-title">SEO Title</label>
              <input
                id="update-seo-title"
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder="Override the page title for search engines"
              />
            </div>
            <div className="editor-field">
              <label htmlFor="update-seo-desc">SEO Description</label>
              <textarea
                id="update-seo-desc"
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder="Override the meta description"
                rows={2}
              />
            </div>
          </div>

          {/* CTA */}
          <div className="editor-group">
            <h3 className="editor-group-title">Call to Action</h3>
            <div className="editor-row">
              <div className="editor-field">
                <label htmlFor="update-cta-label">CTA Label</label>
                <input
                  id="update-cta-label"
                  type="text"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="e.g., Browse the Collection"
                />
              </div>
              <div className="editor-field editor-field-grow">
                <label htmlFor="update-cta-url">CTA URL</label>
                <input
                  id="update-cta-url"
                  type="text"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="e.g., /collections"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="update-editor-actions">
          <div className="editor-actions-left">
            <Button
              variant="primary"
              size="sm"
              icon="save"
              loading={saving}
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

          <div className="editor-actions-right">
            {!isNew && status === 'draft' && (
              <Button
                variant="danger"
                size="sm"
                icon="delete"
                loading={deleting}
                onClick={handleDelete}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
