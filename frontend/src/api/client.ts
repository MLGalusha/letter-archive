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

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.requestId = (data as { requestId?: string })?.requestId;
  }
}

async function handleResponse<T>(
  response: Response,
  method: string,
  path: string,
  startTime: number
): Promise<T> {
  const duration = Date.now() - startTime;

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new ApiError(
      response.status,
      (data as { error?: string }).error || response.statusText,
      data
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
  return response.json();
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
  const startTime = Date.now();

  const response = await fetch(url.toString(), {
    credentials: 'include',
  });

  return handleResponse<T>(response, 'GET', path, startTime);
}

/**
 * POST request
 */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const isFormData = body instanceof FormData;

  log.debug('POST request', { path, isFormData });
  const startTime = Date.now();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: isFormData ? {} : { 'Content-Type': 'application/json' },
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  return handleResponse<T>(response, 'POST', path, startTime);
}

/**
 * PUT request
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  log.debug('PUT request', { path });
  const startTime = Date.now();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  return handleResponse<T>(response, 'PUT', path, startTime);
}

/**
 * PATCH request
 */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  log.debug('PATCH request', { path });
  const startTime = Date.now();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  return handleResponse<T>(response, 'PATCH', path, startTime);
}

/**
 * DELETE request
 */
export async function apiDelete<T>(path: string): Promise<T> {
  log.debug('DELETE request', { path });
  const startTime = Date.now();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return handleResponse<T>(response, 'DELETE', path, startTime);
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

export { API_BASE_URL };
