import { ApiError, apiDelete, apiGet, apiPost } from './client';

const TOKEN_KEY = 'adminToken';
let imageSessionToken: string | null = null;
let imageSessionPromise: Promise<void> | null = null;

interface LoginResponse {
  token: string;
  email: string;
}

interface AuthStatusResponse {
  hasAdmin: boolean;
}

/**
 * Log in with email and password. Stores the JWT token in localStorage on success.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/login', { email, password });
  localStorage.setItem(TOKEN_KEY, data.token);
  markImageSessionReady(data.token);
  return data;
}

/**
 * Create the first admin account (one-time setup).
 * Stores the JWT token in localStorage on success.
 */
export async function setupAdmin(email: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/setup', { email, password });
  localStorage.setItem(TOKEN_KEY, data.token);
  markImageSessionReady(data.token);
  return data;
}

/**
 * Check whether any admin account exists yet.
 */
export async function getAuthStatus(): Promise<AuthStatusResponse> {
  return apiGet<AuthStatusResponse>('/auth/status');
}

/**
 * Clear both the server-managed image session and the stored API bearer.
 * The bearer remains available if the server cannot complete logout, allowing
 * the user to retry without leaving a live HttpOnly credential behind.
 */
export async function logout(): Promise<void> {
  await apiDelete<void>('/auth/image-session');
  localStorage.removeItem(TOKEN_KEY);
  imageSessionToken = null;
  imageSessionPromise = null;
}

/**
 * Get the stored JWT token, or null if not logged in.
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Check if a token exists. Does NOT verify expiry client-side;
 * the server will return 401 if the token is expired.
 */
export function isAuthenticated(): boolean {
  return localStorage.getItem(TOKEN_KEY) !== null;
}

/**
 * Establish the HttpOnly image credential for a bearer that predates the
 * cookie boundary. AdminLayout awaits this before rendering private images.
 */
export function ensureImageSession(): Promise<void> {
  const token = getToken();
  if (!token) {
    return Promise.reject(new ApiError(401, 'Authentication required'));
  }

  if (imageSessionToken === token && imageSessionPromise) {
    return imageSessionPromise;
  }

  imageSessionToken = token;
  imageSessionPromise = apiPost<void>('/auth/image-session')
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
      }
      imageSessionToken = null;
      imageSessionPromise = null;
      throw error;
    });

  return imageSessionPromise;
}

function markImageSessionReady(token: string): void {
  imageSessionToken = token;
  imageSessionPromise = Promise.resolve();
}

// ── Invite system ──────────────────────────────────────

interface InviteResponse {
  token: string;
  expiresAt: string;
  email: string | null;
  expiresInMs: number;
}

interface InviteValidation {
  valid: boolean;
  email: string | null;
}

/**
 * Create an invite link (requires auth).
 */
export async function createInvite(email?: string): Promise<InviteResponse> {
  return apiPost<InviteResponse>('/auth/invite', email ? { email } : {});
}

/**
 * Validate an invite token.
 */
export async function validateInvite(token: string): Promise<InviteValidation> {
  return apiGet<InviteValidation>(`/auth/invite/${token}`);
}

/**
 * Accept an invite and create an admin account.
 */
export async function acceptInvite(token: string, email: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/accept-invite', { token, email, password });
  localStorage.setItem(TOKEN_KEY, data.token);
  markImageSessionReady(data.token);
  return data;
}
