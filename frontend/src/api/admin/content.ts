import { apiGet, apiPost, apiPut, apiDelete } from '../client';

// ── Types ────────────────────────────────────────────────

export interface UpdatePost {
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
  contentJson: Record<string, string>;
  updatedAt: string;
}

// ── Content Management - Updates ─────────────────────────

export async function adminListUpdates(
  params?: { limit?: number; offset?: number },
): Promise<{ updates: UpdatePost[]; total: number }> {
  return apiGet<{ updates: UpdatePost[]; total: number }>(
    '/admin/content/updates',
    params as Record<string, string | number | undefined>,
  );
}

export async function adminGetUpdate(id: string): Promise<UpdatePost> {
  return apiGet<UpdatePost>(`/admin/content/updates/${id}`);
}

export async function adminCreateUpdate(data: Partial<UpdatePost>): Promise<UpdatePost> {
  return apiPost<UpdatePost>('/admin/content/updates', data);
}

export async function adminUpdatePost(id: string, data: Partial<UpdatePost>): Promise<UpdatePost> {
  return apiPut<UpdatePost>(`/admin/content/updates/${id}`, data);
}

export async function adminPublishUpdate(id: string): Promise<UpdatePost> {
  return apiPost<UpdatePost>(`/admin/content/updates/${id}/publish`);
}

export async function adminUnpublishUpdate(id: string): Promise<UpdatePost> {
  return apiPost<UpdatePost>(`/admin/content/updates/${id}/unpublish`);
}

export async function adminDeleteUpdate(id: string): Promise<void> {
  return apiDelete<void>(`/admin/content/updates/${id}`);
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
  data: { title: string; contentJson: Record<string, string> },
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
