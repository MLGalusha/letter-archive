import { apiGet, apiPut, apiPost, apiDelete } from '../client';

interface SiteSettings {
  [key: string]: string;
}

interface InviteInfo {
  id: string;
  email: string | null;
  invitedBy: string;
  inviterEmail: string;
  expiresAt: string;
  createdAt: string;
}

interface AdminUserInfo {
  id: string;
  email: string;
  canDeleteAdminProfiles: boolean;
  createdAt: string;
  isCurrentUser: boolean;
  canBeDeleted: boolean;
}

interface AdminUsersResponse {
  currentUserId: string;
  currentUserCanDeleteAdminProfiles: boolean;
  users: AdminUserInfo[];
}

interface SystemInfo {
  openaiEnabled: boolean;
  corsOrigins: string;
  letterCount: number;
  totalLetters: number;
  collectionCount: number;
  pendingQueue: number;
}

export type { SiteSettings, InviteInfo, AdminUserInfo, AdminUsersResponse, SystemInfo };

export function getSettings(): Promise<SiteSettings> { return apiGet('/admin/settings'); }
export function updateSettings(settings: SiteSettings): Promise<SiteSettings> { return apiPut('/admin/settings', settings); }
export function getInvites(): Promise<InviteInfo[]> { return apiGet('/admin/settings/invites'); }
export function getAdminUsers(): Promise<AdminUsersResponse> { return apiGet('/admin/settings/admin-users'); }
export function revokeInvite(id: string): Promise<void> { return apiDelete(`/admin/settings/invites/${id}`); }
export function deleteAdminUser(id: string): Promise<void> { return apiDelete(`/admin/settings/admin-users/${id}`); }
export function changePassword(oldPassword: string, newPassword: string): Promise<void> { return apiPost('/admin/settings/change-password', { oldPassword, newPassword }); }
export function getSystemInfo(): Promise<SystemInfo> { return apiGet('/admin/settings/system-info'); }
