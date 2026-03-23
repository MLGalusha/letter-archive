import { apiGet, apiPost } from './client';

const TOKEN_KEY = 'adminToken';

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
  return data;
}

/**
 * Create the first admin account (one-time setup).
 * Stores the JWT token in localStorage on success.
 */
export async function setupAdmin(email: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/setup', { email, password });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data;
}

/**
 * Check whether any admin account exists yet.
 */
export async function getAuthStatus(): Promise<AuthStatusResponse> {
  return apiGet<AuthStatusResponse>('/auth/status');
}

/**
 * Log out by clearing the stored token.
 */
export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
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

// ── Invite system ──────────────────────────────────────

interface InviteResponse {
  token: string;
  expiresAt: string;
  email: string | null;
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
  return data;
}
