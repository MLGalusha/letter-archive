import { apiGet, apiPost, apiPut, apiDelete } from '../client';

// ── Types ────────────────────────────────────────────────

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  status: string;
  category: string | null;
  authorDisplayName: string | null;
  authorRole: string | null;
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPage {
  slug: string;
  title: string;
  contentJson: Record<string, unknown>;
  updatedAt: string;
}

// ── Content Management - Blog ────────────────────────────

export async function adminListBlogPosts(
  params?: { limit?: number; offset?: number },
): Promise<{ posts: BlogPost[]; total: number }> {
  return apiGet<{ posts: BlogPost[]; total: number }>(
    '/admin/content/blog',
    params as Record<string, string | number | undefined>,
  );
}

export async function adminGetBlogPost(id: string): Promise<BlogPost> {
  return apiGet<BlogPost>(`/admin/content/blog/${id}`);
}

export async function adminCreateBlogPost(data: Partial<BlogPost>): Promise<BlogPost> {
  return apiPost<BlogPost>('/admin/content/blog', data);
}

export async function adminUpdateBlogPost(id: string, data: Partial<BlogPost>): Promise<BlogPost> {
  return apiPut<BlogPost>(`/admin/content/blog/${id}`, data);
}

export async function adminPublishBlogPost(id: string): Promise<BlogPost> {
  return apiPost<BlogPost>(`/admin/content/blog/${id}/publish`);
}

export async function adminUnpublishBlogPost(id: string): Promise<BlogPost> {
  return apiPost<BlogPost>(`/admin/content/blog/${id}/unpublish`);
}

export async function adminDeleteBlogPost(id: string): Promise<void> {
  return apiDelete<void>(`/admin/content/blog/${id}`);
}

// ── Content Management - Pages ───────────────────────────

export async function adminListContentPages(): Promise<ContentPage[]> {
  return apiGet<ContentPage[]>('/admin/content/pages');
}

export async function adminGetContentPage(slug: string): Promise<ContentPage> {
  return apiGet<ContentPage>(`/admin/content/pages/${slug}`);
}

export async function adminUpdateContentPage(
  slug: string,
  data: { title: string; contentJson: Record<string, unknown> },
): Promise<ContentPage> {
  return apiPut<ContentPage>(`/admin/content/pages/${slug}`, data);
}

// ── Content Management - Featured Letter ─────────────────

export async function adminGetFeaturedLetter(): Promise<{ letter_id: string | null; letter?: any }> {
  return apiGet<{ letter_id: string | null; letter?: any }>('/admin/content/featured-letter');
}

export async function adminSetFeaturedLetter(letterId: string): Promise<void> {
  return apiPut<void>('/admin/content/featured-letter', { letterId });
}

// ── Blog Images ─────────────────────────────────────────

export async function uploadBlogImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  return apiPost<{ url: string }>('/admin/blog/images', formData);
}
