/**
 * Base HTTP client for API calls
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';
const isDev = import.meta.env.DEV;

// Simple frontend logger
const log = {
  debug: (message: string, data?: Record<string, unknown>) => {
    if (isDev) console.debug(`[API] ${message}`, data || '');
  },
  info: (message: string, data?: Record<string, unknown>) => {
    if (isDev) console.info(`[API] ${message}`, data || '');
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[API] ${message}`, data || '');
  },
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(`[API] ${message}`, data || '');
  },
};

export class ApiError extends Error {
  status: number;
  data?: unknown;
  requestId?: string;
  responseMessage: string;

  constructor(status: number, message: string, data?: unknown, requestId?: string) {
    const resolvedRequestId = requestId ?? (data as { requestId?: string } | undefined)?.requestId;
    const displayMessage = resolvedRequestId
      ? `${message} (Request ID: ${resolvedRequestId})`
      : message;
    super(displayMessage);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.requestId = resolvedRequestId;
    this.responseMessage = message;
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function getRequestIdFromResponse(response: Response, data?: unknown): string | undefined {
  const bodyRequestId = (data as { requestId?: string } | undefined)?.requestId;
  return bodyRequestId || response.headers.get('x-request-id') || undefined;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return JSON.parse(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function handleResponse<T>(
  response: Response,
  method: string,
  path: string,
  startTime: number
): Promise<T> {
  const duration = Date.now() - startTime;
  const data = await parseResponseBody(response);

  if (!response.ok) {
    const requestId = getRequestIdFromResponse(response, data);
    const message = typeof data === 'string'
      ? data
      : (data as { error?: string; message?: string } | undefined)?.error
        || (data as { error?: string; message?: string } | undefined)?.message
        || response.statusText
        || 'Request failed';
    const error = new ApiError(
      response.status,
      message,
      data,
      requestId,
    );

    log.error('Request failed', {
      method,
      path,
      status: response.status,
      duration,
      requestId: error.requestId,
      error: error.message,
    });

    throw error;
  }

  log.debug('Request completed', { method, path, status: response.status, duration });
  return data as T;
}

/**
 * Build headers with auth token if available
 */
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/**
 * Merge auth headers with any existing headers
 */
function mergeHeaders(init: RequestInit): RequestInit {
  const authHeaders = getAuthHeaders();
  const existing = init.headers || {};
  return {
    ...init,
    headers: {
      ...authHeaders,
      ...(existing as Record<string, string>),
    },
  };
}

async function performRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  input: string,
  init: RequestInit,
): Promise<T> {
  const startTime = Date.now();

  try {
    const response = await fetch(input, {
      ...mergeHeaders(init),
      credentials: 'include',
    });

    // Handle 401 by clearing token and redirecting to login
    if (response.status === 401 && !path.startsWith('/auth/')) {
      localStorage.removeItem('adminToken');
      // Only redirect if we're on an admin page
      if (window.location.pathname.startsWith('/admin')) {
        window.location.href = '/admin-login';
        throw new ApiError(401, 'Session expired. Redirecting to login.');
      }
    }

    return handleResponse<T>(response, method, path, startTime);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof ApiError) {
      throw error;
    }

    const apiError = new ApiError(
      0,
      error instanceof Error ? error.message : 'Network request failed',
      { cause: error instanceof Error ? error.message : String(error) },
    );

    log.error('Request failed before response', {
      method,
      path,
      duration,
      error: apiError.message,
    });

    throw apiError;
  }
}

/**
 * GET request
 */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(path, API_BASE_URL);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  log.debug('GET request', { path, params });
  return performRequest<T>('GET', path, url.toString(), {});
}

/**
 * POST request
 */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const isFormData = body instanceof FormData;

  log.debug('POST request', { path, isFormData });
  return performRequest<T>('POST', path, `${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: isFormData ? {} : { 'Content-Type': 'application/json' },
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });
}

/**
 * PUT request
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  log.debug('PUT request', { path });
  return performRequest<T>('PUT', path, `${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * PATCH request
 */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  log.debug('PATCH request', { path });
  return performRequest<T>('PATCH', path, `${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * DELETE request
 */
export async function apiDelete<T>(path: string): Promise<T> {
  log.debug('DELETE request', { path });
  return performRequest<T>('DELETE', path, `${API_BASE_URL}${path}`, {
    method: 'DELETE',
  });
}

/**
 * Get full URL for an image
 */
export function getImageUrl(imageUrl: string): string {
  // If it's already a full URL, return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  // Otherwise, prepend API base URL
  return `${API_BASE_URL}${imageUrl}`;
}

// ── Blog & Content types ─────────────────────────────────────────────────────

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

export interface FeaturedLetter {
  id: string;
  hook: string | null;
  summary: string | null;
  sender: string | null;
  recipient: string | null;
  letterDate: string | null;
  collectionCode: string;
  collectionTitle: string | null;
}

export interface ContentPage {
  slug: string;
  title: string;
  contentJson: Record<string, string>;
  updatedAt: string;
}

// ── Blog & Content API ───────────────────────────────────────────────────────

export async function listBlogPosts(
  params?: { limit?: number; offset?: number; category?: string },
): Promise<{ posts: BlogPost[]; total: number }> {
  return apiGet<{ posts: BlogPost[]; total: number }>('/blog', {
    limit: params?.limit,
    offset: params?.offset,
    category: params?.category,
  });
}

export async function getBlogPost(slug: string): Promise<BlogPost> {
  return apiGet<BlogPost>(`/blog/${encodeURIComponent(slug)}`);
}

export async function getFeaturedLetter(): Promise<FeaturedLetter | null> {
  try {
    return await apiGet<FeaturedLetter>('/content/featured-letter');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getContentPage(slug: string): Promise<ContentPage | null> {
  try {
    return await apiGet<ContentPage>(`/content/pages/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export { API_BASE_URL };
